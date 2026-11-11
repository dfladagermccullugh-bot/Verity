/**
 * Working out what a respondent's utterance means.
 *
 * Rules run first and handle what is certain: opting out, stopping, asking for a repeat, and
 * answers that exactly match an option or are a plain number. Only what is left goes to a model,
 * and the model's verdict is checked in code before it counts: the answer must be a real option,
 * and the words it claims to rely on must actually appear in what the respondent said.
 */

import type { Answer, Item } from "../instrument/types.js";
import { validateAnswer } from "../engine/flow.js";
import { readTypedAnswer } from "../engine/typed-answer.js";
import { isYesNo } from "../script/script.js";

export type Intent = "answer" | "yes" | "no" | "repeat" | "opt_out" | "stop" | "callback" | "question" | "unclear";

export interface Classification {
  intent: Intent;
  /** Present when intent is "answer". Includes "don't know" and "refused" as nonresponse answers. */
  answer?: Answer;
  /** 0 to 1. Rule matches are 1. */
  confidence: number;
  /** The respondent's words the verdict rests on. Always a part of the utterance. */
  evidence: string;
  by: "rule" | "model";
  /** Model identifier, when a model decided. */
  model?: string;
  /** Why a model verdict was discarded, when it was. */
  rejected?: string;
}

export interface ModelRequest {
  utterance: string;
  /** What kind of reply is expected: consent (yes/no) or an answer to `item`. */
  expecting: "consent" | "answer";
  item?: Item;
}

export interface ModelVerdict {
  intent: Intent;
  answer?: Answer;
  confidence: number;
  evidence: string;
}

export interface ModelClassifier {
  id: string;
  classify(req: ModelRequest): Promise<ModelVerdict>;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/’/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
}

// Opt-out is matched generously: a false match ends one call, a miss keeps calling someone who said no.
const OPT_OUT = /\b(remove me|take me off|stop calling|do not call|don't call|dont call|never call|unsubscribe|off (?:your|the|this) list)\b/;
const STOP = /^(?:(?:please\s+)?stop(?:\s+please)?|i (?:want|need|have) to stop|end the call|hang up|i(?: have|'ve got| need) to go|goodbye|bye)(?:\s+(?:now|please))?$/;
const REPEAT = new RegExp(
  "^(?:(?:sorry|pardon|excuse me|um|uh|oh|wait|hang on)\\s+)*" +
    "(?:(?:(?:can|could|would|will) you\\s+)?(?:please\\s+)?(?:repeat|say)(?:\\s+(?:that|it|this|the question|the options|the choices|them))?(?:\\s+again)?(?:\\s+for me)?" +
    "|what|what was that|what was the question|what did you say|what were the (?:options|choices)|come again|huh|eh|pardon|sorry" +
    "|i (?:didn't|did not|couldn't|could not) (?:hear|catch|get) (?:that|you|it|the question))" +
    "(?:\\s+please)?$",
);
const CALLBACK = /\b(call (?:me )?back|call (?:me )?later|another time|not a good time|bad time|busy right now)\b/;
const YES = /^(?:(?:yes|yeah|yep|yup|sure|ok|okay|all right|alright|fine by me|i agree|i do|that's fine|that is fine|go ahead|yes please|yes i agree|yes i do)(?:[ ,]+(?:sure|go ahead|okay|ok|i agree|that's fine))?)$/;
const NO = /^(?:no|nope|nah|no thanks|no thank you|i don't|i do not|i don't agree|i do not agree|i don't want to|not interested|i'm not interested|absolutely not|definitely not)$/;
/** Whole-utterance yes and no, for survey questions whose only options are Yes and No. */
const PLAIN_YES = /^(?:yes|yeah|yep|yup|uh huh|yes yes|yes i have|yes i did|yes i do|i have yes|i did yes)$/;
const PLAIN_NO = /^(?:no|nope|nah|no no|no no no|no i haven't|no i have not|no i didn't|no i don't)$/;

function rule(intent: Intent, utterance: string, answer?: Answer): Classification {
  const c: Classification = { intent, confidence: 1, evidence: utterance.trim(), by: "rule" };
  if (answer) c.answer = answer;
  return c;
}

/** Rules only. Returns null when nothing is certain. */
export function classifyByRule(req: ModelRequest): Classification | null {
  const text = norm(req.utterance);
  if (text === "") return null;
  if (OPT_OUT.test(text)) return rule("opt_out", req.utterance);
  if (req.expecting === "answer" && req.item) {
    // An exact option always wins, so a survey option such as "No" is never taken as a command.
    const reading = readTypedAnswer(req.item, req.utterance);
    if (reading.kind === "answer" && reading.answer.kind !== "text" && validateAnswer(req.item, reading.answer) === null) {
      return rule("answer", req.utterance, reading.answer);
    }
    const choices = req.item.choices ?? [];
    if (req.item.kind === "single" && isYesNo(choices) && (PLAIN_YES.test(text) || PLAIN_NO.test(text))) {
      const want = PLAIN_YES.test(text) ? "yes" : "no";
      const choice = choices.find((c) => c.label.trim().toLowerCase() === want)!;
      return rule("answer", req.utterance, { kind: "choice", code: choice.code });
    }
  }
  if (STOP.test(text)) return rule("stop", req.utterance);
  if (CALLBACK.test(text)) return rule("callback", req.utterance);
  if (REPEAT.test(text)) return rule("repeat", req.utterance);
  if (req.expecting === "consent") {
    if (YES.test(text)) return rule("yes", req.utterance);
    if (NO.test(text)) return rule("no", req.utterance);
    return null;
  }
  // An open question takes the respondent's own words as the answer (but not a noise or a question back).
  if (req.item?.kind === "text") {
    const reading = readTypedAnswer(req.item, req.utterance);
    if (reading.kind === "answer") return rule("answer", req.utterance, reading.answer);
  }
  return null;
}

function unclear(utterance: string, extra: Partial<Classification> = {}): Classification {
  return { intent: "unclear", confidence: 0, evidence: utterance.trim(), by: "rule", ...extra };
}

/** Check a model verdict in code. A verdict that fails any check is discarded, never repaired. */
export function checkVerdict(req: ModelRequest, v: ModelVerdict, modelId: string): Classification {
  const discard = (why: string) => unclear(req.utterance, { by: "model", model: modelId, rejected: why });
  if (typeof v.confidence !== "number" || !(v.confidence >= 0 && v.confidence <= 1)) return discard("confidence is not between 0 and 1");
  const evidence = typeof v.evidence === "string" ? v.evidence.trim() : "";
  if (evidence === "" || !norm(req.utterance).includes(norm(evidence)) || norm(evidence) === "") return discard("evidence is not part of what the respondent said");
  const allowed: Intent[] = req.expecting === "consent" ? ["yes", "no", "repeat", "opt_out", "stop", "callback", "question", "unclear"] : ["answer", "repeat", "opt_out", "stop", "callback", "question", "unclear"];
  if (!allowed.includes(v.intent)) return discard(`intent "${String(v.intent)}" is not valid here`);
  const out: Classification = { intent: v.intent, confidence: v.confidence, evidence, by: "model", model: modelId };
  if (v.intent === "answer") {
    if (!req.item || !v.answer) return discard("no answer given");
    const problem = validateAnswer(req.item, v.answer);
    if (problem) return discard(`answer is not valid for this question: ${problem}`);
    // An open answer is the respondent's own words, never the model's wording of them.
    out.answer = v.answer.kind === "text" ? { kind: "text", value: req.utterance.trim() } : v.answer;
  }
  return out;
}

export async function classify(req: ModelRequest, model?: ModelClassifier): Promise<Classification> {
  const byRule = classifyByRule(req);
  if (byRule) return byRule;
  if (!model || req.utterance.trim() === "") return unclear(req.utterance);
  let verdict: ModelVerdict;
  try {
    verdict = await model.classify(req);
  } catch (err) {
    return unclear(req.utterance, { by: "model", model: model.id, rejected: `model call failed: ${err instanceof Error ? err.message : String(err)}` });
  }
  return checkVerdict(req, verdict, model.id);
}
