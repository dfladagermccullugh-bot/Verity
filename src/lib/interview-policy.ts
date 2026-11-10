/**
 * The generation policy: how one model turn is obtained and validated. Shared
 * by the interview engine and the canary so both measure the same behaviour.
 *
 * No DB, no `server-only`: the model call is injected, so the policy runs
 * under the canary script and under unit tests with a scripted model.
 */
import type { ChatMessage, ModelReply } from "./model-client";
import { guardOutput, STOP_CONFIRM } from "./guard";
import { detectLeading } from "./anti-leading";
import {
  coverageMet,
  uncoveredDimensionLabels,
  type CoverageTurn,
} from "./coverage";

/** Answered questions per round before the PRD is forced. */
export const RUNAWAY_CEILING = 40;

/** Model attempts per turn before the policy gives up. */
export const MAX_ATTEMPTS = 3;

export type ModelFn = (messages: ChatMessage[]) => Promise<ModelReply>;

export type NextShape =
  | { kind: "question"; text: string }
  | { kind: "stop_confirm" }
  | { kind: "prd"; markdown: string }
  /** Every attempt was rejected. Distinct from a real stop confirmation. */
  | { kind: "exhausted" };

/** A generated shape plus the diagnostics recorded on the resulting turn. */
export interface GenResult {
  shape: NextShape;
  regenCount: number;
  guardRejections: string[];
  leadingRewrites: number;
}

/** Plain-language description of a reject reason, for the corrective retry. */
export function describeRejection(reason: string): string {
  if (reason.startsWith("jargon:"))
    return `it used technical jargon ("${reason.slice(7)}"); the respondent is not technical`;
  if (reason.startsWith("leading:"))
    return "it was a leading question that suggests an answer; ask neutrally";
  switch (reason) {
    case "no_question_mark":
      return "it was not a single question ending in a question mark";
    case "multiline":
      return "it spanned more than one line; send only the question";
    case "too_long":
      return "it was longer than 200 characters";
    case "batched":
    case "multiple_questions":
      return "it asked more than one question";
    case "truncated":
      return "it was cut off before it finished";
    default:
      return "it did not match the output contract";
  }
}

/** The corrective turn appended after a rejected reply. Never persisted. */
export function correctiveMessages(rejectedText: string, reason: string): ChatMessage[] {
  return [
    { role: "assistant", content: rejectedText },
    {
      role: "user",
      content: `(That reply was rejected because ${describeRejection(reason)}. Reply again with exactly one of: a single short plain-language yes/no question; the stop confirmation; or the PRD starting with ===PRD===.)`,
    },
  ];
}

/**
 * Call the model, run the guard AND the deterministic anti-leading check,
 * regenerating on any rejection. Each retry carries a corrective message that
 * names the reason, rather than resending identical messages. After
 * `MAX_ATTEMPTS` rejections the result is `exhausted`.
 */
export async function generateNextShape(
  model: ModelFn,
  messages: ChatMessage[]
): Promise<GenResult> {
  const guardRejections: string[] = [];
  let leadingRewrites = 0;
  let regenCount = 0;
  let convo = messages;
  const result = (shape: NextShape): GenResult => ({
    shape,
    regenCount,
    guardRejections,
    leadingRewrites,
  });
  const reject = (text: string, reason: string) => {
    guardRejections.push(reason);
    regenCount += 1;
    convo = [...convo, ...correctiveMessages(text, reason)];
  };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const reply = await model(convo);
    if (reply.stopReason === "max_tokens") {
      reject(reply.text, "truncated");
      continue;
    }
    const g = guardOutput(reply.text);

    if (g.kind === "question") {
      const lead = detectLeading(g.text);
      if (lead.leading) {
        leadingRewrites += 1;
        reject(g.text, `leading:${lead.reason}`);
        continue; // regenerate a neutrally-phrased question
      }
      return result({ kind: "question", text: g.text });
    }
    if (g.kind === "stop_confirm") return result({ kind: "stop_confirm" });
    if (g.kind === "prd") return result({ kind: "prd", markdown: g.markdown });

    reject(reply.text, g.reason);
  }

  return result({ kind: "exhausted" });
}

/**
 * Coverage gate (content validity). When the model tries to stop (PRD or
 * stop-confirm) before enough construct dimensions are covered, nudge it once
 * toward the uncovered dimensions and try to obtain one more question. Falls
 * back to the original stop-shape if the model still refuses to ask. The
 * caller bypasses this entirely on an explicit respondent "done".
 */
export interface CoverageResult {
  /** The shape to act on: the nudged question, or the original stop. */
  gen: GenResult;
  /** The nudge attempt, when one was made (for diagnostics and metrics). */
  nudge: GenResult | null;
}

export async function enforceCoverage(
  model: ModelFn,
  baseMessages: ChatMessage[],
  answered: CoverageTurn[],
  stopGen: GenResult
): Promise<CoverageResult> {
  if (coverageMet(answered)) return { gen: stopGen, nudge: null };
  const remaining = uncoveredDimensionLabels(answered).join(", ");
  const nudged: ChatMessage[] = [
    ...baseMessages,
    {
      role: "user",
      content: `(Not enough has been covered to write the PRD yet. These areas are still unaddressed: ${remaining}. Ask the next single yes/no question about one of them — do not write the PRD.)`,
    },
  ];
  const nudge = await generateNextShape(model, nudged);
  return { gen: nudge.shape.kind === "question" ? nudge : stopGen, nudge };
}

/** The PRD sections the skill requires, in order (skill Step 4). */
export const PRD_SECTIONS = [
  "One-line pitch",
  "Problem",
  "Primary user",
  "Core jobs",
  "Must-have features",
  "Should-have features",
  "Could-have features",
  "Platform & context",
  "Data",
  "Integrations",
  "Success signal",
  "Constraints",
  "Out of scope",
  "Open questions",
] as const;

/** A reply without the marker is accepted as a PRD only if at least this many
 *  required sections appear as headings (half of them). */
export const PRD_MIN_SECTIONS = 7;

/** Required sections that appear as a heading line (`#`, bold, or numbered). */
export function prdSectionsPresent(markdown: string): string[] {
  const lines = markdown.split("\n").map((l) => l.trim().toLowerCase());
  const headingLike = lines
    .filter((l) => /^(#{1,6}\s|\*\*|__|\d+[.)]\s)/.test(l))
    .map((l) => l.replace(/^#{1,6}\s+|^\d+[.)]\s+/, "").replace(/[*_]/g, "").trim());
  return PRD_SECTIONS.filter((sec) => {
    const want = sec.toLowerCase();
    return headingLike.some((h) => h.startsWith(want) || h.replace(/^\d+[.)]\s+/, "").startsWith(want));
  });
}

export function looksLikePrd(markdown: string): boolean {
  return prdSectionsPresent(markdown).length >= PRD_MIN_SECTIONS;
}

export type PrdResult =
  | {
      ok: true;
      markdown: string;
      /** Replies that were not an acceptable PRD. */
      rejects: number;
      /** "marker": carried `===PRD===`; "fallback": unmarked but validated. */
      via: "marker" | "fallback";
      rejections: string[];
    }
  | { ok: false; rejects: number; rejections: string[] };

const PRD_NUDGE =
  "Write the PRD now. Begin your reply with the line ===PRD=== and include every required section.";

/**
 * Drive the model to emit the final PRD markdown. Two marked attempts, then a
 * last unmarked fallback that is accepted only if it has the PRD's headings;
 * otherwise `ok: false` and the caller fails the round instead of storing
 * arbitrary text as a PRD. A reply cut off at `max_tokens` never counts.
 */
export async function forcePrd(
  model: ModelFn,
  messages: ChatMessage[]
): Promise<PrdResult> {
  const convo: ChatMessage[] = [
    ...messages,
    { role: "assistant", content: STOP_CONFIRM },
    { role: "user", content: "yes" },
  ];
  const rejections: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await model(convo);
    const truncated = reply.stopReason === "max_tokens";
    const g = guardOutput(reply.text);
    if (g.kind === "prd" && !truncated)
      return { ok: true, markdown: g.markdown, rejects: rejections.length, via: "marker", rejections };
    rejections.push(truncated ? "prd:truncated" : "prd:no_marker");
    convo.push({ role: "assistant", content: reply.text });
    convo.push({ role: "user", content: PRD_NUDGE });
  }
  const fallback = await model(convo);
  const markdown = fallback.text.replace(/^===PRD===\s*/, "");
  if (fallback.stopReason !== "max_tokens" && looksLikePrd(markdown))
    return { ok: true, markdown, rejects: rejections.length, via: "fallback", rejections };
  rejections.push(fallback.stopReason === "max_tokens" ? "prd:truncated" : "prd:no_headings");
  return { ok: false, rejects: rejections.length, rejections };
}
