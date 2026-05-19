export type GuardResult =
  | { kind: "question"; text: string }
  | { kind: "stop_confirm" }
  | { kind: "prd"; markdown: string }
  | { kind: "reject"; reason: string };

export const STOP_CONFIRM = "I think I have enough — want me to write the PRD now?";

export function guardOutput(raw: string): GuardResult {
  const trimmed = raw.trim();

  // Final PRD path
  if (trimmed.startsWith("===PRD===")) {
    return { kind: "prd", markdown: trimmed.replace(/^===PRD===\s*/, "") };
  }

  // Stop confirmation path (exact match, normalized)
  const stop = STOP_CONFIRM;
  if (trimmed === stop || trimmed.toLowerCase() === stop.toLowerCase()) {
    return { kind: "stop_confirm" };
  }

  // Question path — must be a single line ending in '?'
  if (!trimmed.endsWith("?")) return { kind: "reject", reason: "no_question_mark" };
  if (trimmed.includes("\n")) return { kind: "reject", reason: "multiline" };
  if (trimmed.length > 200) return { kind: "reject", reason: "too_long" };

  // Block batched questions
  if (/\b(and|or)\b.*\?.*\?/i.test(trimmed)) return { kind: "reject", reason: "batched" };
  if ((trimmed.match(/\?/g) || []).length > 1)
    return { kind: "reject", reason: "multiple_questions" };

  // Block jargon — questions that clearly drift into systems-design territory
  const jargonBlocklist = [
    "framework",
    "database",
    "api",
    "react",
    "next.js",
    "sql",
    "nosql",
    "auth provider",
    "oauth",
    "jwt",
    "rest",
    "graphql",
    "kubernetes",
    "docker",
    "microservice",
    "monorepo",
    "typescript",
    "javascript",
    "python",
    "rust",
    "backend",
    "frontend",
    "devops",
    "ci/cd",
    "hosting provider",
    "cdn",
    "redis",
    "postgres",
    "mongodb",
  ];
  const lower = trimmed.toLowerCase();
  for (const term of jargonBlocklist) {
    if (lower.includes(term)) return { kind: "reject", reason: `jargon:${term}` };
  }

  return { kind: "question", text: trimmed };
}
