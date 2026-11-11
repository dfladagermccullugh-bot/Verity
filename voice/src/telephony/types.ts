/**
 * The call abstraction: one live outbound phone call, whatever carries it.
 *
 * Origin: phone_map `server/telephony/types.ts`. Changed here: the call can now speak (`play`,
 * `clearPlayback`, `mark`), reports key presses (`dtmf`), speech boundaries (`speechStart`,
 * `utteranceEnd`) and the answering-machine verdict (`machine`). `canCall` is gone: it chose
 * between the IVR simulator and a carrier, and there is one carrier here.
 */

import { EventEmitter } from "node:events";

export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
  /** Start and end of the utterance in call-time ms (ms since the call was answered). */
  startMs: number;
  endMs: number;
  /** Timings are estimated (the listener gave no word timestamps); endMs is the arrival time. */
  estimated?: boolean;
}

export type AudioState = "silence" | "speech" | "music" | "ringback";

/** "unknown" means the carrier could not tell; treat it as a person. */
export type MachineResult = "human" | "machine" | "unknown";

export interface PlayResult {
  /** True when the carrier confirmed the audio played to its end; false when it was cleared or the call ended first. */
  completed: boolean;
}

/** All times are call-time ms. */
export interface CallSessionEventMap {
  answered: [];
  transcript: [TranscriptEvent];
  /** The respondent started speaking, at this time. The cue to stop talking. */
  speechStart: [number];
  /** The respondent's utterance is over; the time is the end of their last word. */
  utteranceEnd: [number];
  audio: [AudioState, number];
  /** A key the respondent pressed, and when it reached us. */
  dtmf: [string, number];
  /** Audio queued under this mark name played to its end. Not emitted for cleared audio. */
  mark: [string];
  /** Answering-machine detection result. Only when the call was started with `amd`. */
  machine: [MachineResult];
  ended: [string];
}

/**
 * A live outbound call. All times are "call time" ms; a test session may run faster than real
 * time, which is expressed by `timeScale` (real ms = call ms * timeScale).
 */
export abstract class CallSession extends EventEmitter<CallSessionEventMap> {
  abstract readonly provider: string;
  abstract readonly timeScale: number;
  providerCallId: string | null = null;
  ended = false;
  endReason: string | null = null;
  answered = false;
  private answeredAtReal = 0;

  /** ms of call time since answer. */
  now(): number {
    if (!this.answered) return 0;
    return (Date.now() - this.answeredAtReal) / this.timeScale;
  }

  protected markAnswered(): void {
    if (this.answered) return;
    this.answered = true;
    this.answeredAtReal = Date.now();
    this.emit("answered");
  }

  protected markEnded(reason: string): void {
    if (this.ended) return;
    this.ended = true;
    this.endReason = reason;
    this.emit("ended", reason);
  }

  /**
   * Queue 8 kHz mu-law audio to the respondent. Audio plays in the order queued; audio queued
   * before the call is answered starts at answer. Resolves when the carrier confirms this audio
   * finished, or with `completed: false` when it was cleared or the call ended first. Never
   * rejects. `markName` labels the audio in the `mark` event; it need not be unique.
   */
  abstract play(mulaw: Buffer, markName: string): Promise<PlayResult>;

  /** Stop what is playing and drop everything queued. Pending `play` calls resolve `completed: false`. */
  abstract clearPlayback(): Promise<void>;

  /** Send DTMF digits (0-9, *, #). Resolves once the tones have been played. */
  abstract sendDigits(digits: string): Promise<void>;
  abstract hangup(): Promise<void>;
}

export interface StartCallOptions {
  maxDurationSeconds: number;
  /** Ask the carrier to say whether a person or an answering machine picked up. */
  amd?: boolean;
}

export interface TelephonyProvider {
  readonly name: string;
  startCall(e164: string, opts: StartCallOptions): Promise<CallSession>;
}

/** Sleep for `ms` of call time. */
export function sleepCall(session: { timeScale: number }, ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms * session.timeScale)));
}
