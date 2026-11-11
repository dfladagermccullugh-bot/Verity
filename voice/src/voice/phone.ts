/**
 * A phone call as a voice channel: plays pre-rendered lines into the call and turns what the
 * carrier and the speech recogniser report into respondent turns.
 *
 * Playback stops the moment the respondent's words are recognised or a key is pressed. Stopping
 * on recognised words rather than on raw sound means a cough or line noise does not cut the
 * question off, at the cost of a fraction of a second.
 */

import type { SpokenLine } from "../interviewer/protocol.js";
import { sleepCall, type CallSession, type TranscriptEvent } from "../telephony/types.js";
import type { Played, Turn, VoiceChannel } from "./call.js";

export interface PhoneOptions {
  /** The audio for a line: 8 kHz mu-law. */
  audio: (line: SpokenLine) => Promise<Buffer>;
  /** Quiet time after the last recognised words before the turn is taken as finished. */
  endOfTurnMs: number;
  /** Quiet time after a key press before the keys are taken as complete ("#" ends them at once). */
  keyGapMs: number;
  /** Longest wait for speech that has begun to turn into recognised words. */
  maxTurnMs: number;
  /**
   * People answer the phone with "hello". Anything that began before the interviewer's first
   * words, or within this long after they began, is that greeting: it does not stop the
   * introduction and is not taken as a reply to anything.
   */
  greetingGraceMs: number;
}

export const DEFAULT_PHONE_OPTIONS: Omit<PhoneOptions, "audio"> = { endOfTurnMs: 700, keyGapMs: 1500, maxTurnMs: 30_000, greetingGraceMs: 800 };

export class PhoneChannel implements VoiceChannel {
  private playing = false;
  private speechStartMs: number | null = null;
  private finals: TranscriptEvent[] = [];
  private lastHeardMs = 0;
  private utteranceEnded = false;
  private digits = "";
  private lastKeyMs = 0;
  private firstKeyMs = 0;
  private wake: (() => void) | null = null;
  /** When the interviewer's first words began, in call time. Null until then. */
  private firstAudioMs: number | null = null;

  constructor(
    private readonly session: CallSession,
    private readonly opts: PhoneOptions,
  ) {
    session.on("speechStart", (atMs) => {
      if (this.isGreeting(atMs)) return;
      if (this.speechStartMs === null) this.speechStartMs = atMs;
      this.poke();
    });
    session.on("transcript", (e) => {
      if (e.text.trim() === "" || this.isGreeting(e.startMs)) return;
      if (this.speechStartMs === null) this.speechStartMs = e.startMs;
      this.lastHeardMs = this.session.now();
      if (e.isFinal) {
        this.finals.push(e);
        this.utteranceEnded = false;
      }
      this.interrupt();
      this.poke();
    });
    session.on("utteranceEnd", () => {
      if (this.finals.length > 0) this.utteranceEnded = true;
      this.poke();
    });
    session.on("dtmf", (digit, atMs) => {
      if (this.digits === "") this.firstKeyMs = atMs;
      this.digits += digit;
      this.lastKeyMs = this.session.now();
      this.interrupt();
      this.poke();
    });
    session.on("ended", () => this.poke());
  }

  private isGreeting(startMs: number): boolean {
    return this.firstAudioMs === null || startMs < this.firstAudioMs + this.opts.greetingGraceMs;
  }

  private poke(): void {
    const w = this.wake;
    this.wake = null;
    w?.();
  }

  private interrupt(): void {
    if (this.playing) void this.session.clearPlayback();
  }

  private turnBegun(): boolean {
    return this.finals.length > 0 || this.digits !== "";
  }

  async speak(lines: SpokenLine[]): Promise<Played[]> {
    const played: Played[] = [];
    for (const line of lines) {
      if (this.session.ended || this.turnBegun()) break;
      const audio = await this.opts.audio(line);
      const startedMs = this.session.now();
      if (this.firstAudioMs === null) this.firstAudioMs = startedMs;
      this.playing = true;
      const result = await this.session.play(audio, line.id);
      this.playing = false;
      played.push({ lineId: line.id, startedMs, endedMs: this.session.now(), completed: result.completed });
      if (!result.completed) break;
    }
    return played;
  }

  async listen(waitMs: number): Promise<Turn> {
    const began = this.session.now();
    for (;;) {
      const now = this.session.now();
      if (this.session.ended) return { kind: "hangup", atMs: now };
      if (this.digits !== "" && (this.digits.endsWith("#") || this.digits === "*" || now - this.lastKeyMs >= this.opts.keyGapMs)) {
        const turn: Turn = { kind: "keys", digits: this.digits, atMs: this.firstKeyMs };
        this.reset();
        return turn;
      }
      if (this.digits === "" && this.finals.length > 0 && (this.utteranceEnded || now - this.lastHeardMs >= this.opts.endOfTurnMs)) {
        const first = this.finals[0]!;
        const last = this.finals[this.finals.length - 1]!;
        const turn: Turn = { kind: "speech", text: this.finals.map((f) => f.text.trim()).join(" "), startedMs: Math.min(this.speechStartMs ?? first.startMs, first.startMs), endedMs: last.endMs };
        this.reset();
        return turn;
      }
      const speaking = this.speechStartMs !== null || this.turnBegun();
      if (!speaking && now - began >= waitMs) return { kind: "silence", atMs: now };
      if (speaking && !this.turnBegun() && now - began >= waitMs + this.opts.maxTurnMs) {
        // Sound was detected but never became words.
        this.reset();
        return { kind: "silence", atMs: now };
      }
      await Promise.race([new Promise<void>((resolve) => (this.wake = resolve)), sleepCall(this.session, 100)]);
    }
  }

  private reset(): void {
    this.speechStartMs = null;
    this.finals = [];
    this.utteranceEnded = false;
    this.digits = "";
  }

  async hangup(): Promise<void> {
    await this.session.hangup();
  }
}
