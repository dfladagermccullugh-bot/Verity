// Origin: phone_map `test/audio.test.ts`, plus the framing helpers added for outbound audio.

import { describe, expect, it } from "vitest";
import {
  AudioClassifier,
  FRAME_SAMPLES,
  MULAW_SILENCE,
  decodeDtmfSequence,
  dtmfMulaw,
  encodeMulaw,
  linearToMulaw,
  mulawDurationMs,
  mulawFrames,
  mulawToLinear,
} from "../src/telephony/audio.js";

function tone(freqs: number[], ms: number, amp = 6000): number[] {
  const n = Math.round((ms / 1000) * 8000);
  return Array.from({ length: n }, (_, i) => freqs.reduce((s, f) => s + amp * Math.sin((2 * Math.PI * f * i) / 8000), 0));
}

function run(pcm: number[]): string[] {
  const states: string[] = [];
  const c = new AudioClassifier((s) => states.push(s));
  const mu = encodeMulaw(pcm);
  for (let i = 0; i < mu.length; i += 160) c.pushMulaw(mu.subarray(i, i + 160));
  return states;
}

describe("mu-law", () => {
  it("round-trips within quantization error", () => {
    for (const v of [0, 100, -100, 1000, -5000, 20000, -32000]) {
      const back = mulawToLinear(linearToMulaw(v));
      expect(Math.abs(back - v)).toBeLessThanOrEqual(Math.max(8, Math.abs(v) * 0.07));
    }
  });

  it("encodes silence as the byte used for padding", () => {
    expect(linearToMulaw(0)).toBe(MULAW_SILENCE);
    expect(mulawToLinear(MULAW_SILENCE)).toBe(0);
  });
});

describe("framing", () => {
  it("measures duration at one byte per sample", () => {
    expect(mulawDurationMs(Buffer.alloc(8000))).toBe(1000);
    expect(mulawDurationMs(Buffer.alloc(160))).toBe(20);
    expect(mulawDurationMs(Buffer.alloc(0))).toBe(0);
  });

  it("splits audio into 20 ms frames and pads the last with silence", () => {
    const audio = encodeMulaw(tone([440], 50)); // 400 samples: two full frames and half a frame
    const frames = mulawFrames(audio);
    expect(frames.map((f) => f.length)).toEqual([FRAME_SAMPLES, FRAME_SAMPLES, FRAME_SAMPLES]);
    const joined = Buffer.concat(frames);
    expect(joined.subarray(0, audio.length).equals(audio)).toBe(true);
    expect([...joined.subarray(audio.length)].every((b) => b === MULAW_SILENCE)).toBe(true);
  });

  it("gives no frames for no audio", () => {
    expect(mulawFrames(Buffer.alloc(0))).toEqual([]);
  });
});

describe("DTMF", () => {
  it("synthesized tones decode to the same digits", () => {
    expect(decodeDtmfSequence(dtmfMulaw("1234567890*#"))).toBe("1234567890*#");
  });

  it("refuses a character that is not a key", () => {
    expect(() => dtmfMulaw("1a")).toThrow(/Invalid DTMF digit/);
  });

  it("hears no key in silence or in a single tone", () => {
    expect(decodeDtmfSequence(encodeMulaw(new Array(4000).fill(0)))).toBe("");
    expect(decodeDtmfSequence(encodeMulaw(tone([440], 500)))).toBe("");
  });
});

describe("audio classifier", () => {
  it("detects ringback", () => {
    expect(run(tone([440, 480], 2500))).toContain("ringback");
  });

  it("detects continuous hold music", () => {
    const music: number[] = [];
    const notes = [262, 330, 392, 523, 392, 330];
    for (let i = 0; i < 30; i++) music.push(...tone([notes[i % notes.length]!, notes[(i + 2) % notes.length]! * 1.5], 250, 3000));
    expect(run(music)).toContain("music");
  });

  it("does not mistake speech-like bursts for music", () => {
    const speech: number[] = [];
    for (let i = 0; i < 25; i++) {
      speech.push(...tone([180 + (i % 5) * 40, 900], 220, 4000));
      speech.push(...new Array(Math.round(0.18 * 8000)).fill(0));
    }
    const states = run(speech);
    expect(states).toContain("speech");
    expect(states).not.toContain("music");
  });

  it("reports silence again once speech stops", () => {
    const states = run([...tone([200, 900], 300, 4000), ...new Array(8000).fill(0)]);
    expect(states).toEqual(["speech", "silence"]);
  });
});
