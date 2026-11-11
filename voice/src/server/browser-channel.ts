/**
 * A browser tab as a voice channel. The page speaks each line with the browser's own speech
 * synthesis and reports what it played; it listens with the browser's speech recognition (or a
 * typed box, or an on-screen keypad) and reports each turn. The server decides everything else.
 * The page's hang-up button sends "hangup": the interview ends as it does when a caller hangs
 * up, but the connection stays open so the page can still be told how the answers were read.
 *
 * The page is an untrusted client: every message from it is checked before use.
 */

import type { SpokenLine } from "../interviewer/protocol.js";
import type { Played, Turn, VoiceChannel } from "../voice/call.js";

/** The slice of a WebSocket this needs. */
export interface Socket {
  send(data: string): void;
  close(): void;
  on(event: "message", cb: (data: { toString(): string }) => void): void;
  on(event: "close", cb: () => void): void;
}

export const MAX_REPLY_CHARS = 500;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 86_400_000 ? Math.round(v) : null);

export class BrowserChannel implements VoiceChannel {
  private closed = false;
  /** The visitor pressed hang up: nothing more is asked of the page. */
  private hungUp = false;
  private waiting: { type: "played" | "turn"; resolve: (msg: Record<string, unknown> | null) => void } | null = null;
  private lastMs = 0;

  constructor(private readonly socket: Socket) {
    socket.on("message", (data) => {
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
        w.resolve(m);
      }
    });
    socket.on("close", () => {
      this.closed = true;
      const w = this.waiting;
      this.waiting = null;
      w?.resolve(null);
    });
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
    const msg = await this.request({ type: "listen", waitMs }, "turn");
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
  }
}
