import "server-only";
import { callModelOneShot } from "./anthropic";

/**
 * Pre-flight construct-validity probe.
 *
 * Implements the validity-check pattern recommended in §4.3.1 of the AAPOR
 * Task Force on Responsible AI Integration in Survey Research (2026): before
 * the model generates substantive content, prompt it to (a) restate the goal
 * in its own words, (b) list scope boundaries, and (c) specify what would
 * count as a correct vs. out-of-scope output. The brief is persisted on the
 * session and surfaced to the human reviewer so a session whose interview
 * targeted the *wrong construct* is identifiable after the fact.
 *
 * Log-only by design — the brief is NOT fed back into the interview system
 * prompt. Closing the loop would constrain question generation and make
 * drift between brief and interview harder to audit; that is a deliberate
 * call deferred to a later iteration.
 */

const SYSTEM_PROMPT = `You are a research-validity auditor for an AI-conducted interview that turns a one-sentence product idea (the "seed") into a Product Requirements Document (PRD).

Your only job is to restate the seed's intent before the interview begins, so a human reviewer can later confirm the interview was about the right thing. You are NOT asking questions, designing the interview, or writing the PRD.

You will receive the seed. Respond with a single JSON object — no prose, no markdown fences, no preamble — with exactly these keys:

{
  "goal": "One sentence stating the construct being elicited: what kind of PRD this seed implies.",
  "scope": "One sentence stating the in-bounds and out-of-bounds boundaries of the elicitation.",
  "inBoundsExamples": ["3–5 short phrases naming concrete topics the interview SHOULD cover"],
  "outOfBoundsExamples": ["3–5 short phrases naming concrete topics the interview should NOT cover"]
}

Be specific to this seed. Avoid generic phrasing that would apply to any product. Do not anthropomorphize the model or invoke "understanding"; describe the task, not the model.`;

export interface ConstructBriefJson {
  goal: string;
  scope: string;
  inBoundsExamples: string[];
  outOfBoundsExamples: string[];
}

/** Tolerant JSON extractor: accept the raw object, or one wrapped in a
 *  ```json fence the model might add despite instructions. */
function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : raw).trim();
  return JSON.parse(candidate);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function parseBrief(raw: string): ConstructBriefJson | null {
  try {
    const parsed = extractJson(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.goal !== "string") return null;
    if (typeof obj.scope !== "string") return null;
    if (!isStringArray(obj.inBoundsExamples)) return null;
    if (!isStringArray(obj.outOfBoundsExamples)) return null;
    return {
      goal: obj.goal,
      scope: obj.scope,
      inBoundsExamples: obj.inBoundsExamples,
      outOfBoundsExamples: obj.outOfBoundsExamples,
    };
  } catch {
    return null;
  }
}

/** Render the JSON into the markdown that ships in admin views and downloads. */
export function briefToMarkdown(brief: ConstructBriefJson): string {
  const inList = brief.inBoundsExamples.map((s) => `- ${s}`).join("\n");
  const outList = brief.outOfBoundsExamples.map((s) => `- ${s}`).join("\n");
  return [
    "## Goal",
    "",
    brief.goal,
    "",
    "## Scope",
    "",
    brief.scope,
    "",
    "## In bounds",
    "",
    inList,
    "",
    "## Out of bounds",
    "",
    outList,
    "",
  ].join("\n");
}

/**
 * Generate the construct-validity probe for a seed. Returns the rendered
 * markdown ready for storage, or `null` if the model output could not be
 * parsed — callers should treat absence as non-fatal and let the interview
 * proceed without a brief on file.
 */
export async function buildConstructBrief(seed: string): Promise<string | null> {
  const raw = await callModelOneShot(SYSTEM_PROMPT, `Seed: ${seed}`);
  const brief = parseBrief(raw);
  if (!brief) return null;
  return briefToMarkdown(brief);
}
