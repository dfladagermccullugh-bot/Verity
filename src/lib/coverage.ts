/**
 * Construct-coverage gate (Survey Methodology — content validity).
 *
 * The interview tracks ten construct dimensions (see `dimensions.ts`). Letting
 * the model decide on its own when it has "enough" can end a round after a
 * single question — under-covering the construct. Rather than impose an
 * arbitrary minimum question *count* (which would trade content validity for
 * respondent burden), the engine requires a minimum construct *coverage* before
 * it will accept the model's request to stop. This is content validity enforced
 * as a deterministic guardrail, consistent with the project's method; it never
 * overrides an explicit "done" from the respondent.
 *
 * Pure functions only — no I/O, no model calls — so the gate is unit-testable.
 */

import { DIMENSIONS, TRACKED_DIMENSIONS, type DimensionId } from "./dimensions";

/** Minimum distinct tracked dimensions a round must touch before the model may
 *  stop. Set below the full ten because the keyword classifier is deliberately
 *  blunt; tune as live data accumulates. */
export const COVERAGE_FLOOR = 7;

/** Minimal turn shape the gate needs — a structural subset of the DB row. */
export interface CoverageTurn {
  answer: string | null;
  constructDimension: string | null;
}

/** Distinct tracked dimensions with at least one answered (non-"done") turn. */
export function coveredDimensions(turns: CoverageTurn[]): DimensionId[] {
  const seen = new Set<string>();
  for (const t of turns) {
    if (t.answer == null || t.answer === "done") continue;
    if (
      t.constructDimension &&
      TRACKED_DIMENSIONS.includes(t.constructDimension as DimensionId)
    ) {
      seen.add(t.constructDimension);
    }
  }
  return TRACKED_DIMENSIONS.filter((d) => seen.has(d));
}

/** Tracked dimensions not yet touched by an answered turn. */
export function uncoveredDimensions(turns: CoverageTurn[]): DimensionId[] {
  const covered = new Set(coveredDimensions(turns));
  return TRACKED_DIMENSIONS.filter((d) => !covered.has(d));
}

/** Human labels for the uncovered dimensions, for a prompt nudge. */
export function uncoveredDimensionLabels(turns: CoverageTurn[]): string[] {
  const uncovered = new Set(uncoveredDimensions(turns));
  return DIMENSIONS.filter((d) => uncovered.has(d.id)).map((d) => d.label);
}

/** True once the round has covered enough dimensions for the model to stop. */
export function coverageMet(
  turns: CoverageTurn[],
  floor: number = COVERAGE_FLOOR
): boolean {
  return coveredDimensions(turns).length >= floor;
}
