/**
 * Methodology disclosure appended to every generated PRD.
 *
 * Structured to satisfy the Required Disclosures (Table 4) from the AAPOR
 * Task Force on Responsible AI Integration in Survey Research (2026), with
 * model/prompt/sampling details from the Enhanced Disclosures (Table 5).
 *
 * Verity sits in the highest-risk quadrant of the AAPOR taxonomy: AI as
 * Interviewer (asking questions) and AI as Analyst (synthesizing the PRD).
 * Both roles trigger required disclosure under the framework.
 *
 * Provenance is frozen with the artifact at finalization time so that a
 * reader, months later, can still see the exact model, prompt fingerprint,
 * and date that produced this specific PRD.
 */

import { getModelName, MAX_TOKENS } from "./anthropic";
import { getSkillVersion } from "./skill/version";

export interface MethodologyInputs {
  /** Override for deterministic tests. Defaults to today, UTC, YYYY-MM-DD. */
  date?: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function buildMethodologyFooter(inputs: MethodologyInputs = {}): string {
  const date = inputs.date ?? today();
  const model = getModelName();
  const promptFingerprint = getSkillVersion();

  return [
    "",
    "---",
    "",
    "## Methodology",
    "",
    "This PRD was produced through an AI-mediated interview. The disclosures below follow the Required Disclosures framework of the AAPOR Task Force on Responsible AI Integration in Survey Research (2026).",
    "",
    "**Tasks performed by AI.** *Interviewer* — administered a constrained yes/no interview, generating each question dynamically from prior responses. *Analyst* — synthesized this PRD from the seed and the answered turns.",
    "",
    "**Description of AI's role.** A single LLM, given a fixed system prompt, asked one yes/no question per turn until it determined sufficient information had been collected, then produced this PRD in markdown. Every model output was passed through a deterministic guard that rejects multi-line replies, batched questions, technology jargon, and questions over 200 characters; rejected outputs trigger one regeneration and, on second failure, force the PRD-write path. A turn ceiling of 40 questions short-circuits to PRD generation if the model fails to terminate.",
    "",
    "**Human oversight and validation.** Question-generation outputs are validated turn-by-turn by the deterministic guard described above (the rule-bounded conversation engine recommended in AAPOR §3.1.1). The completed PRD is reviewed by a human operator before any downstream action is taken. No subset audit of historical interview transcripts has been conducted as of this generation.",
    "",
    "**Human respondents.** N = 1 (the invitee). No synthetic responses, imputation, or simulated samples were used at any stage.",
    "",
    "**Model and configuration.**",
    `- Model: \`${model}\``,
    "- Access method: direct API (Anthropic Messages API with prompt caching)",
    `- System prompt fingerprint (SHA-256, first 12 chars): \`${promptFingerprint}\``,
    "- Fine-tuning: none",
    "- Retrieval (RAG): none",
    "- Statefulness: stateful within a session (the full prior turn history is supplied to every call); stateless across sessions",
    `- Sampling parameters: Anthropic API defaults; max_tokens = ${MAX_TOKENS}; no custom temperature, top_p, or seed`,
    `- Date of generation: ${date}`,
    "",
  ].join("\n");
}
