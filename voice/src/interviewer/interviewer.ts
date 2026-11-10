/**
 * The interviewer: a deterministic state machine that runs one call.
 *
 * It decides what to say next from the survey logic and fixed rules. It can only speak lines
 * from the campaign's speech table (looked up by id), so nothing off-script can be said. A model
 * is used only to classify what the respondent said, and its verdict is checked in code first.
 * Every line spoken, every utterance heard and every decision is appended to an audit log.
 */

import type { Answer, Instrument, Item, GridRow } from "../instrument/types.js";
import { emptyState, markHeard, nextStep, recordAnswer, type InterviewState, type Step } from "../engine/flow.js";
import { linesForStep, type Script, type ScriptId } from "../script/script.js";
import { classify, type Classification, type ModelClassifier } from "./classify.js";
import type { ProtocolKey, SpeechTable, SpokenLine } from "./protocol.js";

export type Outcome = "complete" | "breakoff" | "consent_declined" | "opt_out" | "callback";

export interface Policy {
  /** An answer at or above this confidence is recorded without a probe. */
  acceptAt: number;
  /** Probes allowed per question before it is coded as no answer. */
  maxProbes: number;
  /** Times a question is repeated on request before the request counts as unclear. */
  maxRepeats: number;
}

export const DEFAULT_POLICY: Policy = { acceptAt: 0.85, maxProbes: 2, maxRepeats: 2 };

export type Phase = "not_started" | "consent" | "recording" | "interview" | "ended";

/** Everything needed to resume a call. Plain data: safe to store and reload. */
export interface CallState {
  phase: Phase;
  interview: InterviewState;
  consent: { participate: boolean | null; recording: boolean | null };
  /** Probes and repeats used, by slot key ("consent" for the consent question). */
  attempts: Record<string, { probes: number; repeats: number }>;
  /** Slots whose recorded value should be checked by a person. */
  review: string[];
  outcome: Outcome | null;
}

export type AuditEvent = { seq: number } & (
  | { type: "say"; lineId: string; source: SpokenLine["source"]; text: string }
  | { type: "heard"; text: string }
  | { type: "classified"; expecting: "consent" | "recording" | "answer"; slot?: string; classification: Classification }
  | { type: "decision"; action: "record" | "probe" | "repeat" | "nonresponse" | "consent" | "end"; slot?: string; detail: string }
);

type AuditBody = AuditEvent extends infer E ? (E extends { seq: number } ? Omit<E, "seq"> : never) : never;

export type Expecting = { kind: "consent" } | { kind: "recording" } | { kind: "answer"; item: Item; row?: GridRow; slot: string } | { kind: "nothing" };

export function newCallState(interview: InterviewState = emptyState()): CallState {
  return { phase: "not_started", interview, consent: { participate: null, recording: null }, attempts: {}, review: [], outcome: null };
}

export interface InterviewerOptions {
  instrument: Instrument;
  script: Script;
  table: SpeechTable;
  model?: ModelClassifier;
  policy?: Policy;
  /** Answers from an earlier, interrupted call. Consent is always asked again. */
  resumeFrom?: InterviewState;
}

export class Interviewer {
  readonly log: AuditEvent[] = [];
  state: CallState;
  private readonly instrument: Instrument;
  private readonly script: Script;
  private readonly table: SpeechTable;
  private readonly model: ModelClassifier | undefined;
  private readonly policy: Policy;
  private readonly resumed: boolean;
  private out: SpokenLine[] = [];

  constructor(opts: InterviewerOptions) {
    this.instrument = opts.instrument;
    this.script = opts.script;
    this.table = opts.table;
    this.model = opts.model;
    this.policy = opts.policy ?? DEFAULT_POLICY;
    this.resumed = opts.resumeFrom !== undefined && Object.keys(opts.resumeFrom.answers).length > 0;
    this.state = newCallState(opts.resumeFrom ? { answers: { ...opts.resumeFrom.answers }, heard: [...opts.resumeFrom.heard] } : emptyState());
  }

  get ended(): boolean {
    return this.state.phase === "ended";
  }

  /** What kind of reply the interviewer is waiting for. */
  expecting(): Expecting {
    if (this.state.phase === "consent") return { kind: "consent" };
    if (this.state.phase === "recording") return { kind: "recording" };
    if (this.state.phase === "interview") {
      const step = nextStep(this.instrument, this.state.interview);
      if (step.kind === "ask") return step.row ? { kind: "answer", item: step.item, row: step.row, slot: step.slot.key } : { kind: "answer", item: step.item, slot: step.slot.key };
    }
    return { kind: "nothing" };
  }

  /** Start the call. Returns the lines to speak. */
  open(): SpokenLine[] {
    if (this.state.phase !== "not_started") throw new Error("The call has already started.");
    this.out = [];
    this.state.phase = "consent";
    this.sayKeys("intro", "purpose", "transcribed", "how_to_stop", "consent_ask");
    return this.flush();
  }

  /** Handle one respondent utterance. Returns the lines to speak in reply. */
  async hear(utterance: string): Promise<SpokenLine[]> {
    if (this.state.phase === "not_started") throw new Error("The call has not started.");
    if (this.state.phase === "ended") return [];
    this.out = [];
    this.push({ type: "heard", text: utterance });
    const expecting = this.expecting();
    if (expecting.kind === "consent" || expecting.kind === "recording") {
      const c = await classify({ utterance, expecting: "consent" }, this.model);
      this.push({ type: "classified", expecting: expecting.kind, classification: c });
      if (expecting.kind === "consent") this.onConsent(c);
      else this.onRecording(c);
    } else if (expecting.kind === "answer") {
      const c = await classify({ utterance, expecting: "answer", item: expecting.item }, this.model);
      this.push({ type: "classified", expecting: "answer", slot: expecting.slot, classification: c });
      this.onAnswer(expecting, c);
    }
    return this.flush();
  }

  // ── speaking: by line id only ──────────────────────────────────────────────

  private say(id: ScriptId | string): void {
    const line = this.table.lines.get(id as ScriptId);
    if (!line) throw new Error(`Refusing to speak "${id}": it is not in the approved speech table.`);
    this.out.push(line);
    this.push({ type: "say", lineId: line.id, source: line.source, text: line.text });
  }

  private sayKeys(...keys: ProtocolKey[]): void {
    for (const k of keys) this.say(`p.${k}`);
  }

  private sayStep(step: Step, repeatStem: boolean): void {
    for (const line of linesForStep(this.script, step, { repeatStem })) this.say(line.id);
  }

  private flush(): SpokenLine[] {
    const lines = this.out;
    this.out = [];
    return lines;
  }

  private push(e: AuditBody): void {
    this.log.push({ seq: this.log.length + 1, ...e } as AuditEvent);
  }

  private decide(action: Extract<AuditEvent, { type: "decision" }>["action"], detail: string, slot?: string): void {
    this.push(slot === undefined ? { type: "decision", action, detail } : { type: "decision", action, detail, slot });
  }

  private attempts(key: string): { probes: number; repeats: number } {
    return (this.state.attempts[key] ??= { probes: 0, repeats: 0 });
  }

  private end(outcome: Outcome, closing: ProtocolKey, detail: string): void {
    this.sayKeys(closing);
    this.state.phase = "ended";
    this.state.outcome = outcome;
    this.decide("end", `${outcome}: ${detail}`);
  }

  /** Handles the replies that mean the same thing at any point in the call. True when handled. */
  private common(c: Classification, beforeConsent: boolean): boolean {
    if (c.intent === "opt_out") this.end("opt_out", "opt_out_done", "respondent asked to be removed from the list");
    else if (c.intent === "stop") this.end(beforeConsent ? "consent_declined" : "breakoff", "stopped", "respondent asked to stop");
    else if (c.intent === "callback") this.end("callback", "callback", "respondent asked to be called another time");
    else return false;
    return true;
  }

  // ── consent ────────────────────────────────────────────────────────────────

  private onConsent(c: Classification): void {
    if (this.common(c, true)) return;
    const a = this.attempts("consent");
    if (c.intent === "yes" && c.confidence >= this.policy.acceptAt) {
      this.state.consent.participate = true;
      this.decide("consent", "agreed to take part");
      if (this.table.lines.has("p.recording_ask" as ScriptId)) {
        this.state.phase = "recording";
        this.sayKeys("recording_ask");
      } else this.begin();
      return;
    }
    if (c.intent === "no" && c.confidence >= this.policy.acceptAt) {
      this.state.consent.participate = false;
      return this.end("consent_declined", "consent_declined", "declined to take part");
    }
    if (c.intent === "repeat" && a.repeats < this.policy.maxRepeats) {
      a.repeats += 1;
      this.decide("repeat", "introduction repeated on request");
      return this.sayKeys("purpose", "transcribed", "how_to_stop", "consent_ask");
    }
    // Anything short of a clear yes is not consent.
    if (a.probes < this.policy.maxProbes) {
      a.probes += 1;
      this.decide("probe", "consent not clear; asked again");
      return this.sayKeys("consent_unclear");
    }
    this.state.consent.participate = false;
    this.end("consent_declined", "consent_declined", "no clear agreement after asking again");
  }

  private onRecording(c: Classification): void {
    if (this.common(c, false)) return;
    // Audio is kept only on a clear yes. Anything else means no, without pressing the point.
    const yes = c.intent === "yes" && c.confidence >= this.policy.acceptAt;
    this.state.consent.recording = yes;
    this.decide("consent", yes ? "agreed to audio being kept" : "audio will not be kept");
    this.begin();
  }

  private begin(): void {
    this.state.phase = "interview";
    this.sayKeys(this.resumed ? "resume" : "begin");
    this.advance(true);
  }

  // ── interview ──────────────────────────────────────────────────────────────

  /** Deliver read-only text and the next question, or close the call when the survey is done. */
  private advance(repeatStem: boolean): void {
    for (;;) {
      const step = nextStep(this.instrument, this.state.interview);
      if (step.kind === "end") return this.end("complete", "closing", step.reason === "completed" ? "all questions asked" : "survey logic ended the interview");
      this.sayStep(step, repeatStem);
      if (step.kind === "ask") return;
      this.state.interview = markHeard(this.instrument, this.state.interview, step.item.id);
    }
  }

  private current(): Extract<Step, { kind: "ask" }> {
    const step = nextStep(this.instrument, this.state.interview);
    if (step.kind !== "ask") throw new Error("No question is pending.");
    return step;
  }

  private record(slot: string, answer: Answer, detail: string, review: boolean): void {
    this.state.interview = recordAnswer(this.instrument, this.state.interview, slot, answer);
    if (review && !this.state.review.includes(slot)) this.state.review.push(slot);
    this.decide(answer.kind === "nonresponse" ? "nonresponse" : "record", review ? `${detail}; flagged for human review` : detail, slot);
  }

  /** Say the answer options again (and the grid statement), without the question itself. */
  private sayOptions(step: Extract<Step, { kind: "ask" }>): void {
    const lines = linesForStep(this.script, step, { repeatStem: true }).filter((l) => l.role === "options" || l.role === "row");
    if (lines.length === 0) return this.sayStep(step, true);
    for (const l of lines) this.say(l.id);
  }

  private onAnswer(expecting: Extract<Expecting, { kind: "answer" }>, c: Classification): void {
    if (this.common(c, false)) return;
    const { slot, item } = expecting;
    const step = this.current();
    const a = this.attempts(slot);
    const closed = item.kind === "single" || item.kind === "grid" || item.kind === "scale";
    const giveUp = () => {
      this.record(slot, { kind: "nonresponse", reason: "no_answer" }, `no usable answer after ${a.probes} probe${a.probes === 1 ? "" : "s"}`, true);
      this.sayKeys("moving_on");
      this.advance(false);
    };

    if (c.intent === "answer" && c.answer) {
      const ans = c.answer;
      if (ans.kind === "nonresponse") {
        if (ans.reason === "dont_know" && closed && a.probes < 1) {
          a.probes += 1;
          this.decide("probe", "said don't know; one neutral probe", slot);
          this.sayKeys("probe_dont_know");
          return this.sayOptions(step);
        }
        this.record(slot, ans, ans.reason === "refused" ? "declined to answer" : "don't know", false);
        this.sayKeys("moving_on");
        return this.advance(false);
      }
      if (c.confidence >= this.policy.acceptAt) {
        this.record(slot, ans, `answer accepted (${c.by}, confidence ${c.confidence.toFixed(2)})`, false);
        return this.advance(false);
      }
      if (a.probes < this.policy.maxProbes) {
        a.probes += 1;
        this.decide("probe", `answer not certain (confidence ${c.confidence.toFixed(2)}); asked for the closest option`, slot);
        if (item.kind === "number") {
          this.sayKeys("probe_number");
          return this.sayStep(step, true);
        }
        this.sayKeys("probe_closest");
        return this.sayOptions(step);
      }
      this.record(slot, ans, `best available answer after probes (confidence ${c.confidence.toFixed(2)})`, true);
      return this.advance(false);
    }

    if (c.intent === "repeat" && a.repeats < this.policy.maxRepeats) {
      a.repeats += 1;
      this.decide("repeat", "question repeated on request", slot);
      this.sayKeys("probe_repeat");
      return this.sayStep(step, true);
    }

    if (a.probes >= this.policy.maxProbes) return giveUp();
    a.probes += 1;
    if (c.intent === "question") {
      this.decide("probe", "respondent asked a question; interviewer does not explain, repeats the question", slot);
      this.sayKeys("cannot_help");
      return this.sayStep(step, true);
    }
    this.decide("probe", "reply not understood; asked again", slot);
    this.sayKeys("probe_unclear");
    if (item.kind === "number") this.sayKeys("probe_number");
    this.sayStep(step, true);
  }
}
