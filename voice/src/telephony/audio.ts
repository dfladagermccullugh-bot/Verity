/**
 * G.711 mu-law codec, DTMF synthesis and detection, and a coarse classifier (silence, speech,
 * hold music, ringback) for 8 kHz telephone audio.
 *
 * Origin: phone_map `server/telephony/audio.ts`. Changed here: `AudioClassifier` uses the shared
 * `AudioState` type, `mulawFrames` and `mulawDurationMs` are new (outbound audio is sent in
 * 20 ms frames), and index reads are made safe for this package's stricter compiler settings.
 * The signal processing is unchanged.
 */

import type { AudioState } from "./types.js";

export const SAMPLE_RATE = 8000;
export const FRAME_SAMPLES = 160; // 20 ms
export const FRAME_MS = 20;
/** The mu-law byte for a zero sample. */
export const MULAW_SILENCE = 0xff;

const BIAS = 0x84;
const CLIP = 32635;

export function linearToMulaw(sample: number): number {
  let s = Math.max(-32768, Math.min(32767, Math.round(sample)));
  const sign = s < 0 ? 0x80 : 0;
  if (s < 0) s = -s;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

const MULAW_TABLE = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const u = ~i & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + BIAS) << exponent;
  sample -= BIAS;
  MULAW_TABLE[i] = sign ? -sample : sample;
}

export function mulawToLinear(byte: number): number {
  return MULAW_TABLE[byte & 0xff]!;
}

export function decodeMulaw(buf: Uint8Array): Int16Array {
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = MULAW_TABLE[buf[i]!]!;
  return out;
}

export function encodeMulaw(pcm: Int16Array | number[]): Buffer {
  const out = Buffer.alloc(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = linearToMulaw(pcm[i]!);
  return out;
}

/** How long 8 kHz mu-law audio lasts: one byte per sample. */
export function mulawDurationMs(mulaw: Uint8Array): number {
  return (mulaw.length / SAMPLE_RATE) * 1000;
}

/** Split mu-law audio into 20 ms frames. The last frame is padded with silence to full length. */
export function mulawFrames(mulaw: Buffer): Buffer[] {
  const frames: Buffer[] = [];
  for (let i = 0; i < mulaw.length; i += FRAME_SAMPLES) {
    const frame = mulaw.subarray(i, i + FRAME_SAMPLES);
    frames.push(frame.length === FRAME_SAMPLES ? frame : Buffer.concat([frame, Buffer.alloc(FRAME_SAMPLES - frame.length, MULAW_SILENCE)]));
  }
  return frames;
}

export const DTMF_FREQS: Record<string, [number, number]> = {
  "1": [697, 1209], "2": [697, 1336], "3": [697, 1477],
  "4": [770, 1209], "5": [770, 1336], "6": [770, 1477],
  "7": [852, 1209], "8": [852, 1336], "9": [852, 1477],
  "*": [941, 1209], "0": [941, 1336], "#": [941, 1477],
};

/** Synthesize DTMF tones as 8 kHz mu-law. Each digit: `toneMs` of tone followed by `gapMs` of silence. */
export function dtmfMulaw(digits: string, toneMs = 160, gapMs = 100, amplitude = 0.35): Buffer {
  const pcm: number[] = [];
  const toneN = Math.round((toneMs / 1000) * SAMPLE_RATE);
  const gapN = Math.round((gapMs / 1000) * SAMPLE_RATE);
  for (const d of digits) {
    const f = DTMF_FREQS[d];
    if (!f) throw new Error(`Invalid DTMF digit: ${d}`);
    for (let i = 0; i < toneN; i++) {
      const t = i / SAMPLE_RATE;
      // short linear ramp to avoid clicks
      const ramp = Math.min(1, i / 40, (toneN - i) / 40);
      pcm.push(ramp * amplitude * 16000 * (Math.sin(2 * Math.PI * f[0] * t) + Math.sin(2 * Math.PI * f[1] * t)));
    }
    for (let i = 0; i < gapN; i++) pcm.push(0);
  }
  return encodeMulaw(pcm);
}

/** Goertzel power of `freq` in `samples`. */
export function goertzel(samples: ArrayLike<number>, freq: number, sampleRate = SAMPLE_RATE): number {
  const k = Math.round((samples.length * freq) / sampleRate);
  const w = (2 * Math.PI * k) / samples.length;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const s0 = samples[i]! + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

function energy(samples: ArrayLike<number>): number {
  let e = 0;
  for (let i = 0; i < samples.length; i++) e += samples[i]! * samples[i]!;
  return e;
}

const DTMF_ROWS = [697, 770, 852, 941];
const DTMF_COLS = [1209, 1336, 1477];

/** Detect the DTMF digit in a block of samples (>= ~25 ms recommended), or null. */
export function detectDtmf(samples: ArrayLike<number>): string | null {
  const total = energy(samples);
  if (total / samples.length < 1e4) return null;
  const rp = DTMF_ROWS.map((f) => goertzel(samples, f));
  const cp = DTMF_COLS.map((f) => goertzel(samples, f));
  const r = rp.indexOf(Math.max(...rp));
  const c = cp.indexOf(Math.max(...cp));
  // Tone energy must dominate (Goertzel power is ~N/2 * total energy for a pure tone).
  const toneShare = ((rp[r]! + cp[c]!) * 2) / (samples.length * total);
  if (toneShare < 0.5) return null;
  for (const [d, [fr, fc]] of Object.entries(DTMF_FREQS)) if (fr === DTMF_ROWS[r] && fc === DTMF_COLS[c]) return d;
  return null;
}

/** Decode a sequence of DTMF digits from mu-law audio. */
export function decodeDtmfSequence(mulaw: Uint8Array): string {
  const pcm = decodeMulaw(mulaw);
  const block = 205; // ~25 ms
  let out = "";
  let last: string | null = null;
  let run = 0;
  for (let i = 0; i + block <= pcm.length; i += block) {
    const d = detectDtmf(pcm.subarray(i, i + block));
    if (d === last) run++;
    else {
      last = d;
      run = 1;
    }
    if (d && run === 2) out += d;
  }
  return out;
}

/**
 * Streaming classifier for inbound call audio. Feed mu-law audio; it reports a coarse state:
 * - ringback: North American ringback tone (440 + 480 Hz)
 * - music: sustained audio with no speech-like pauses (typical hold music)
 * - speech: active audio with pauses
 * - silence
 */
export class AudioClassifier {
  private history: { active: boolean; ring: boolean }[] = [];
  private state: AudioState = "silence";
  private stateSince = 0;
  private frameIndex = 0;
  private pending = new Int16Array(0);

  constructor(
    private onState: (state: AudioState, atMs: number) => void,
    private opts = { windowFrames: 200, activeDb: -42 },
  ) {}

  get current(): { state: AudioState; sinceMs: number } {
    return { state: this.state, sinceMs: this.stateSince };
  }

  pushMulaw(buf: Uint8Array): void {
    const pcm = decodeMulaw(buf);
    const merged = new Int16Array(this.pending.length + pcm.length);
    merged.set(this.pending);
    merged.set(pcm, this.pending.length);
    let i = 0;
    for (; i + FRAME_SAMPLES <= merged.length; i += FRAME_SAMPLES) this.frame(merged.subarray(i, i + FRAME_SAMPLES));
    this.pending = merged.slice(i);
  }

  private frame(samples: Int16Array): void {
    const e = energy(samples) / samples.length;
    const db = 10 * Math.log10(e / (32768 * 32768) + 1e-12);
    const active = db > this.opts.activeDb;
    let ring = false;
    if (active) {
      const total = e * samples.length;
      const share = ((goertzel(samples, 440) + goertzel(samples, 480)) * 2) / (samples.length * total);
      ring = share > 0.6;
    }
    this.history.push({ active, ring });
    if (this.history.length > this.opts.windowFrames) this.history.shift();
    this.frameIndex++;
    const atMs = this.frameIndex * FRAME_MS;

    const recent = this.history.slice(-100); // last 2 s
    const ringShare = recent.filter((f) => f.ring).length / recent.length;
    const window = this.history;
    const activeShare = window.filter((f) => f.active).length / window.length;
    let longestGap = 0;
    let gap = 0;
    for (const f of window) {
      gap = f.active ? 0 : gap + 1;
      longestGap = Math.max(longestGap, gap);
    }
    const recentActive = this.history.slice(-25).some((f) => f.active);

    let next: AudioState;
    if (ringShare > 0.4) next = "ringback";
    else if (window.length >= this.opts.windowFrames && activeShare > 0.93 && longestGap < 8) next = "music";
    else if (recentActive) next = "speech";
    else next = "silence";
    if (next !== this.state) {
      this.state = next;
      this.stateSince = atMs;
      this.onState(next, atMs);
    }
  }
}
