/**
 * Deterministic anti-leading check (Survey Methodology — measurement error).
 *
 * A yes/no interview is acutely vulnerable to *leading* questions: phrasing
 * that signals the "expected" answer (tag questions, presupposition, loaded
 * openers) inflates acquiescence and corrupts the construct. The existing
 * `guard.ts` enforces question *form*; this adds a *semantic* check on the
 * direction of the phrasing.
 *
 * It is deliberately deterministic — a curated pattern list, no model call —
 * matching the project's "hard guardrails, not soft prompting" stance and
 * adding zero latency to the question loop. A positive detection is treated
 * exactly like a guard rejection: the question is regenerated. The patterns
 * are curated narrowly to avoid false positives; a cleverly-worded leading
 * question can still slip through, and that limitation is disclosed in the
 * methodology document.
 */

export type LeadingResult =
  | { leading: false }
  | { leading: true; reason: string };

// Tag questions appended to the end: "..., right?", "..., isn't it?".
// Anchored to the end so an ordinary use of the word mid-question
// ("Is the button on the right?") is not flagged.
const TAG_PATTERNS: RegExp[] = [
  /,\s*(right|correct|yeah|yes|no|ok|okay)\s*\?+$/i,
  /\b(isn't it|aren't they|aren't you|don't you|doesn't it|won't it|wouldn't it|wouldn't you|shouldn't it|shouldn't you|couldn't it|can't you)\s*\?+$/i,
];

// Loaded openers that pre-load a stance before the question is even asked.
const OPENER_PATTERNS: RegExp[] = [
  /^(surely|obviously|clearly|of course|naturally|honestly|certainly)\b/i,
  /^so\s+you\b/i,
];

// Presupposition / opinion-steering phrases anywhere in the question.
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

/** Detect leading phrasing in an already-form-valid question. */
export function detectLeading(questionText: string): LeadingResult {
  const trimmed = questionText.trim();
  const lower = trimmed.toLowerCase();

  for (const re of TAG_PATTERNS) {
    if (re.test(trimmed)) return { leading: true, reason: "tag_question" };
  }
  for (const re of OPENER_PATTERNS) {
    if (re.test(trimmed)) return { leading: true, reason: "leading_opener" };
  }
  for (const snippet of PRESUPPOSITION_SNIPPETS) {
    if (lower.includes(snippet)) return { leading: true, reason: "presupposition" };
  }
  return { leading: false };
}
