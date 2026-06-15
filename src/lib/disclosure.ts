/**
 * AAPOR-style methodology disclosure for Verity PRDs.
 *
 * Structure follows the Required Disclosures (Table 4) from the AAPOR Task
 * Force on Responsible AI Integration in Survey Research (2026), with
 * model/prompt/sampling details from the Enhanced Disclosures (Table 5).
 *
 * Verity sits in the highest-risk quadrant of the AAPOR taxonomy: AI as
 * Interviewer (asking questions) and AI as Analyst (synthesizing the PRD).
 * Both roles trigger required disclosure under the framework.
 *
 * The disclosure is delivered as a *companion document* rather than inlined
 * in the PRD body, so that the PRD remains clean for downstream consumers
 * (notably AI coding agents). The two documents are linked by the Verity
 * session ID, which appears in both filenames and in a header line on each
 * document — so the association survives separation in transit.
 */

import { getModelName, MAX_TOKENS } from "./anthropic";
import { getSkillVersion } from "./skill/version";
import { renderAnalysisMarkdown, type RoundAnalysis } from "./analysis";

export interface DocumentInputs {
  sessionId: string;
  /** Override for deterministic tests. Defaults to today, UTC, YYYY-MM-DD. */
  date?: string;
}

export interface MethodologyInputs extends DocumentInputs {
  /** True iff a construct-validity probe (AAPOR §4.3.1) was logged for the
   *  session. Surfaced as a single line under Human oversight and validation
   *  so the disclosure reflects only what actually happened. */
  constructBriefPresent?: boolean;
  /** PRD version this document accompanies (round number). Defaults to 1. */
  prdVersion?: number;
  /** True iff a response-quality analysis companion was produced. */
  analysisPresent?: boolean;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function prdFilename(sessionId: string): string {
  return `prd-${sessionId}.md`;
}

export function methodologyFilename(sessionId: string): string {
  return `methodology-${sessionId}.md`;
}

export function analysisFilename(sessionId: string): string {
  return `analysis-${sessionId}.md`;
}

/**
 * Header prepended to the PRD body. An HTML comment, so it is invisible when
 * the markdown is rendered but still present in the raw text — enough for a
 * recipient (human or agent) to identify the companion methodology document
 * if the files are ever separated.
 */
export function buildPrdHeader(inputs: DocumentInputs): string {
  const date = inputs.date ?? today();
  return [
    `<!-- Verity PRD · Session ${inputs.sessionId} · Generated ${date} · Companion methodology document: ${methodologyFilename(inputs.sessionId)} -->`,
    "",
    "",
  ].join("\n");
}

/**
 * The standalone methodology document. Frozen at PRD finalization time so
 * the model identifier, prompt fingerprint, and date reflect the conditions
 * that produced the linked PRD — not whatever is configured today.
 */
export function buildMethodologyDocument(inputs: MethodologyInputs): string {
  const date = inputs.date ?? today();
  const model = getModelName();
  const promptFingerprint = getSkillVersion();
  const companion = prdFilename(inputs.sessionId);
  const version = inputs.prdVersion ?? 1;

  const oversightLines = [
    "Question-generation outputs are validated turn-by-turn by the deterministic guard described above (the rule-bounded conversation engine recommended in AAPOR §3.1.1). The completed PRD is reviewed by a human operator before any downstream action is taken. No subset audit of historical interview transcripts has been conducted as of this generation.",
  ];
  if (inputs.constructBriefPresent) {
    oversightLines.push(
      "",
      "**Construct-validity probe:** A structured restatement of the seed's intent — goal, scope, in-bounds and out-of-bounds examples — was generated and logged before the first interview question, following AAPOR §4.3.1. The brief is available in the session record for human review.",
    );
  }
  if (inputs.analysisPresent) {
    oversightLines.push(
      "",
      `**Response-quality analysis:** Backend measurement diagnostics (acquiescence, response latency, leading-question rewrites, construct coverage, and triangulation reliability) were computed for this round and recorded in a companion document, \`${analysisFilename(inputs.sessionId)}\`. These signals were not shown to the respondent.`,
    );
  }

  return [
    `<!-- Verity Methodology · Session ${inputs.sessionId} · Generated ${date} · Companion PRD: ${companion} -->`,
    "",
    "# Methodology Disclosure",
    "",
    `**Verity Session:** \`${inputs.sessionId}\`  `,
    `**Companion PRD:** \`${companion}\`  `,
    `**PRD version (round):** ${version}  `,
    `**Generated:** ${date}`,
    "",
    `This document records the AI-mediation methodology for the PRD produced in Verity session \`${inputs.sessionId}\`. The disclosures below follow the Required Disclosures framework of the AAPOR Task Force on Responsible AI Integration in Survey Research (2026).`,
    "",
    "## Tasks performed by AI",
    "",
    "*Interviewer* — administered a constrained yes/no interview, generating each question dynamically from prior responses.",
    "",
    "*Analyst* — synthesized the companion PRD from the seed and the answered turns.",
    "",
    "## Description of AI's role",
    "",
    "A single LLM, given a fixed system prompt, asked one yes/no question per turn until it determined sufficient information had been collected, then produced the companion PRD in markdown. Every model output was passed through a deterministic guard that rejects multi-line replies, batched questions, technology jargon, and questions over 200 characters, and through a deterministic anti-leading check that rejects tag questions, loaded openers, and presupposition phrasing; rejected outputs are regenerated, and after repeated failures the PRD-write path is forced. A turn ceiling of 40 questions short-circuits to PRD generation if the model fails to terminate.",
    "",
    "Questions are *adaptively tailored* — each is generated from the prior answers rather than read from a fixed standardized script. This is a deliberate departure from standardized-measurement interviewing: it improves relevance but forgoes verbatim wording control, so each administered question is versioned and recorded per turn (with its construct dimension and any regeneration) to keep the wording auditable after the fact.",
    "",
    "Interviews may run in multiple rounds. After each round's PRD is compiled, a separate model call (a gap-analysis critic) reviews the transcript and PRD and may open a follow-up round of questions, producing a new PRD version. This document accompanies one such version.",
    "",
    "## Human oversight and validation",
    "",
    ...oversightLines,
    "",
    "## Human respondents",
    "",
    "N = 1 (the invitee). No synthetic responses, imputation, or simulated samples were used at any stage.",
    "",
    "## Model and configuration",
    "",
    `- **Model:** \`${model}\``,
    "- **Access method:** direct API (Anthropic Messages API with prompt caching)",
    `- **System prompt fingerprint (SHA-256, first 12 chars):** \`${promptFingerprint}\``,
    "- **Fine-tuning:** none",
    "- **Retrieval (RAG):** none",
    "- **Statefulness:** stateful within a session (the full prior turn history is supplied to every call); stateless across sessions",
    `- **Sampling parameters:** Anthropic API defaults; \`max_tokens = ${MAX_TOKENS}\`; no custom temperature, top_p, or seed`,
    `- **Date of generation:** ${date}`,
    "",
  ].join("\n");
}

export interface AnalysisInputs extends DocumentInputs {
  analysis: RoundAnalysis;
  prdVersion?: number;
}

/**
 * The standalone response-quality analysis document — the third companion file
 * alongside the PRD and methodology disclosure. Frozen at round finalization.
 */
export function buildAnalysisDocument(inputs: AnalysisInputs): string {
  const date = inputs.date ?? today();
  const version = inputs.prdVersion ?? 1;
  const companion = prdFilename(inputs.sessionId);
  return [
    `<!-- Verity Analysis · Session ${inputs.sessionId} · PRD v${version} · Generated ${date} · Companion PRD: ${companion} -->`,
    "",
    renderAnalysisMarkdown(inputs.analysis),
  ].join("\n");
}
