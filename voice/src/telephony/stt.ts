/**
 * The listening seam: a stream that takes phone audio and reports what was said and when.
 *
 * Origin: phone_map `server/telephony/stt.ts`. Changed here: the carrier session no longer
 * builds its listener; it is handed an `SttFactory`, so the listening vendor is a campaign
 * choice (plan D11). The stream also reports `speechStart` and `utteranceEnd`, which the
 * Deepgram adapter used to drop and which turn-taking needs. The carrier-transcription source
 * (`PushStt`) is not carried over.
 */

import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type { TranscriptEvent } from "./types.js";

/** Times are ms from the first audio written, which a call session lines up with call time. */
export interface SttEventMap {
  transcript: [TranscriptEvent];
  /** Speech was first detected at this time. */
  speechStart: [number];
  /** The speaker stopped; the time is the end of the last word. */
  utteranceEnd: [number];
  error: [Error];
}

export interface SttStream extends EventEmitter<SttEventMap> {
  /** Raw audio in the format the stream was opened with. */
  write(audio: Buffer): void;
  close(): void;
}

/** The audio a caller will write. Phone audio is 8 kHz mu-law; stated so an adapter never has to assume it. */
export interface SttOptions {
  encoding: "mulaw";
  sampleRate: number;
}

export type SttFactory = (opts: SttOptions) => SttStream;

export interface DeepgramConfig {
  apiKey: string;
  /** Defaults to nova-3. */
  model?: string;
  /** The listen endpoint. Only tests override it. */
  url?: string;
}

const DEEPGRAM_LISTEN_URL = "wss://api.deepgram.com/v1/listen";

interface DeepgramMessage {
  type?: string;
  is_final?: boolean;
  start?: number;
  duration?: number;
  /** SpeechStarted: seconds into the audio. */
  timestamp?: number;
  /** UtteranceEnd: seconds into the audio, or -1 when the result was already finalized. */
  last_word_end?: number;
  channel?: { alternatives?: { transcript?: string; words?: { start: number; end: number }[] }[] };
}

/**
 * Deepgram streaming speech-to-text (`/v1/listen`) over WebSocket. Audio timestamps are relative
 * to the start of the stream.
 *
 * Deepgram Flux, which reports turns itself, is the planned alternative behind this same seam;
 * it is a different endpoint and message set and is not implemented here.
 */
export class DeepgramStt extends EventEmitter<SttEventMap> implements SttStream {
  private ws: WebSocket;
  private queue: Buffer[] = [];
  private open = false;
  private closing = false;
  private keepAlive: NodeJS.Timeout;

  constructor(cfg: DeepgramConfig, opts: SttOptions) {
    super();
    const params = new URLSearchParams({
      encoding: opts.encoding,
      sample_rate: String(opts.sampleRate),
      channels: "1",
      model: cfg.model ?? "nova-3",
      punctuate: "true",
      smart_format: "true",
      numerals: "true",
      interim_results: "true",
      endpointing: "400",
      utterance_end_ms: "1200",
      vad_events: "true",
    });
    this.ws = new WebSocket(`${cfg.url ?? DEEPGRAM_LISTEN_URL}?${params}`, { headers: { Authorization: `Token ${cfg.apiKey}` } });
    this.ws.on("open", () => {
      this.open = true;
      for (const b of this.queue) this.ws.send(b);
      this.queue = [];
    });
    this.ws.on("message", (data) => this.onMessage(data.toString()));
    // A stream that dies mid-call leaves the interviewer deaf, so it is reported, not swallowed.
    this.ws.on("close", () => {
      const wasOpen = this.open;
      this.open = false;
      clearInterval(this.keepAlive);
      if (wasOpen && !this.closing) this.emit("error", new Error("Deepgram stream closed unexpectedly"));
    });
    this.ws.on("error", (err) => {
      if (!this.closing) this.emit("error", err);
    });
    this.keepAlive = setInterval(() => {
      if (this.open) this.ws.send(JSON.stringify({ type: "KeepAlive" }));
    }, 5000);
  }

  private onMessage(raw: string): void {
    let msg: DeepgramMessage;
    try {
      msg = JSON.parse(raw) as DeepgramMessage;
    } catch {
      return;
    }
    if (msg.type === "SpeechStarted" && typeof msg.timestamp === "number") {
      this.emit("speechStart", msg.timestamp * 1000);
      return;
    }
    if (msg.type === "UtteranceEnd" && typeof msg.last_word_end === "number") {
      // -1 means the utterance was already closed by a final result; Deepgram says to ignore it.
      if (msg.last_word_end >= 0) this.emit("utteranceEnd", msg.last_word_end * 1000);
      return;
    }
    if (msg.type !== "Results") return;
    const alt = msg.channel?.alternatives?.[0];
    const text = alt?.transcript?.trim();
    if (!text) return;
    const words = alt?.words ?? [];
    const first = words[0];
    const last = words[words.length - 1];
    const startS = first ? first.start : (msg.start ?? 0);
    const endS = last ? last.end : (msg.start ?? 0) + (msg.duration ?? 0);
    this.emit("transcript", { text, isFinal: Boolean(msg.is_final), startMs: startS * 1000, endMs: endS * 1000 });
  }

  write(audio: Buffer): void {
    if (this.closing) return;
    if (this.open) this.ws.send(audio);
    else if (this.ws.readyState === WebSocket.CONNECTING) this.queue.push(audio);
  }

  close(): void {
    this.closing = true;
    clearInterval(this.keepAlive);
    if (this.open) this.ws.send(JSON.stringify({ type: "CloseStream" }));
    // Deepgram closes after flushing; this is the backstop if it does not.
    setTimeout(() => this.ws.terminate(), 1000).unref();
  }
}

/** An `SttFactory` that opens one Deepgram stream per call. */
export function deepgramStt(cfg: DeepgramConfig): SttFactory {
  return (opts) => new DeepgramStt(cfg, opts);
}
