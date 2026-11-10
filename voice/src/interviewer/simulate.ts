/**
 * Simulated respondents at transcript level: scripted people who reply in text. They let the
 * whole interviewer run end to end, many times, with no carrier, no speech vendor and no model.
 */

import type { Instrument } from "../instrument/types.js";
import type { InterviewRecord } from "../qualtrics/csv.js";
import { buildScript } from "../script/script.js";
import type { ModelClassifier, ModelVerdict } from "./classify.js";
import { Interviewer, type Expecting, type Policy } from "./interviewer.js";
import { buildProtocol, buildSpeechTable, type CampaignWording, type SpeechTable, type SpokenLine } from "./protocol.js";
import type { InterviewState } from "../engine/flow.js";

export interface PersonaContext {
  expecting: Expecting;
  /** How many times this same question has now been put to the respondent (1 = first time). */
  attempt: number;
  /** What the interviewer just said. */
  said: SpokenLine[];
}

/** A simulated respondent. Returns what they say, or null to hang up without a word. */
export type Persona = (ctx: PersonaContext) => string | null;

export interface TranscriptTurn {
  speaker: "interviewer" | "respondent";
  text: string;
}

export interface SimulatedCall {
  interviewer: Interviewer;
  transcript: TranscriptTurn[];
  table: SpeechTable;
  hungUp: boolean;
}

export const DEFAULT_WORDING: CampaignWording = { sponsor: "the Library Study", topic: "your local public library", minutes: 3, askRecording: false };

export async function simulateCall(opts: {
  instrument: Instrument;
  persona: Persona;
  wording?: CampaignWording;
  model?: ModelClassifier;
  policy?: Policy;
  resumeFrom?: InterviewState;
  maxTurns?: number;
}): Promise<SimulatedCall> {
  const script = buildScript(opts.instrument);
  const table = buildSpeechTable(script, buildProtocol(opts.wording ?? DEFAULT_WORDING));
  const init: ConstructorParameters<typeof Interviewer>[0] = { instrument: opts.instrument, script, table };
  if (opts.model) init.model = opts.model;
  if (opts.policy) init.policy = opts.policy;
  if (opts.resumeFrom) init.resumeFrom = opts.resumeFrom;
  const interviewer = new Interviewer(init);
  const transcript: TranscriptTurn[] = [];
  const attempts = new Map<string, number>();
  let said = interviewer.open();
  let hungUp = false;
  for (let turn = 0; turn < (opts.maxTurns ?? 500) && !interviewer.ended; turn++) {
    for (const l of said) transcript.push({ speaker: "interviewer", text: l.text });
    const expecting = interviewer.expecting();
    const key = expecting.kind === "answer" ? expecting.slot : expecting.kind;
    attempts.set(key, (attempts.get(key) ?? 0) + 1);
    const reply = opts.persona({ expecting, attempt: attempts.get(key)!, said });
    if (reply === null) {
      hungUp = true;
      break;
    }
    transcript.push({ speaker: "respondent", text: reply });
    said = await interviewer.hear(reply);
  }
  if (!hungUp) for (const l of said) transcript.push({ speaker: "interviewer", text: l.text });
  return { interviewer, transcript, table, hungUp };
}

/** Turn a finished or interrupted call into a response row. */
export function toRecord(call: SimulatedCall, caseId: string, startedAt: Date, endedAt: Date): InterviewRecord {
  const s = call.interviewer.state;
  return {
    caseId,
    startedAt,
    endedAt,
    finished: s.outcome === "complete",
    state: s.interview,
    embedded: { vv_mode: "ai_voice", vv_case_id: caseId, vv_outcome: call.hungUp ? "breakoff" : (s.outcome ?? "breakoff"), vv_script: call.table.hash.slice(0, 12) },
  };
}

/** A stand-in for the model: fixed verdicts for known utterances, "unclear" for anything else. */
export function scriptedModel(verdicts: Record<string, ModelVerdict>, id = "scripted-model"): ModelClassifier & { calls: string[] } {
  const calls: string[] = [];
  return {
    id,
    calls,
    classify: async (req) => {
      calls.push(req.utterance);
      return verdicts[req.utterance] ?? { intent: "unclear", confidence: 0.2, evidence: req.utterance };
    },
  };
}

// ── personas ─────────────────────────────────────────────────────────────────

/** Agrees, then gives each scripted reply. `replies` maps slot key to what they say. */
export function cooperative(replies: Record<string, string>): Persona {
  return ({ expecting }) => {
    if (expecting.kind === "consent" || expecting.kind === "recording") return "yes";
    if (expecting.kind === "answer") return replies[expecting.slot] ?? "I don't know";
    return null;
  };
}

/** Wraps a persona: the first time each question is put, says `first` instead. */
export function firstSaying(first: string, then: Persona): Persona {
  return (ctx) => (ctx.expecting.kind === "answer" && ctx.attempt === 1 ? first : then(ctx));
}

/** Wraps a persona: on reaching `slot`, says `line` instead (every time). */
export function at(slot: string, line: string | null, otherwise: Persona): Persona {
  return (ctx) => ((ctx.expecting.kind === "answer" ? ctx.expecting.slot : ctx.expecting.kind) === slot ? line : otherwise(ctx));
}

/** Never says anything usable. */
export function mumbler(): Persona {
  return ({ expecting }) => (expecting.kind === "consent" ? "yes" : "mmm hmm well");
}
