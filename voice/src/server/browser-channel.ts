/**
 * A browser tab as a voice channel. The page speaks each line with the browser's own speech
 * synthesis and reports what it played; it listens with the browser's speech recognition (or a
 * typed box, or an on-screen keypad) and reports each turn. The server decides everything else.
 * The page's hang-up button sends "hangup": the interview ends as it does when a caller hangs
 * up, but the connection stays open so the page can still be told how the answers were read.
 *
 *
 * When the server has a recogniser, the page can instead send its microphone here: sound arrives
 * as binary messages, the recogniser turns it into words, and this decides when the visitor has
 * finished speaking, the same way a phone call does. Typed replies and the keypad still work.
 *
 * The page is an untrusted client: every message from it is checked before use.
 */

import type { SpokenLine } from "../interviewer/protocol.js";
import type { SttFactory, SttStream } from "../telephony/stt.js";
import type { TranscriptEvent } from "../telephony/types.js";
import type { Played, Turn, VoiceChannel } from "../voice/call.js";

/** The slice of a WebSocket this needs. */
export interface Socket {
  send(data: string): void;
  close(): void;
  on(event: "message", cb: (data: Buffer | { toString(): string }, isBinary?: boolean) => void): void;
  on(event: "close", cb: () => void): void;
}

export const MAX_REPLY_CHARS = 500;
/** The page sends its microphone as 16-bit samples at this rate. */
export const MIC_SAMPLE_RATE = 16_000;
const MAX_FRAME_BYTES = 64 * 1024;

export interface HearingOptions {
  /** Opens a recogniser for one visitor's microphone. */
  stt: SttFactory;
  /** Quiet time after the last recognised words before the turn is taken as finished. */
  endOfTurnMs?: number;
  /** The most microphone sound one interview may send to the recogniser. */
  maxAudioMs?: number;
  /**
   * Whether words recognised while a line is playing stop the line. Off by default: through
   * loudspeakers the microphone can pick up the interviewer's own voice, and the page then sends
   * no sound while a line plays.
   */
  bargeIn?: boolean;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 86_400_000 ? Math.round(v) : null);

export class BrowserChannel implements VoiceChannel {
  private closed = false;
  /** The visitor pressed hang up: nothing more is asked of the page. */
  private hungUp = false;
  private waiting: { type: "played" | "turn"; resolve: (msg: Record<string, unknown> | null) => void } | null = null;
  private lastMs = 0;

  // Hearing by the server's recogniser. Recogniser times count from the first sound sent; `marks`
  // ties them to the page's clock (each piece of sound arrives stamped with the page's time).
  private stt: SttStream | null = null;
  private deaf = false;
  private streamMs = 0;
  private marks: { streamMs: number; pageMs: number }[] = [];
  /** Recogniser results for sound up to this point are ignored: they belong to a turn already taken. */
  private cutStreamMs = 0;
  private finals: string[] = [];
  private interim = "";
  private speechStartMs: number | null = null;
  private speechEndMs = 0;
  private lastHeardAt = 0;
  private quiet: NodeJS.Timeout | null = null;

  constructor(
    private readonly socket: Socket,
    private readonly hearing?: HearingOptions,
  ) {
    socket.on("message", (data, isBinary) => {
      if (isBinary) return this.onSound(data as Buffer);
      let msg: unknown;
      try {
        msg = JSON.parse(data.toString().slice(0, 20_000));
      } catch {
        return;
      }
      if (typeof msg !== "object" || msg === null) return;
      const m = msg as Record<string, unknown>;
      if (m.type === "hangup") {
        this.hungUp = true;
        const w = this.waiting;
        this.waiting = null;
        w?.resolve(null);
        return;
      }
      if (this.waiting && m.type === this.waiting.type) {
        const w = this.waiting;
        this.waiting = null;
        // A typed or keyed reply replaces anything half heard.
        if (m.type === "turn") this.forget();
        w.resolve(m);
      }
    });
    socket.on("close", () => {
      this.closed = true;
      this.end();
      const w = this.waiting;
      this.waiting = null;
      w?.resolve(null);
    });
  }

  /** The words the server's recogniser can hear with, or null when the page listens by itself. */
  get hears(): boolean {
    return this.hearing !== undefined && !this.deaf;
  }

  /** One piece of microphone sound: the page's clock (4 bytes), then 16-bit samples. */
  private onSound(frame: Buffer): void {
    if (!this.hearing || this.deaf || this.closed || this.hungUp) return;
    if (!Buffer.isBuffer(frame) || frame.length < 6 || frame.length > MAX_FRAME_BYTES || (frame.length - 4) % 2 !== 0) return;
    if (this.streamMs > (this.hearing.maxAudioMs ?? 8 * 60_000)) return this.goDeaf("the interview has run longer than this demo listens for");
    if (!this.stt) {
      try {
        this.stt = this.hearing.stt({ encoding: "linear16", sampleRate: MIC_SAMPLE_RATE });
      } catch (err) {
        return this.goDeaf(err instanceof Error ? err.message : "the recogniser could not be started");
      }
      this.stt.on("transcript", (e) => this.onTranscript(e));
      this.stt.on("utteranceEnd", () => this.finishSpeech());
      this.stt.on("error", (err) => this.goDeaf(err.message));
    }
    this.marks.push({ streamMs: this.streamMs, pageMs: frame.readUInt32LE(0) });
    if (this.marks.length > 600) this.marks.splice(0, 200);
    const sound = frame.subarray(4);
    this.streamMs += (sound.length / 2 / MIC_SAMPLE_RATE) * 1000;
    this.stt.write(sound);
  }

  /** A recogniser time, on the page's clock. */
  private pageMs(streamMs: number): number {
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i]!;
      if (m.streamMs <= streamMs) return Math.round(m.pageMs + (streamMs - m.streamMs));
    }
    return this.marks[0]?.pageMs ?? this.lastMs;
  }

  private onTranscript(e: TranscriptEvent): void {
    const text = e.text.trim();
    if (text === "" || this.closed || this.hungUp || e.endMs <= this.cutStreamMs) return;
    if (this.speechStartMs === null) this.speechStartMs = this.pageMs(e.startMs);
    this.lastHeardAt = Date.now();
    if (e.isFinal) {
      this.finals.push(text);
      this.interim = "";
      this.speechEndMs = this.pageMs(e.endMs);
    } else this.interim = text;
    this.tell({ type: "heard", text: [...this.finals, this.interim].filter(Boolean).join(" ").slice(0, MAX_REPLY_CHARS), final: false });
    // One speaker at a time: the visitor's words stop the line that is playing.
    if (this.waiting?.type === "played" && this.hearing?.bargeIn) this.tell({ type: "stop" });
    this.armQuiet(this.hearing?.endOfTurnMs ?? 700);
  }

  private armQuiet(ms: number): void {
    if (this.quiet) clearTimeout(this.quiet);
    this.quiet = setTimeout(() => this.finishSpeech(), ms);
  }

  /** Take what has been heard as the visitor's turn, if a turn is being waited for and words were finalised. */
  private finishSpeech(): void {
    if (this.finals.length === 0 || this.waiting?.type !== "turn") return;
    const text = this.finals.join(" ").slice(0, MAX_REPLY_CHARS);
    const startedMs = this.speechStartMs ?? this.speechEndMs;
    const msg = { type: "turn", kind: "speech", text, startedMs, endedMs: Math.max(this.speechEndMs, startedMs) };
    const w = this.waiting;
    this.waiting = null;
    this.forget();
    this.tell({ type: "heard", text, final: true });
    w.resolve(msg);
  }

  /** Drop anything half heard; later results for sound already sent are ignored. */
  private forget(): void {
    if (this.quiet) clearTimeout(this.quiet);
    this.quiet = null;
    this.finals = [];
    this.interim = "";
    this.speechStartMs = null;
    this.cutStreamMs = this.streamMs;
  }

  /** The recogniser failed or its allowance ran out: say so, and let the page fall back to typing. */
  private goDeaf(reason: string): void {
    if (this.deaf) return;
    this.deaf = true;
    this.stt?.close();
    this.stt = null;
    this.forget();
    this.tell({ type: "deaf", reason: reason.slice(0, 200) });
  }

  /** Release the recogniser. Safe to call more than once. */
  end(): void {
    if (this.quiet) clearTimeout(this.quiet);
    this.quiet = null;
    this.stt?.close();
    this.stt = null;
  }

  private request(payload: object, reply: "played" | "turn"): Promise<Record<string, unknown> | null> {
    if (this.closed || this.hungUp) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.waiting = { type: reply, resolve };
      this.socket.send(JSON.stringify(payload));
    });
  }

  /** Tell the page something that needs no reply (for example the end-of-call summary). */
  tell(payload: object): void {
    if (!this.closed) this.socket.send(JSON.stringify(payload));
  }

  async speak(lines: SpokenLine[]): Promise<Played[]> {
    if (lines.length === 0) return [];
    const msg = await this.request({ type: "speak", lines: lines.map((l) => ({ id: l.id, text: l.text })) }, "played");
    if (!msg || !Array.isArray(msg.played)) return [];
    // Only lines that were actually sent, in the order sent, count as played.
    const played: Played[] = [];
    for (const [i, raw] of (msg.played as unknown[]).slice(0, lines.length).entries()) {
      if (typeof raw !== "object" || raw === null) break;
      const p = raw as Record<string, unknown>;
      const startedMs = num(p.startedMs);
      const endedMs = num(p.endedMs);
      if (p.lineId !== lines[i]!.id || startedMs === null || endedMs === null || endedMs < startedMs || startedMs < this.lastMs) break;
      const completed = p.completed === true;
      played.push({ lineId: lines[i]!.id, startedMs, endedMs, completed });
      this.lastMs = endedMs;
      if (!completed) break;
    }
    return played;
  }

  async listen(waitMs: number): Promise<Turn> {
    // Without cutting in, nothing heard before the line finished can be an answer to it.
    if (this.hearing && !this.hearing.bargeIn) this.forget();
    const asked = this.request({ type: "listen", waitMs }, "turn");
    // Words finalised while the line was still playing (cutting in) may already be a whole turn.
    if (this.finals.length > 0) this.armQuiet(Math.max(0, (this.hearing?.endOfTurnMs ?? 700) - (Date.now() - this.lastHeardAt)));
    const msg = await asked;
    if (!msg) return { kind: "hangup", atMs: this.lastMs };
    const startedMs = Math.max(num(msg.startedMs) ?? this.lastMs, 0);
    const endedMs = Math.max(num(msg.endedMs) ?? startedMs, startedMs);
    this.lastMs = Math.max(this.lastMs, endedMs);
    if (msg.kind === "speech" && typeof msg.text === "string" && msg.text.trim() !== "") {
      return { kind: "speech", text: msg.text.slice(0, MAX_REPLY_CHARS), startedMs, endedMs };
    }
    if (msg.kind === "keys" && typeof msg.digits === "string" && /^[0-9*#]{1,8}$/.test(msg.digits)) return { kind: "keys", digits: msg.digits, atMs: startedMs };
    return { kind: "silence", atMs: endedMs };
  }

  async hangup(): Promise<void> {
    // The page shows the summary first; it closes the connection itself.
    this.end();
  }
}
