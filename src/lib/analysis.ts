/**
 * Per-round response-quality analysis (Survey Methodology — the "AI Analyst"
 * layer). Pure functions over the round's turns: no I/O, no model calls, so
 * the math is unit-testable without burning credits. The rendered markdown
 * ships as a third companion document (alongside the PRD and the methodology
 * disclosure) and the structured metrics are included in the training export.
 *
 * Nothing here is shown to the respondent — it is backend-only signal about
 * how much to trust each answer:
 *  - acquiescence (yes-drift) and straightlining,
 *  - response latency / satisficing flags,
 *  - leading-question rewrite rate,
 *  - construct-coverage map,
 *  - triangulation reliability (consistency of repeated-dimension answers).
 */

import { DIMENSIONS, type DimensionId } from "./dimensions";

/** Minimal turn shape the analysis needs — a structural subset of the DB row,
 *  so callers and tests can pass plain objects. */
export interface AnalyzableTurn {
  answer: string | null;
  timeToAnswerMs: number | null;
  constructDimension: string | null;
  leadingVerdict: string | null;
}

export interface RoundAnalysis {
  answeredQuestions: number;
  yesCount: number;
  noCount: number;
  /** yes / (yes + no); null when no binary answers. */
  yesRatio: number | null;
  /** yesRatio ≥ 0.8 over ≥ 5 binary answers. */
  acquiescenceFlag: boolean;
  /** Longest run of identical consecutive yes/no answers. */
  longestStraightRun: number;
  meanLatencyMs: number | null;
  medianLatencyMs: number | null;
  /** Answers faster than the satisficing threshold. */
  tooFastCount: number;
  leadingRewriteCount: number;
  /** rewrites / answeredQuestions. */
  leadingRate: number | null;
  coveredDimensions: DimensionId[];
  uncoveredDimensions: DimensionId[];
  /** Dimensions probed ≥ 2× and whether the repeated answers agreed. */
  triangulation: {
    dimension: DimensionId;
    answers: string[];
    consistent: boolean;
  }[];
  /** consistent triangulation pairs / total triangulated dimensions. */
  reliabilityScore: number | null;
}

/** Below this, a yes/no tap is unlikely to reflect real comprehension. */
export const TOO_FAST_MS = 800;
const ACQUIESCENCE_RATIO = 0.8;
const ACQUIESCENCE_MIN_N = 5;

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

export function computeAnalysis(turns: AnalyzableTurn[]): RoundAnalysis {
  // Only binary answers count toward measurement signal; "done" and pending
  // turns are excluded.
  const binary = turns.filter((t) => t.answer === "yes" || t.answer === "no");
  const yesCount = binary.filter((t) => t.answer === "yes").length;
  const noCount = binary.filter((t) => t.answer === "no").length;
  const yesRatio = binary.length > 0 ? yesCount / binary.length : null;

  let longestStraightRun = 0;
  let run = 0;
  let prev: string | null = null;
  for (const t of binary) {
    if (t.answer === prev) run += 1;
    else run = 1;
    prev = t.answer;
    if (run > longestStraightRun) longestStraightRun = run;
  }

  const latencies = turns
    .map((t) => t.timeToAnswerMs)
    .filter((v): v is number => typeof v === "number" && v >= 0);
  const meanLatencyMs =
    latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null;
  const tooFastCount = latencies.filter((v) => v < TOO_FAST_MS).length;

  const leadingRewriteCount = turns.filter(
    (t) => t.leadingVerdict === "rewritten"
  ).length;

  // Coverage + triangulation, keyed by dimension over answered turns.
  const byDimension = new Map<string, string[]>();
  for (const t of turns) {
    if (t.answer == null || t.answer === "done") continue;
    const dim = t.constructDimension ?? "unclassified";
    const list = byDimension.get(dim) ?? [];
    list.push(t.answer);
    byDimension.set(dim, list);
  }

  const coveredDimensions = DIMENSIONS.map((d) => d.id).filter((id) =>
    byDimension.has(id)
  );
  const uncoveredDimensions = DIMENSIONS.map((d) => d.id).filter(
    (id) => !byDimension.has(id)
  );

  const triangulation = DIMENSIONS.map((d) => d.id)
    .filter((id) => (byDimension.get(id)?.length ?? 0) >= 2)
    .map((id) => {
      const answers = byDimension.get(id)!;
      const consistent = answers.every((a) => a === answers[0]);
      return { dimension: id, answers, consistent };
    });
  const reliabilityScore =
    triangulation.length > 0
      ? triangulation.filter((t) => t.consistent).length / triangulation.length
      : null;

  return {
    answeredQuestions: binary.length,
    yesCount,
    noCount,
    yesRatio,
    acquiescenceFlag:
      binary.length >= ACQUIESCENCE_MIN_N &&
      yesRatio !== null &&
      yesRatio >= ACQUIESCENCE_RATIO,
    longestStraightRun,
    meanLatencyMs,
    medianLatencyMs: median(latencies),
    tooFastCount,
    leadingRewriteCount,
    leadingRate: binary.length > 0 ? leadingRewriteCount / binary.length : null,
    coveredDimensions,
    uncoveredDimensions,
    triangulation,
    reliabilityScore,
  };
}

function pct(x: number | null): string {
  return x === null ? "n/a" : `${Math.round(x * 100)}%`;
}

function labelOf(id: DimensionId): string {
  return DIMENSIONS.find((d) => d.id === id)?.label ?? id;
}

/**
 * Render the analysis as the body of the companion document. The caller wraps
 * it with a provenance header (see disclosure.ts) so the framing matches the
 * PRD and methodology documents.
 */
export function renderAnalysisMarkdown(a: RoundAnalysis): string {
  const lines: string[] = [];
  lines.push("# Response-Quality Analysis");
  lines.push("");
  lines.push(
    "Backend measurement diagnostics for this interview round. These signals were not shown to the respondent; they describe how much to trust the answers behind the companion PRD."
  );
  lines.push("");

  lines.push("## Acquiescence (yes-drift)");
  lines.push("");
  lines.push(`- Answered yes/no questions: ${a.answeredQuestions}`);
  lines.push(`- Yes / No: ${a.yesCount} / ${a.noCount}`);
  lines.push(`- Yes ratio: ${pct(a.yesRatio)}`);
  lines.push(`- Longest identical-answer run: ${a.longestStraightRun}`);
  lines.push(
    `- Acquiescence flag: ${a.acquiescenceFlag ? "RAISED — answers skew heavily to one side; treat agreement with caution" : "not raised"}`
  );
  lines.push("");

  lines.push("## Response latency");
  lines.push("");
  lines.push(`- Mean: ${a.meanLatencyMs ?? "n/a"} ms`);
  lines.push(`- Median: ${a.medianLatencyMs ?? "n/a"} ms`);
  lines.push(
    `- Answers under ${TOO_FAST_MS} ms (possible satisficing): ${a.tooFastCount}`
  );
  lines.push("");

  lines.push("## Question phrasing");
  lines.push("");
  lines.push(
    `- Questions rewritten for leading phrasing before display: ${a.leadingRewriteCount} (${pct(a.leadingRate)})`
  );
  lines.push("");

  lines.push("## Construct coverage");
  lines.push("");
  lines.push(
    `- Covered: ${a.coveredDimensions.length > 0 ? a.coveredDimensions.map(labelOf).join(", ") : "none"}`
  );
  lines.push(
    `- Not covered: ${a.uncoveredDimensions.length > 0 ? a.uncoveredDimensions.map(labelOf).join(", ") : "none"}`
  );
  lines.push("");

  lines.push("## Triangulation reliability");
  lines.push("");
  if (a.triangulation.length === 0) {
    lines.push("- No dimension was probed more than once; no reliability signal.");
  } else {
    lines.push(`- Reliability (consistent repeats): ${pct(a.reliabilityScore)}`);
    for (const t of a.triangulation) {
      lines.push(
        `- ${labelOf(t.dimension)}: ${t.answers.join(", ")} → ${t.consistent ? "consistent" : "INCONSISTENT"}`
      );
    }
  }
  lines.push("");

  return lines.join("\n");
}
