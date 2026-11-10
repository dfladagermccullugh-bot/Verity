export type GuardResult =
  | { kind: "question"; text: string }
  | { kind: "stop_confirm" }
  | { kind: "prd"; markdown: string }
  | { kind: "reject"; reason: string };

export const STOP_CONFIRM = "I think I have enough — want me to write the PRD now?";

/** Normalize for a tolerant stop-confirmation match: case, quotes, emphasis,
 *  dash variants, sentence punctuation and whitespace are all ignored. */
function normalizeStop(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/["\u201c\u201d*_`]/g, " ")
    .replace(/[\u2012-\u2015\-–—.,;:!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const STOP_NORMALIZED = normalizeStop(STOP_CONFIRM);

export function isStopConfirm(raw: string): boolean {
  return normalizeStop(raw) === STOP_NORMALIZED;
}

/**
 * Jargon blocklist. Terms match on word boundaries (optionally plural), never
 * as substrings, so "restaurant", "trust", "therapist" and "reaction" pass.
 * Terms that are also ordinary English words ("react", "rust", "rest") are
 * blocked only in their technology spelling: capitalized as a proper noun, or
 * in an unambiguous phrase ("rest api", "react native").
 */
const JARGON_TERMS = [
  "framework",
  "database",
  "api",
  "next.js",
  "nextjs",
  "react.js",
  "reactjs",
  "react native",
  "sql",
  "nosql",
  "auth provider",
  "oauth",
  "jwt",
  "rest api",
  "restful",
  "graphql",
  "kubernetes",
  "docker",
  "microservice",
  "monorepo",
  "typescript",
  "javascript",
  "python",
  "backend",
  "back-end",
  "frontend",
  "front-end",
  "devops",
  "ci/cd",
  "hosting provider",
  "cdn",
  "redis",
  "postgres",
  "postgresql",
  "mongodb",
];
/** Case-sensitive proper-noun spellings of words that are otherwise ordinary. */
const JARGON_PROPER = ["React", "Rust", "REST"];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
const JARGON_RES: { term: string; re: RegExp }[] = [
  ...JARGON_TERMS.map((term) => ({
    term,
    re: new RegExp(`(?<![a-z0-9])${escapeRe(term)}(?:e?s)?(?![a-z0-9])`, "i"),
  })),
  ...JARGON_PROPER.map((term) => ({
    term: term.toLowerCase(),
    // Case-sensitive; not at the very start (a capitalized first word is just
    // grammar: "Rest assured…", "React how…").
    re: new RegExp(`(?<=.)(?<![A-Za-z0-9])${term}(?![A-Za-z0-9])`),
  })),
];

/** The first jargon term in `text`, or null. */
export function findJargon(text: string): string | null {
  for (const { term, re } of JARGON_RES) if (re.test(text)) return term;
  return null;
}

export function guardOutput(raw: string): GuardResult {
  const trimmed = raw.trim();

  // Final PRD path
  if (trimmed.startsWith("===PRD===")) {
    return { kind: "prd", markdown: trimmed.replace(/^===PRD===\s*/, "") };
  }

  // Stop confirmation path (tolerant: case, quotes, dashes, punctuation)
  if (isStopConfirm(trimmed)) return { kind: "stop_confirm" };

  // Question path — must be a single line ending in '?'
  if (!trimmed.endsWith("?")) return { kind: "reject", reason: "no_question_mark" };
  if (trimmed.includes("\n")) return { kind: "reject", reason: "multiline" };
  if (trimmed.length > 200) return { kind: "reject", reason: "too_long" };

  // Block batched questions
  if (/\b(and|or)\b.*\?.*\?/i.test(trimmed)) return { kind: "reject", reason: "batched" };
  if ((trimmed.match(/\?/g) || []).length > 1)
    return { kind: "reject", reason: "multiple_questions" };

  // Block jargon — questions that clearly drift into systems-design territory
  const jargon = findJargon(trimmed);
  if (jargon) return { kind: "reject", reason: `jargon:${jargon}` };

  return { kind: "question", text: trimmed };
}
