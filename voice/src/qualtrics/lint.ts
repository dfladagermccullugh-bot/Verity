/**
 * Advisory checks on the researcher's wording, for a survey that will be heard rather than read.
 * These never block a survey and never change its wording; they are suggestions for the researcher
 * to act on in the survey platform.
 */

import type { Finding, Item } from "../instrument/types.js";

/** More options than this are hard to hold in mind when heard once. */
export const MAX_SPOKEN_OPTIONS = 5;
export const MAX_QUESTION_WORDS = 45;
export const MAX_OPTION_WORDS = 12;

const VISUAL_WORDING = /\b(click|tap|drag|scroll|below|above|on (?:the|this) (?:screen|page)|shown here|pictured|select from the list)\b/i;

export type LeadingResult = { leading: false } | { leading: true; reason: string };

// Ported from Verity's src/lib/anti-leading.ts. There it rejected model-written questions; here it
// only advises on researcher-written ones. Patterns are narrow by design to avoid false positives.
const TAG_PATTERNS: RegExp[] = [
  /,\s*(right|correct|yeah|yes|no|ok|okay)\s*\?+$/i,
  /\b(isn't it|aren't they|aren't you|don't you|doesn't it|won't it|wouldn't it|wouldn't you|shouldn't it|shouldn't you|couldn't it|can't you)\s*\?+$/i,
];
const OPENER_PATTERNS: RegExp[] = [/^(surely|obviously|clearly|of course|naturally|honestly|certainly)\b/i, /^so\s+you\b/i];
const PRESUPPOSITION_SNIPPETS: string[] = [
  "don't you think",
  "do you not think",
  "wouldn't you agree",
  "wouldn't you say",
  "you'd want",
  "you would want",
  "you'd probably",
  "you probably",
  "you definitely",
  "isn't it true",
  "wouldn't it be better",
  "the best way",
  "the obvious choice",
];

export function detectLeading(questionText: string): LeadingResult {
  const trimmed = questionText.trim();
  const lower = trimmed.toLowerCase();
  for (const re of TAG_PATTERNS) if (re.test(trimmed)) return { leading: true, reason: "tag question" };
  for (const re of OPENER_PATTERNS) if (re.test(trimmed)) return { leading: true, reason: "loaded opener" };
  for (const snippet of PRESUPPOSITION_SNIPPETS) if (lower.includes(snippet)) return { leading: true, reason: "presupposition" };
  return { leading: false };
}

function words(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

export function lintItem(item: Item): Finding[] {
  const out: Finding[] = [];
  const warn = (code: string, message: string) => out.push({ severity: "warning", code, itemId: item.id, message });

  if (item.kind !== "statement" && words(item.text) > MAX_QUESTION_WORDS) {
    warn("long_question", `The question is ${words(item.text)} words long. Long questions are hard to follow by ear.`);
  }
  if (VISUAL_WORDING.test(item.text)) warn("visual_wording", "The wording refers to the screen (for example \"click\" or \"below\"), which makes no sense on a phone call.");
  if ((item.kind === "single" || item.kind === "grid") && (item.choices?.length ?? 0) > MAX_SPOKEN_OPTIONS) {
    warn("many_options", `There are ${item.choices!.length} answer options. More than ${MAX_SPOKEN_OPTIONS} are hard to remember when heard once.`);
  }
  if ((item.choices ?? []).some((c) => words(c.label) > MAX_OPTION_WORDS)) warn("long_option", "At least one answer option is long; long options are hard to remember by ear.");
  if (item.kind !== "statement") {
    const leading = detectLeading(item.text);
    if (leading.leading) warn("leading_wording", `The wording may steer the answer (${leading.reason}).`);
  }
  return out;
}
