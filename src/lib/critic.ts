import "server-only";
import { callModelOneShot } from "./anthropic";

/**
 * Between-round gap-analysis critic (Survey Methodology — content & cognitive
 * adequacy; a second AAPOR "Analyst" pass). After a round's PRD is compiled,
 * a separate model call reads the transcript + PRD and decides whether enough
 * is still ambiguous or missing to justify another round of questions. If so,
 * it emits a focus brief that steers the next round's questions.
 *
 * Runs off the hot path (at round finalization, not between questions), so its
 * one model call never adds latency to the respondent's loop. Advisory only:
 * a human operator opens rounds. A parse or transport failure returns null
 * ("not assessed"), which the engine stores as a null verdict — never as
 * "no further round needed".
 */

const SYSTEM_PROMPT = `You are a survey-methodology critic reviewing a completed round of a constrained yes/no product interview and the PRD it produced. Your job is to decide whether a FURTHER round of yes/no questions would materially improve the PRD, and if so, what it should focus on.

Judge against coverage of these dimensions: problem, primary user, core jobs, inputs, outputs, platform & context, data sensitivity, scale, integrations, success signal. Only recommend another round when something important is genuinely ambiguous, contradictory, or missing — not merely for polish.

Respond with a single JSON object — no prose, no markdown fences — with exactly these keys:

{
  "openNewRound": true or false,
  "gaps": ["short phrases naming what is still unclear or missing"],
  "focus": "One sentence telling the interviewer what the next round should probe. Empty string if openNewRound is false."
}`;

export interface CriticResult {
  openNewRound: boolean;
  gaps: string[];
  focus: string;
}

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : raw).trim();
  return JSON.parse(candidate);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** Tolerant parse. Returns null on malformed output (no verdict). */
export function parseCritic(raw: string): CriticResult | null {
  try {
    const parsed = extractJson(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.openNewRound !== "boolean") return null;
    const gaps = isStringArray(obj.gaps) ? obj.gaps : [];
    const focus = typeof obj.focus === "string" ? obj.focus : "";
    // A recommendation without a focus to steer it is read as "don't".
    if (obj.openNewRound && focus.trim() === "") return { ...STOP, gaps };
    return { openNewRound: obj.openNewRound, gaps, focus };
  } catch {
    return null;
  }
}

const STOP: CriticResult = { openNewRound: false, gaps: [], focus: "" };

/** Run the critic over a finished round. Never throws; null on failure. */
export async function critiqueRound(
  seed: string,
  transcript: string,
  prdMarkdown: string
): Promise<CriticResult | null> {
  try {
    const user = [
      `Seed: ${seed}`,
      "",
      "Transcript (Q/A):",
      transcript,
      "",
      "PRD produced this round:",
      prdMarkdown,
    ].join("\n");
    const raw = await callModelOneShot(SYSTEM_PROMPT, user);
    return parseCritic(raw);
  } catch {
    return null;
  }
}
