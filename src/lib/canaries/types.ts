/**
 * Types shared between the canary runner and the comparator.
 *
 * Kept free of runtime imports so the comparator can be unit-tested without
 * pulling in `server-only`, the Anthropic SDK, or the rest of the engine.
 */

export interface SeedFixture {
  id: string;
  category: string;
  seed: string;
  answerScript: string[];
}

export interface SeedMetrics {
  turnCount: number;
  guardRejectRate: number;
  meanQuestionLengthChars: number;
  prdHeadingsPresent: string[];
  terminatedNaturally: boolean;
}

export interface Baseline {
  model: string | null;
  seeds: Record<string, SeedMetrics>;
}
