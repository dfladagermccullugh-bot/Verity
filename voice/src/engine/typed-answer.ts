/**
 * Rule-based reading of a typed answer. Used by the text-mode interview and, later, as the
 * first pass before any model is consulted: an exact option, an option number, a plain number.
 * Anything it cannot place with certainty is "unclear" — it never guesses.
 */

import type { Answer, Item } from "../instrument/types.js";

export type Reading = { kind: "answer"; answer: Answer } | { kind: "unclear" };

const DONT_KNOW = new Set(["dk", "don't know", "dont know", "i don't know", "i dont know", "not sure"]);
const REFUSED = new Set(["refuse", "refused", "skip", "prefer not to say", "i'd rather not say", "pass"]);

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/’/g, "'").replace(/[.!?]+$/, "").replace(/\s+/g, " ");
}

export function readTypedAnswer(item: Item, input: string): Reading {
  const text = norm(input);
  if (text === "") return { kind: "unclear" };

  if (item.kind === "single" || item.kind === "grid" || item.kind === "scale") {
    const choices = item.choices ?? [];
    const byLabel = choices.filter((c) => norm(c.label) === text);
    if (byLabel.length === 1) return { kind: "answer", answer: { kind: "choice", code: byLabel[0]!.code } };
    // An explicit option wins over the don't-know shorthand (a survey may offer "Don't know").
    if (DONT_KNOW.has(text)) return { kind: "answer", answer: { kind: "nonresponse", reason: "dont_know" } };
    if (REFUSED.has(text)) return { kind: "answer", answer: { kind: "nonresponse", reason: "refused" } };
    // A bare number means position in the list, except on a numeric scale where labels are numbers.
    if (item.kind !== "scale" && /^\d+$/.test(text)) {
      const c = choices[Number(text) - 1];
      if (c) return { kind: "answer", answer: { kind: "choice", code: c.code } };
    }
    return { kind: "unclear" };
  }

  if (DONT_KNOW.has(text)) return { kind: "answer", answer: { kind: "nonresponse", reason: "dont_know" } };
  if (REFUSED.has(text)) return { kind: "answer", answer: { kind: "nonresponse", reason: "refused" } };
  if (item.kind === "number") {
    return /^-?\d+(\.\d+)?$/.test(text) ? { kind: "answer", answer: { kind: "number", value: Number(text) } } : { kind: "unclear" };
  }
  if (item.kind === "text") return { kind: "answer", answer: { kind: "text", value: input.trim() } };
  return { kind: "unclear" };
}
