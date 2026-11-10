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

/**
 * Call the model, run the guard AND the deterministic anti-leading check,
 * regenerating on any rejection. After `MAX_ATTEMPTS` rejections the result is
 * `exhausted`. Returns the accepted shape with per-turn diagnostics.
 */
export async function generateNextShape(
  model: ModelFn,
  messages: ChatMessage[]
): Promise<GenResult> {
  const guardRejections: string[] = [];
  let leadingRewrites = 0;
  let regenCount = 0;
  const result = (shape: NextShape): GenResult => ({
    shape,
    regenCount,
    guardRejections,
    leadingRewrites,
  });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const reply = await model(messages);
    const g = guardOutput(reply.text);

    if (g.kind === "question") {
      const lead = detectLeading(g.text);
      if (lead.leading) {
        guardRejections.push(`leading:${lead.reason}`);
        leadingRewrites += 1;
        regenCount += 1;
        continue; // regenerate a neutrally-phrased question
      }
      return result({ kind: "question", text: g.text });
    }
    if (g.kind === "stop_confirm") return result({ kind: "stop_confirm" });
    if (g.kind === "prd") return result({ kind: "prd", markdown: g.markdown });

    guardRejections.push(g.reason);
    regenCount += 1;
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

export interface PrdResult {
  markdown: string;
  /** Replies that were not a marked PRD. */
  rejects: number;
  /** True when a reply carried the `===PRD===` marker. */
  accepted: boolean;
}

/** Drive the model to emit the final PRD markdown. */
export async function forcePrd(
  model: ModelFn,
  messages: ChatMessage[]
): Promise<PrdResult> {
  const convo: ChatMessage[] = [
    ...messages,
    { role: "assistant", content: STOP_CONFIRM },
    { role: "user", content: "yes" },
  ];
  let rejects = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await model(convo);
    const g = guardOutput(reply.text);
    if (g.kind === "prd") return { markdown: g.markdown, rejects, accepted: true };
    rejects += 1;
    convo.push({ role: "assistant", content: reply.text });
    convo.push({
      role: "user",
      content:
        "Write the PRD now. Begin your reply with the line ===PRD=== and include every required section.",
    });
  }
  const fallback = await model(convo);
  return {
    markdown: fallback.text.replace(/^===PRD===\s*/, ""),
    rejects,
    accepted: false,
  };
}
