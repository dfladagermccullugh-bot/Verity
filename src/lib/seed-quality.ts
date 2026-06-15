/**
 * Seed-quality pre-check (Survey Methodology — comprehension; catch a bad
 * starting referent before it poisons every downstream question). Returns
 * non-blocking warnings only: a muddy seed still proceeds (consistent with
 * moderation failing open), but the warnings are stored on the session and
 * surfaced to the operator so a low-quality elicitation is identifiable.
 *
 * Deterministic and pure — no model call, unit-testable.
 */

export type SeedWarning =
  | "vague"
  | "double_barreled"
  | "presupposition"
  | "too_short";

// "X and Y" / "X & Y" / "X plus Y" suggesting two ideas stapled together.
const DOUBLE_BARRELED = /\b(and|&|plus|as well as|along with)\b/i;

// Coercive / leading framing baked into the seed itself.
const PRESUPPOSITION = [
  "obviously",
  "everyone needs",
  "everyone wants",
  "the best",
  "clearly the",
  "no one else",
  "revolutionary",
  "the only",
];

// Filler that carries no construct ("an app for stuff", "a tool for things").
const VAGUE_TERMS = ["stuff", "things", "etc", "various", "some kind of", "whatever"];

export function seedWarnings(seed: string): SeedWarning[] {
  const warnings: SeedWarning[] = [];
  const trimmed = seed.trim();
  const lower = trimmed.toLowerCase();

  if (trimmed.length < 15 || trimmed.split(/\s+/).length < 4) {
    warnings.push("too_short");
  }
  if (DOUBLE_BARRELED.test(trimmed)) {
    warnings.push("double_barreled");
  }
  if (PRESUPPOSITION.some((p) => lower.includes(p))) {
    warnings.push("presupposition");
  }
  if (VAGUE_TERMS.some((v) => lower.includes(v))) {
    warnings.push("vague");
  }

  return warnings;
}
