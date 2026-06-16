/**
 * Pure comparison logic for the reliability canary suite.
 *
 * Implements the drift-detection recipe described in §4.2.4 of the AAPOR
 * Task Force on Responsible AI Integration in Survey Research (2026):
 * periodically reprocess a fixed reference dataset, track key output
 * distributions over time, and surface deviations beyond a stated tolerance.
 *
 * Pure functions only — no I/O, no model calls, no `server-only` import.
 * This lets the comparator be unit-tested without burning model credits.
 */

import type { Baseline, SeedMetrics } from "./types";

/** Drift tolerances. Permissive on purpose: start loose, tighten as we learn
 *  what natural variance looks like. */
export const TOLERANCES = {
  /** Integer counts (e.g. turnCount) may drift by this many units. */
  countAbs: 1,
  /** Ratios (e.g. guardRejectRate) may drift by this absolute amount. */
  ratioAbs: 0.05,
  /** Lengths may drift by this fraction of the baseline value. */
  lengthFrac: 0.2,
} as const;

export type DriftFinding = {
  seedId: string;
  metric: string;
  baseline: string | number | boolean;
  observed: string | number | boolean;
  reason: string;
};

export interface DriftReport {
  driftFound: boolean;
  modelMismatch: string | null;
  unbaselinedSeeds: string[];
  missingFromObserved: string[];
  findings: DriftFinding[];
}

function pctDrift(baseline: number, observed: number): number {
  if (baseline === 0) return observed === 0 ? 0 : Infinity;
  return Math.abs(observed - baseline) / Math.abs(baseline);
}

function compareSeed(
  seedId: string,
  baseline: SeedMetrics,
  observed: SeedMetrics,
): DriftFinding[] {
  const findings: DriftFinding[] = [];

  // turnCount — integer count tolerance.
  if (Math.abs(observed.turnCount - baseline.turnCount) > TOLERANCES.countAbs) {
    findings.push({
      seedId,
      metric: "turnCount",
      baseline: baseline.turnCount,
      observed: observed.turnCount,
      reason: `count drift > ±${TOLERANCES.countAbs}`,
    });
  }

  // guardRejectRate — absolute ratio tolerance.
  if (
    Math.abs(observed.guardRejectRate - baseline.guardRejectRate) >
    TOLERANCES.ratioAbs
  ) {
    findings.push({
      seedId,
      metric: "guardRejectRate",
      baseline: baseline.guardRejectRate,
      observed: observed.guardRejectRate,
      reason: `rate drift > ±${TOLERANCES.ratioAbs}`,
    });
  }

  // meanQuestionLengthChars — fractional tolerance.
  if (
    pctDrift(baseline.meanQuestionLengthChars, observed.meanQuestionLengthChars) >
    TOLERANCES.lengthFrac
  ) {
    findings.push({
      seedId,
      metric: "meanQuestionLengthChars",
      baseline: baseline.meanQuestionLengthChars,
      observed: observed.meanQuestionLengthChars,
      reason: `length drift > ±${TOLERANCES.lengthFrac * 100}%`,
    });
  }

  // prdHeadingsPresent — every baseline heading regex must still be required
  // (we check against the actual PRD elsewhere; here we just verify the set
  // didn't shrink, which would indicate the baseline itself was relaxed).
  for (const pat of baseline.prdHeadingsPresent) {
    if (!observed.prdHeadingsPresent.includes(pat)) {
      findings.push({
        seedId,
        metric: "prdHeadingsPresent",
        baseline: pat,
        observed: "missing",
        reason: "baseline heading no longer matched in generated PRD",
      });
    }
  }

  // terminatedNaturally — flip is worth surfacing but not necessarily failing
  // (a model getting better at converging is good drift). Report as a finding
  // and let the operator judge from the report.
  if (observed.terminatedNaturally !== baseline.terminatedNaturally) {
    findings.push({
      seedId,
      metric: "terminatedNaturally",
      baseline: baseline.terminatedNaturally,
      observed: observed.terminatedNaturally,
      reason: "termination path changed (natural vs. forced)",
    });
  }

  return findings;
}

/**
 * Compare a fresh canary run to the committed baseline. Returns a structured
 * report; the runner formats it as a table and decides the exit code.
 */
export function compareToBaseline(
  liveModel: string,
  baseline: Baseline,
  observed: Record<string, SeedMetrics>,
): DriftReport {
  const report: DriftReport = {
    driftFound: false,
    modelMismatch: null,
    unbaselinedSeeds: [],
    missingFromObserved: [],
    findings: [],
  };

  // Un-baselined state: model is null or seeds is empty. The runner treats
  // this as a no-op success — but only the first time, with a loud message.
  if (baseline.model === null) {
    report.unbaselinedSeeds = Object.keys(observed);
    return report;
  }

  if (baseline.model !== liveModel) {
    report.modelMismatch = `${baseline.model} → ${liveModel}`;
    report.driftFound = true;
  }

  for (const [seedId, observedMetrics] of Object.entries(observed)) {
    const baselineMetrics = baseline.seeds[seedId];
    if (!baselineMetrics) {
      report.unbaselinedSeeds.push(seedId);
      continue;
    }
    const findings = compareSeed(seedId, baselineMetrics, observedMetrics);
    if (findings.length > 0) {
      report.driftFound = true;
      report.findings.push(...findings);
    }
  }

  // Seeds that exist in the baseline but were not observed indicate a fixture
  // was removed or skipped — surface for review.
  for (const seedId of Object.keys(baseline.seeds)) {
    if (!(seedId in observed)) report.missingFromObserved.push(seedId);
  }
  if (report.missingFromObserved.length > 0) report.driftFound = true;

  return report;
}

/** Format a drift report as a plain-text table for terminal + GitHub Issue. */
export function formatReport(liveModel: string, report: DriftReport): string {
  const lines: string[] = [];
  lines.push(`Live model: ${liveModel}`);
  if (report.modelMismatch) {
    lines.push(`⚠ Model id changed since last baseline: ${report.modelMismatch}`);
  }
  if (report.unbaselinedSeeds.length > 0) {
    lines.push(
      `Seeds with no baseline (run \`npm run canary:rebaseline\`): ${report.unbaselinedSeeds.join(", ")}`,
    );
  }
  if (report.missingFromObserved.length > 0) {
    lines.push(
      `⚠ Seeds in baseline but not observed this run: ${report.missingFromObserved.join(", ")}`,
    );
  }
  if (report.findings.length === 0) {
    lines.push(report.driftFound ? "" : "No drift detected.");
  } else {
    lines.push("");
    lines.push("Drift findings:");
    lines.push("seed                              metric                  baseline          observed          reason");
    lines.push("--------------------------------- ----------------------- ----------------- ----------------- -----------------------------");
    for (const f of report.findings) {
      lines.push(
        [
          f.seedId.padEnd(33),
          f.metric.padEnd(23),
          String(f.baseline).padEnd(17),
          String(f.observed).padEnd(17),
          f.reason,
        ].join(" "),
      );
    }
  }
  return lines.join("\n");
}
