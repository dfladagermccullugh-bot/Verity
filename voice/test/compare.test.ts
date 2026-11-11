import { describe, expect, it } from "vitest";
import { mulawWav, wordErrorRate } from "../src/voice/compare.js";
import { wavData } from "../src/voice/tts.js";

describe("voice comparison tools", () => {
  it("word error rate ignores case and punctuation and counts each kind of error", () => {
    expect(wordErrorRate("Do you agree to take part?", "do you agree to take part")).toBe(0);
    expect(wordErrorRate("Don't know", "dont know")).toBe(0);
    expect(wordErrorRate("one two three four", "one two tree four")).toBe(0.25);
    expect(wordErrorRate("one two three four", "one two four")).toBe(0.25);
    expect(wordErrorRate("one two three four", "one two three three four")).toBe(0.25);
    expect(wordErrorRate("one two", "")).toBe(1);
    expect(wordErrorRate("", "")).toBe(0);
    expect(wordErrorRate("", "noise")).toBe(1);
  });

  it("wraps phone audio in a WAV file that reads back to the same audio", () => {
    const audio = Buffer.from(Array.from({ length: 801 }, (_, i) => i % 256));
    const wav = mulawWav(audio);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
    expect(wav.readUInt16LE(20)).toBe(7);
    expect(wav.readUInt32LE(24)).toBe(8000);
    expect(wavData(wav)).toEqual(audio);
  });
});
