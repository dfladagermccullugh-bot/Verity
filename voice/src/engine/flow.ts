/**
 * Survey-logic engine. Pure and deterministic: the next step is always derived from the answers
 * recorded so far, so an interrupted interview resumes exactly where it stopped (the same idea as
 * Verity's re-entrant `advance`). Nothing here speaks, listens or calls a model.
 */

import type { Answer, Condition, GridRow, Instrument, Item, SkipTarget, Slot } from "../instrument/types.js";
import { slotKey } from "../instrument/types.js";

export interface InterviewState {
  /** Answers by slot key, in the order they were recorded. */
  answers: Record<string, Answer>;
  /** Ids of read-only statements that have been delivered. */
  heard: string[];
}

export type Step =
  | { kind: "statement"; item: Item }
  | { kind: "ask"; item: Item; row?: GridRow; slot: Slot }
  | { kind: "end"; reason: "completed" | "skipped_to_end" };

export class FlowError extends Error {}

export function emptyState(): InterviewState {
  return { answers: {}, heard: [] };
}

export function slotsOf(item: Item): Slot[] {
  if (item.kind === "statement") return [];
  if (item.kind === "grid") return (item.rows ?? []).map((r) => ({ key: slotKey(item.id, r.code), itemId: item.id, rowCode: r.code }));
  return [{ key: slotKey(item.id), itemId: item.id }];
}

/**
 * Evaluate a condition against recorded answers. An unanswered or declined question counts as
 * "not selected"; numeric comparisons on it are false, except "not equal", which is true.
 */
export function evaluate(c: Condition, answers: Record<string, Answer>): boolean {
  if ("terms" in c) {
    return c.op === "and" ? c.terms.every((t) => evaluate(t, answers)) : c.terms.some((t) => evaluate(t, answers));
  }
  if ("choiceCode" in c) {
    const a = answers[slotKey(c.itemId, c.rowCode)];
    const selected = a?.kind === "choice" && a.code === c.choiceCode;
    return c.op === "selected" ? selected : !selected;
  }
  const a = answers[slotKey(c.itemId)];
  if (a?.kind !== "number") return c.op === "ne";
  const v = a.value;
  if (c.op === "eq") return v === c.value;
  if (c.op === "ne") return v !== c.value;
  if (c.op === "gt") return v > c.value;
  if (c.op === "ge") return v >= c.value;
  if (c.op === "lt") return v < c.value;
  return v <= c.value;
}

type Jump = (SkipTarget & { blockId: string }) | null;

/** Walk the instrument in order. Calls `visit` for each item that applies; stops when it returns a step. */
function walk(instrument: Instrument, state: InterviewState, visit: (item: Item) => Step | null): Step {
  let jump: Jump = null;
  for (const item of instrument.items) {
    if (jump) {
      if (jump.kind === "endOfSurvey") return { kind: "end", reason: "skipped_to_end" };
      if (jump.kind === "endOfBlock" && item.blockId === jump.blockId) continue;
      if (jump.kind === "item" && item.id !== jump.itemId) continue;
      jump = null;
    }
    if (item.displayIf && !evaluate(item.displayIf, state.answers)) continue;
    const step = visit(item);
    if (step) return step;
    for (const rule of item.skips ?? []) {
      if (evaluate(rule.when, state.answers)) {
        jump = { ...rule.to, blockId: item.blockId };
        break;
      }
    }
  }
  return { kind: "end", reason: jump?.kind === "endOfSurvey" ? "skipped_to_end" : "completed" };
}

/** What happens next. Calling it twice without recording anything returns the same step. */
export function nextStep(instrument: Instrument, state: InterviewState): Step {
  return walk(instrument, state, (item) => {
    if (item.kind === "statement") return state.heard.includes(item.id) ? null : { kind: "statement", item };
    for (const slot of slotsOf(item)) {
      if (state.answers[slot.key] === undefined) {
        const row = slot.rowCode === undefined ? undefined : item.rows?.find((r) => r.code === slot.rowCode);
        return row ? { kind: "ask", item, row, slot } : { kind: "ask", item, slot };
      }
    }
    return null;
  });
}

/** Slots on the path taken so far, in order, including the pending one. Everything else was not asked. */
export function slotsOnPath(instrument: Instrument, state: InterviewState): Slot[] {
  const out: Slot[] = [];
  walk(instrument, { answers: state.answers, heard: instrument.items.map((i) => i.id) }, (item) => {
    for (const slot of slotsOf(item)) {
      out.push(slot);
      if (state.answers[slot.key] === undefined) return { kind: "ask", item, slot };
    }
    return null;
  });
  return out;
}

export function validateAnswer(item: Item, answer: Answer): string | null {
  if (answer.kind === "nonresponse") return null;
  if (item.kind === "single" || item.kind === "scale" || item.kind === "grid") {
    if (answer.kind !== "choice") return "This question takes one of its listed options.";
    return (item.choices ?? []).some((c) => c.code === answer.code) ? null : `"${answer.code}" is not one of the options.`;
  }
  if (item.kind === "number") {
    if (answer.kind !== "number" || !Number.isFinite(answer.value)) return "This question takes a number.";
    const n = item.number ?? { integer: false };
    if (n.integer && !Number.isInteger(answer.value)) return "This question takes a whole number.";
    if (n.min !== undefined && answer.value < n.min) return `The number must be at least ${n.min}.`;
    if (n.max !== undefined && answer.value > n.max) return `The number must be at most ${n.max}.`;
    return null;
  }
  if (item.kind === "text") {
    return answer.kind === "text" && answer.value.trim() !== "" ? null : "This question takes a spoken answer in the respondent's own words.";
  }
  return "This item does not take an answer.";
}

/** Mark the pending statement as delivered. */
export function markHeard(instrument: Instrument, state: InterviewState, itemId: string): InterviewState {
  const step = nextStep(instrument, state);
  if (step.kind !== "statement" || step.item.id !== itemId) throw new FlowError(`${itemId} is not the statement due next.`);
  return { answers: state.answers, heard: [...state.heard, itemId] };
}

/** Record an answer to the pending question. Only the question that is due can be answered. */
export function recordAnswer(instrument: Instrument, state: InterviewState, key: string, answer: Answer): InterviewState {
  const step = nextStep(instrument, state);
  if (step.kind !== "ask" || step.slot.key !== key) throw new FlowError(`${key} is not the question due next.`);
  const problem = validateAnswer(step.item, answer);
  if (problem) throw new FlowError(problem);
  return { answers: { ...state.answers, [key]: answer }, heard: state.heard };
}
