/**
 * Rule-based reading of a typed answer. Used by the text-mode interview and, later, as the
 * first pass before any model is consulted: an exact option, an option number, a plain number.
 * Anything it cannot place with certainty is "unclear" — it never guesses.
 */

import type { Answer, Item } from "../instrument/types.js";
import { parseSpokenNumber } from "../util/number-words.js";

export type Reading = { kind: "answer"; answer: Answer } | { kind: "unclear" };

const DONT_KNOW = new Set(["dk", "don't know", "dont know", "i don't know", "i dont know", "not sure", "i'm not sure", "no idea", "i have no idea", "i can't remember", "i couldn't tell you"]);
const REFUSED = new Set(["refuse", "refused", "skip", "skip that", "skip that one", "prefer not to say", "i prefer not to say", "i'd rather not say", "i'd rather not answer", "rather not say", "pass", "none of your business"]);
const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
/** Noises that are not an answer to anything. */
const FILLER = /^(?:(?:u+m+|u+h+|h+m+|e+r+|a+h+|m+|well|so|okay|ok|let me think|let's see)[\s,.]*)+$/;
/** Replies that are a question back to the interviewer, not an answer. */
const QUESTION_BACK = /\?\s*$|^(?:what|which|who|how|why|does|do|is|are|can|could|would|like what)\b/;

/** "option three", "number 2", "the third one", "the last one": a position in the list of options. */
function positionOf(text: string, count: number): number | null {
  const named = /^(?:option|number|choice)\s+(.+)$/.exec(text);
  if (named) return parseSpokenNumber(named[1]!);
  const ordinal = /^(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last)(?:\s+(?:one|option|choice))?$/.exec(text);
  if (!ordinal) return null;
  return ordinal[1] === "last" ? count : ORDINALS[ordinal[1]!]!;
}

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
    if (item.kind === "scale") {
      // On a number scale a number is the scale point itself: "8", "eight", "number 6".
      const spoken = parseSpokenNumber(/^(?:number|a|an)\s+(.+)$/.exec(text)?.[1] ?? text);
      const point = spoken === null ? undefined : choices.find((c) => norm(c.label) === String(spoken));
      if (point) return { kind: "answer", answer: { kind: "choice", code: point.code } };
      return { kind: "unclear" };
    }
    // Otherwise a bare number, or "the third one", means a position in the list.
    const position = /^\d+$/.test(text) ? Number(text) : positionOf(text, choices.length);
    const c = position === null ? undefined : choices[position - 1];
    if (c) return { kind: "answer", answer: { kind: "choice", code: c.code } };
    return { kind: "unclear" };
  }

  if (DONT_KNOW.has(text)) return { kind: "answer", answer: { kind: "nonresponse", reason: "dont_know" } };
  if (REFUSED.has(text)) return { kind: "answer", answer: { kind: "nonresponse", reason: "refused" } };
  if (item.kind === "number") {
    if (/^-?\d+(\.\d+)?$/.test(text)) return { kind: "answer", answer: { kind: "number", value: Number(text) } };
    const spoken = text === "none" ? 0 : parseSpokenNumber(text);
    return spoken === null ? { kind: "unclear" } : { kind: "answer", answer: { kind: "number", value: spoken } };
  }
  if (item.kind === "text") {
    // A noise or a question back is not the respondent's answer in their own words.
    if (FILLER.test(text) || QUESTION_BACK.test(input.trim().toLowerCase())) return { kind: "unclear" };
    return { kind: "answer", answer: { kind: "text", value: input.trim() } };
  }
  return { kind: "unclear" };
}
