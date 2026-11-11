/**
 * Turning script lines into audio. Every line of a campaign is rendered once and reused, so
 * each respondent hears the identical recording of each question.
 *
 * Voices sit behind one small interface so they can be compared and swapped (plan decision D11).
 * The two vendor adapters are written from the vendors' API reference and have NOT been run
 * against a live account.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SpeechTable, SpokenLine } from "../interviewer/protocol.js";
import { MULAW_SILENCE, SAMPLE_RATE } from "../telephony/audio.js";

/**
 * What the audio is for. "phone" is 8 kHz mu-law with no header, the format a phone line carries.
 * "page" is a WAV file of 24 kHz 16-bit sound, for a web page to play: the same voice, heard in
 * better quality than a phone line allows.
 */
export type VoiceOutput = "phone" | "page";
export const PAGE_SAMPLE_RATE = 24_000;

/** A text-to-speech voice. Output is phone audio (8 kHz mu-law, no header) unless the voice was made for a page. */
export interface TtsVoice {
  /** Identifies the vendor, model and voice. Part of the cache key and of the audit trail. */
  id: string;
  synthesize(text: string): Promise<Buffer>;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> }>;

async function post(fetchFn: Fetch, url: string, headers: Record<string, string>, body: unknown, vendor: string): Promise<Buffer> {
  const res = await fetchFn(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${vendor} text-to-speech failed with HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Cartesia Sonic. Per the API reference (POST /tts/bytes, version 2026-08-14): raw `pcm_mulaw`
 * at 8000 Hz is a supported output, and the response body is the audio itself.
 */
export function cartesiaVoice(cfg: { apiKey: string; voiceId: string; model?: string; output?: VoiceOutput; fetch?: Fetch }): TtsVoice {
  const model = cfg.model ?? "sonic-3.6";
  const fetchFn = cfg.fetch ?? (fetch as unknown as Fetch);
  const page = cfg.output === "page";
  const output_format = page ? { container: "wav", encoding: "pcm_s16le", sample_rate: PAGE_SAMPLE_RATE } : { container: "raw", encoding: "pcm_mulaw", sample_rate: SAMPLE_RATE };
  return {
    id: `cartesia/${model}/${cfg.voiceId}${page ? "/page" : ""}`,
    synthesize: async (text) => {
      const audio = await post(fetchFn, "https://api.cartesia.ai/tts/bytes", { Authorization: `Bearer ${cfg.apiKey}`, "Cartesia-Version": "2026-08-14" }, { model_id: model, transcript: text, voice: { id: cfg.voiceId }, output_format, language: "en" }, "Cartesia");
      return page ? mustBeWav(audio, "Cartesia") : audio;
    },
  };
}

/**
 * Deepgram Aura. Per the API reference (POST /v1/speak): `encoding=mulaw` at 8000 Hz is supported
 * and is documented with the `wav` container, so the WAV wrapper is removed here. The reference
 * does not state the response body format; this assumes audio bytes, to be confirmed on first use.
 */
export function deepgramVoice(cfg: { apiKey: string; model?: string; output?: VoiceOutput; fetch?: Fetch }): TtsVoice {
  const model = cfg.model ?? "aura-2-thalia-en";
  const fetchFn = cfg.fetch ?? (fetch as unknown as Fetch);
  const page = cfg.output === "page";
  const url = `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}&${page ? `encoding=linear16&sample_rate=${PAGE_SAMPLE_RATE}` : `encoding=mulaw&sample_rate=${SAMPLE_RATE}`}&container=wav`;
  return {
    id: `deepgram/${model}${page ? "/page" : ""}`,
    synthesize: async (text) => {
      const audio = await post(fetchFn, url, { Authorization: `Token ${cfg.apiKey}` }, { text }, "Deepgram");
      return page ? mustBeWav(audio, "Deepgram") : wavData(audio);
    },
  };
}

/** A page plays the file as it arrives, so anything that is not a WAV file is an error here, not in the visitor's browser. */
function mustBeWav(buf: Buffer, vendor: string): Buffer {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error(`${vendor} did not return a WAV file (first bytes: ${buf.subarray(0, 12).toString("hex")}).`);
  return buf;
}

/** Wrap 16-bit samples in a WAV header. */
export function pcmWav(pcm: Int16Array, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length * 2, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // format 1 = linear PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length * 2, 40);
  return Buffer.concat([header, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)]);
}

/**
 * A stand-in page voice for tests and for trying the page with no vendor account: a soft
 * two-note hum of the length the words would take to say. It is plainly not speech.
 */
export function humVoice(charsPerSecond = 15): TtsVoice {
  return {
    id: `hum/${charsPerSecond}cps/page`,
    synthesize: async (text) => {
      const n = Math.max(PAGE_SAMPLE_RATE / 4, Math.round((text.length / charsPerSecond) * PAGE_SAMPLE_RATE));
      const pcm = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / PAGE_SAMPLE_RATE;
        const swell = Math.min(1, i / 1200, (n - i) / 1200) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t));
        pcm[i] = Math.round(6000 * swell * (Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 720 * t)));
      }
      return pcmWav(pcm, PAGE_SAMPLE_RATE);
    },
  };
}

/** The audio samples of a WAV file, without its header. A buffer that is not a WAV file is returned unchanged. */
export function wavData(buf: Buffer): Buffer {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return buf;
  let at = 12;
  while (at + 8 <= buf.length) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === "data") return buf.subarray(at + 8, Math.min(buf.length, at + 8 + size));
    at += 8 + size + (size % 2);
  }
  throw new Error("The WAV file has no audio data.");
}

/** A stand-in voice for tests and dry runs: silence of the length the words would take to say. */
export function silentVoice(charsPerSecond = 15): TtsVoice {
  return {
    id: `silent/${charsPerSecond}cps`,
    synthesize: async (text) => Buffer.alloc(Math.max(1600, Math.round((text.length / charsPerSecond) * SAMPLE_RATE)), MULAW_SILENCE),
  };
}

/** Rendered audio for a campaign's lines, cached in memory and optionally on disk. */
export class SpeechStore {
  private readonly memory = new Map<string, Buffer>();
  /** Renderings under way, so two requests for the same line share one call to the vendor. */
  private readonly pending = new Map<string, Promise<Buffer>>();

  constructor(
    readonly voice: TtsVoice,
    private readonly dir?: string,
  ) {
    if (dir) mkdirSync(dir, { recursive: true });
  }

  private key(text: string): string {
    return createHash("sha256").update(`${this.voice.id}\n${text}`).digest("hex");
  }

  get(line: Pick<SpokenLine, "text">): Promise<Buffer> {
    const key = this.key(line.text);
    const hit = this.memory.get(key);
    if (hit) return Promise.resolve(hit);
    let job = this.pending.get(key);
    if (!job) {
      job = this.render(key, line).finally(() => this.pending.delete(key));
      this.pending.set(key, job);
    }
    return job;
  }

  private async render(key: string, line: Pick<SpokenLine, "text">): Promise<Buffer> {
    const file = this.dir ? join(this.dir, `${key}.ulaw`) : null;
    let audio: Buffer;
    if (file && existsSync(file)) audio = readFileSync(file);
    else {
      audio = await this.voice.synthesize(line.text);
      if (audio.length === 0) throw new Error(`The voice returned no audio for: ${line.text.slice(0, 60)}`);
      if (file) writeFileSync(file, audio);
    }
    this.memory.set(key, audio);
    return audio;
  }

  /** Render every line of a campaign before any call is placed, so no call waits on a voice vendor. */
  async prerender(table: SpeechTable): Promise<{ lines: number; seconds: number }> {
    let samples = 0;
    for (const line of table.lines.values()) samples += (await this.get(line)).length;
    return { lines: table.lines.size, seconds: Math.round(samples / SAMPLE_RATE) };
  }
}
