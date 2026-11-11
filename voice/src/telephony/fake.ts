/**
 * An in-memory call for tests: the same `CallSession` API as a carrier, with no network.
 *
 * It keeps what a carrier would do to the audio (play clips in order, one at a time, each taking
 * its real length in call time) and lets a test stand in for the respondent: speak, press keys,
 * hang up. `timeScale` below 1 runs the call faster than real time.
 *
 * New in this package. The timing idea (call time and `timeScale`) is from phone_map
 * `server/telephony/simulator.ts`; its scripted phone menus are not carried over.
 */

import { mulawDurationMs } from "./audio.js";
import { CallSession, type AudioState, type MachineResult, type PlayResult, type TranscriptEvent } from "./types.js";

/** One `play` call, as the test can inspect it afterwards. */
export interface FakePlay {
  markName: string;
  mulaw: Buffer;
  durationMs: number;
  /** Call time the clip began to play; null while it waits its turn or if it never started. */
  startMs: number | null;
  /** Call time the clip finished or was cut off; null until then. */
  endMs: number | null;
  /** Null while queued or playing. */
  completed: boolean | null;
}

interface Queued {
  record: FakePlay;
  resolve: (r: PlayResult) => void;
}

export class FakeCallSession extends CallSession {
  readonly provider = "fake";
  readonly timeScale: number;
  /** Every clip handed to `play`, in order. */
  readonly played: FakePlay[] = [];
  /** Every digit string handed to `sendDigits`. */
  readonly digitsSent: string[] = [];
  private queue: Queued[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(opts: { timeScale?: number } = {}) {
    super();
    this.timeScale = opts.timeScale ?? 1;
  }

  // ── what the far end does: called by the test ──────────────────────────────

  /** The respondent (or their voicemail) picks up. Audio queued so far starts to play. */
  answer(): void {
    if (this.answered) return;
    this.markAnswered();
    this.startNext(0);
  }

  /** The respondent says this, as the listener would report it. Defaults: a final transcript ending now. */
  say(text: string, opts: { isFinal?: boolean; startMs?: number; endMs?: number } = {}): void {
    const endMs = opts.endMs ?? this.now();
    const e: TranscriptEvent = { text, isFinal: opts.isFinal ?? true, startMs: opts.startMs ?? endMs, endMs };
    if (opts.startMs === undefined) e.estimated = true;
    this.emit("transcript", e);
  }

  speechStart(atMs = this.now()): void {
    this.emit("speechStart", atMs);
  }

  utteranceEnd(atMs = this.now()): void {
    this.emit("utteranceEnd", atMs);
  }

  audioState(state: AudioState, atMs = this.now()): void {
    this.emit("audio", state, atMs);
  }

  pressKey(digit: string): void {
    this.emit("dtmf", digit, this.now());
  }

  machineDetected(result: MachineResult): void {
    this.emit("machine", result);
  }

  remoteHangup(reason = "remote-hangup"): void {
    this.finish(reason);
  }

  // ── the CallSession API ────────────────────────────────────────────────────

  play(mulaw: Buffer, markName: string): Promise<PlayResult> {
    const record: FakePlay = { markName, mulaw, durationMs: mulawDurationMs(mulaw), startMs: null, endMs: null, completed: null };
    this.played.push(record);
    if (this.ended) {
      record.completed = false;
      return Promise.resolve({ completed: false });
    }
    return new Promise((resolve) => {
      this.queue.push({ record, resolve });
      this.startNext();
    });
  }

  async clearPlayback(): Promise<void> {
    this.dropPlays();
  }

  async sendDigits(digits: string): Promise<void> {
    this.digitsSent.push(digits);
  }

  async hangup(): Promise<void> {
    this.finish("agent-hangup");
  }

  /**
   * Play the head of the queue, if the call is up and nothing is playing. Recorded times are
   * the nominal ones (a clip ends its length after it starts, and the next starts right then),
   * so tests can assert exact timings whatever the timers do.
   */
  private startNext(atMs = this.now()): void {
    const head = this.queue[0];
    if (!head || this.timer || !this.answered || this.ended) return;
    const endMs = atMs + head.record.durationMs;
    head.record.startMs = atMs;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.queue.shift();
      head.record.endMs = endMs;
      head.record.completed = true;
      head.resolve({ completed: true });
      this.emit("mark", head.record.markName);
      this.startNext(endMs);
    }, head.record.durationMs * this.timeScale);
  }

  private dropPlays(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const dropped = this.queue;
    this.queue = [];
    for (const q of dropped) {
      if (q.record.startMs !== null) q.record.endMs = Math.max(q.record.startMs, this.now());
      q.record.completed = false;
      q.resolve({ completed: false });
    }
  }

  private finish(reason: string): void {
    if (this.ended) return;
    this.dropPlays();
    this.markEnded(reason);
  }
}
