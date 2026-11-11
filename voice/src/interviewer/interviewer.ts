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
import { classify, classifyKeys, type Classification, type ModelClassifier } from "./classify.js";
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

export const DEFAULT_POLICY: Policy = { acceptAt: 0.85, maxProbes: 2, maxRepeats: 6 };

/** A request to hear only the answer options again ("what was the scale?", "what were my choices?"). */
const ABOUT_OPTIONS = /\b(?:options?|choices?|scale|answers)\b/i;

/** What a person must have heard to the end before their agreement can count: who is calling, that it is an AI, what is asked, and how to stop. */
const INTRODUCTION: ProtocolKey[] = ["intro", "purpose", "transcribed", "how_to_stop"];
/** Times the introduction is started again when it was cut off, before the call is given up. */
const MAX_INTRO_RESTARTS = 2;
/** Times the introduction is given again on request before a further request counts as no clear agreement. */
const MAX_INTRO_REPEATS = 2;

export type Phase = "not_started" | "consent" | "recording" | "interview" | "ended";

/** Everything needed to resume a call. Plain data: safe to store and reload. */
export interface CallState {
  phase: Phase;
  interview: InterviewState;
  consent: { participate: boolean | null; recording: boolean | null };
  /** Probes and repeats used, by slot key ("consent" for the consent question). `restarts` counts the introduction being started again after it was cut off. */
  attempts: Record<string, { probes: number; repeats: number; restarts?: number }>;
  /** Slots whose recorded value should be checked by a person. */
  review: string[];
  /** Milliseconds from the end of the question audio to the start of the reply, by slot (first reply only). */
  latencyMs: Record<string, number>;
  outcome: Outcome | null;
}

export type AuditEvent = { seq: number } & (
  | { type: "say"; lineId: string; source: SpokenLine["source"]; text: string }
  | { type: "heard"; text: string }
  | { type: "classified"; expecting: "consent" | "recording" | "answer"; slot?: string; classification: Classification }
  | { type: "decision"; action: "record" | "probe" | "repeat" | "nonresponse" | "consent" | "end"; slot?: string; detail: string }
  /** What actually reached the respondent's ear: when a line played and whether it was cut off. */
  | { type: "played"; lineId: string; startedMs: number; endedMs: number; completed: boolean }
  /** How the reply arrived: its timing, and the response latency when a question was pending. */
  | { type: "turn"; via: "speech" | "keys" | "silence"; startedMs: number; endedMs: number; slot?: string; latencyMs?: number }
  | { type: "flag"; slot: string; reason: string }
);

type AuditBody = AuditEvent extends infer E ? (E extends { seq: number } ? Omit<E, "seq"> : never) : never;

export type Expecting = { kind: "consent" } | { kind: "recording" } | { kind: "answer"; item: Item; row?: GridRow; slot: string } | { kind: "nothing" };

export function newCallState(interview: InterviewState = emptyState()): CallState {
  return { phase: "not_started", interview, consent: { participate: null, recording: null }, attempts: {}, review: [], latencyMs: {}, outcome: null };
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

  /** Keypad digits. On a question they mean an option's position, a scale point or a number; "*" asks for a repeat. */
  async hearKeys(digits: string): Promise<SpokenLine[]> {
    if (this.state.phase === "not_started") throw new Error("The call has not started.");
    if (this.state.phase === "ended") return [];
    this.out = [];
    this.push({ type: "heard", text: `[keypad ${digits}]` });
    const expecting = this.expecting();
    if (expecting.kind === "answer") {
      const c = classifyKeys(expecting.item, digits);
      this.push({ type: "classified", expecting: "answer", slot: expecting.slot, classification: c });
      this.onAnswer(expecting, c);
    } else if (expecting.kind === "consent" || expecting.kind === "recording") {
      // Consent is spoken. Keys are not taken as agreement.
      const c: Classification = { intent: "unclear", confidence: 0, evidence: `keypad ${digits}`, by: "rule" };
      this.push({ type: "classified", expecting: expecting.kind, classification: c });
      if (expecting.kind === "consent") this.onConsent(c);
      else this.onRecording(c);
    }
    return this.flush();
  }

  /** The line went quiet or dropped: end the call without saying anything more. Answers so far are kept. */
  abandon(detail: string): void {
    if (this.state.phase === "ended") return;
    this.state.phase = "ended";
    this.state.outcome = this.state.consent.participate === true ? "breakoff" : "consent_declined";
    this.decide("end", `${this.state.outcome}: ${detail}`);
  }

  /** Record a fact about the call that is not speech (timing, playback), from the layer carrying the audio. */
  note(event: Extract<AuditEvent, { type: "played" | "turn" }>): void {
    const { seq: _seq, ...body } = event as AuditEvent & { seq?: number };
    this.push(body as AuditBody);
    if (event.type === "turn" && event.slot !== undefined && event.latencyMs !== undefined && this.state.latencyMs[event.slot] === undefined) {
      this.state.latencyMs[event.slot] = event.latencyMs;
    }
  }

  /** Mark a slot for a person to check, with the reason. */
  flag(slot: string, reason: string): void {
    if (!this.state.review.includes(slot)) this.state.review.push(slot);
    this.push({ type: "flag", slot, reason });
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

  private attempts(key: string): { probes: number; repeats: number; restarts?: number } {
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

  /**
   * Whether every line of the introduction has reached the person's ear to its end. Known only
   * when the layer carrying the audio reports playback; a typed conversation reports none, and
   * there the lines were shown in full.
   */
  private introductionHeard(): boolean {
    const played = this.log.filter((e) => e.type === "played");
    if (played.length === 0) return true;
    return INTRODUCTION.every((key) => played.some((p) => p.lineId === `p.${key}` && p.completed));
  }

  private onConsent(c: Classification): void {
    if (this.common(c, true)) return;
    const a = this.attempts("consent");
    const refused = c.intent === "no" && c.confidence >= this.policy.acceptAt;
    if (!refused && !this.introductionHeard()) {
      // A "yes" from someone who has not heard that this is an AI, or what they are agreeing to, is
      // not consent; and a "hello?" over the introduction is not a reply to a question they never
      // heard. Start again from the beginning. This is not counted as a failed reply.
      if ((a.restarts ?? 0) < MAX_INTRO_RESTARTS) {
        a.restarts = (a.restarts ?? 0) + 1;
        this.decide("repeat", "the introduction was cut off before it was heard in full; started again from the beginning");
        return this.sayKeys(...INTRODUCTION, "consent_ask");
      }
      this.state.consent.participate = false;
      return this.end("consent_declined", "consent_declined", "the introduction could not be played in full, so there was nothing to agree to");
    }
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
    if (c.intent === "repeat" && a.repeats < MAX_INTRO_REPEATS) {
      a.repeats += 1;
      this.decide("repeat", "introduction repeated on request");
      return this.sayKeys("purpose", "transcribed", "how_to_stop", "consent_ask");
    }
    if (c.intent === "question" && a.repeats < MAX_INTRO_REPEATS) {
      // "Who is this?", "take part in what?": the only answer the interviewer has is its introduction.
      a.repeats += 1;
      this.decide("repeat", "asked what the call is; introduction given again");
      return this.sayKeys(...INTRODUCTION, "consent_ask");
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
      // Asking for the scale or the choices gets just those, straight away; nobody can hold five options in their head.
      if (closed && ABOUT_OPTIONS.test(c.evidence)) {
        this.decide("repeat", "answer options repeated on request", slot);
        return this.sayOptions(step);
      }
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
