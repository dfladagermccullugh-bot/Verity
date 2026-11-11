/**
 * Runs the interviewer as a spoken conversation over any audio channel: the browser, a phone
 * line, or a scripted stand-in for tests. One speaker at a time: when the respondent starts to
 * talk, playback stops, and where it stopped is logged. Response time is measured from the end
 * of the question audio to the start of the reply.
 */

import type { Interviewer } from "../interviewer/interviewer.js";
import type { SpokenLine } from "../interviewer/protocol.js";

/** What became of one line that was sent to be played. Times are milliseconds since the call began. */
export interface Played {
  lineId: string;
  startedMs: number;
  endedMs: number;
  /** False when the respondent started talking before the line finished. */
  completed: boolean;
}

export type Turn =
  | { kind: "speech"; text: string; startedMs: number; endedMs: number }
  | { kind: "keys"; digits: string; atMs: number }
  /** Nothing was said within the waiting time. */
  | { kind: "silence"; atMs: number }
  | { kind: "hangup"; atMs: number };

/** An audio channel to one respondent. */
export interface VoiceChannel {
  /**
   * Play the lines in order and return what happened to each. Lines not started because the
   * respondent interrupted are left out. Must stop playing as soon as the respondent speaks.
   */
  speak(lines: SpokenLine[]): Promise<Played[]>;
  /** Wait for the respondent's next turn (which may already have begun during playback). */
  listen(waitMs: number): Promise<Turn>;
  hangup(): Promise<void>;
}

export interface VoiceOptions {
  /** How long to wait for a reply before treating the line as silent. */
  replyWaitMs: number;
  /** Silent turns in a row before the call is ended. */
  maxSilences: number;
}

export const DEFAULT_VOICE_OPTIONS: VoiceOptions = { replyWaitMs: 8000, maxSilences: 3 };

export interface VoiceCallResult {
  /** True when the respondent hung up or the line went dead before the interviewer finished. */
  dropped: boolean;
}

export async function runVoiceCall(interviewer: Interviewer, channel: VoiceChannel, options: VoiceOptions = DEFAULT_VOICE_OPTIONS): Promise<VoiceCallResult> {
  let lines = interviewer.open();
  let silences = 0;
  for (;;) {
    const played = await channel.speak(lines);
    for (const p of played) interviewer.note({ seq: 0, type: "played", ...p });
    if (interviewer.ended) {
      await channel.hangup();
      return { dropped: false };
    }
    const expecting = interviewer.expecting();
    const slot = expecting.kind === "answer" ? expecting.slot : undefined;
    // The question counts as fully heard only if every line asked for was played to the end.
    const heardInFull = played.length === lines.length && played.every((p) => p.completed);
    const audioEndedMs = played.length > 0 ? played[played.length - 1]!.endedMs : 0;

    const turn = await channel.listen(options.replyWaitMs);
    if (turn.kind === "hangup") {
      interviewer.abandon("the respondent hung up");
      return { dropped: true };
    }
    if (turn.kind === "silence") {
      interviewer.note({ seq: 0, type: "turn", via: "silence", startedMs: turn.atMs, endedMs: turn.atMs, ...(slot ? { slot } : {}) });
      silences += 1;
      if (silences >= options.maxSilences) {
        interviewer.abandon(`no reply ${silences} times in a row`);
        await channel.hangup();
        return { dropped: true };
      }
      lines = await interviewer.hear("");
      continue;
    }
    silences = 0;
    const startedMs = turn.kind === "speech" ? turn.startedMs : turn.atMs;
    const endedMs = turn.kind === "speech" ? turn.endedMs : turn.atMs;
    // Latency is only meaningful when the whole question was heard before the reply began.
    const latency = slot && heardInFull && startedMs >= audioEndedMs ? { latencyMs: startedMs - audioEndedMs } : {};
    interviewer.note({ seq: 0, type: "turn", via: turn.kind === "speech" ? "speech" : "keys", startedMs, endedMs, ...(slot ? { slot } : {}), ...latency });
    const before = Object.keys(interviewer.state.interview.answers).length;
    lines = turn.kind === "speech" ? await interviewer.hear(turn.text) : await interviewer.hearKeys(turn.digits);
    // An answer given before the question and its options were heard in full is kept, and flagged:
    // the respondent may not have heard every option.
    if (slot && !heardInFull && Object.keys(interviewer.state.interview.answers).length > before) {
      const a = interviewer.state.interview.answers[slot];
      if (a && a.kind !== "nonresponse") interviewer.flag(slot, "answered before the question and options were heard in full");
    }
  }
}
