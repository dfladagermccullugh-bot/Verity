/**
 * A scripted voice channel for tests: a persona who "speaks" with timings on a virtual clock.
 * Nothing sleeps, so thousands of spoken calls run in a moment.
 */

import type { Expecting } from "../interviewer/interviewer.js";
import type { SpokenLine } from "../interviewer/protocol.js";
import type { Played, Turn, VoiceChannel } from "./call.js";

/** What the scripted respondent does after hearing (some of) what was said. */
export type SpokenReply =
  | { say: string; afterMs?: number; durationMs?: number; /** Start talking this far into the playback (0–1) instead of waiting for it to end. */ interruptAt?: number }
  | { keys: string; afterMs?: number }
  | { silence: true }
  | { hangup: true };

export type SpokenPersona = (ctx: { said: SpokenLine[]; turn: number }) => SpokenReply;

/** Speaking rate used to give each line a duration. */
export const CHARS_PER_SECOND = 15;

export class ScriptedVoice implements VoiceChannel {
  now = 0;
  readonly heard: { lineId: string; completed: boolean }[] = [];
  hungUp = false;
  private pending: SpokenReply | null = null;
  private turn = 0;

  constructor(private readonly persona: SpokenPersona) {}

  async speak(lines: SpokenLine[]): Promise<Played[]> {
    this.turn += 1;
    const reply = lines.length > 0 ? this.persona({ said: lines, turn: this.turn }) : { silence: true as const };
    this.pending = reply;
    const durations = lines.map((l) => Math.max(300, Math.round((l.text.length / CHARS_PER_SECOND) * 1000)));
    const total = durations.reduce((a, b) => a + b, 0);
    const cutAt = "say" in reply && reply.interruptAt !== undefined ? this.now + Math.floor(total * reply.interruptAt) : Infinity;
    const played: Played[] = [];
    for (let i = 0; i < lines.length; i++) {
      const startedMs = this.now;
      if (startedMs >= cutAt) break;
      const naturalEnd = startedMs + durations[i]!;
      const endedMs = Math.min(naturalEnd, cutAt);
      const completed = endedMs === naturalEnd;
      played.push({ lineId: lines[i]!.id, startedMs, endedMs, completed });
      this.heard.push({ lineId: lines[i]!.id, completed });
      this.now = endedMs;
      if (!completed) break;
    }
    return played;
  }

  async listen(waitMs: number): Promise<Turn> {
    const reply = this.pending ?? { silence: true as const };
    this.pending = null;
    if ("hangup" in reply) return { kind: "hangup", atMs: this.now };
    if ("silence" in reply) {
      this.now += waitMs;
      return { kind: "silence", atMs: this.now };
    }
    if ("keys" in reply) {
      this.now += reply.afterMs ?? 1200;
      return { kind: "keys", digits: reply.keys, atMs: this.now };
    }
    const startedMs = reply.interruptAt !== undefined ? this.now : this.now + (reply.afterMs ?? 900);
    const endedMs = startedMs + (reply.durationMs ?? Math.max(400, Math.round((reply.say.length / CHARS_PER_SECOND) * 1000)));
    this.now = endedMs;
    return { kind: "speech", text: reply.say, startedMs, endedMs };
  }

  async hangup(): Promise<void> {
    this.hungUp = true;
  }
}

/** Build a spoken persona from per-question replies, keyed like the transcript personas. */
export function spokenPersona(expecting: () => Expecting, replies: Record<string, SpokenReply>, fallback: SpokenReply = { say: "I don't know" }): SpokenPersona {
  return () => {
    const e = expecting();
    const key = e.kind === "answer" ? e.slot : e.kind;
    return replies[key] ?? (e.kind === "consent" || e.kind === "recording" ? { say: "yes" } : fallback);
  };
}
