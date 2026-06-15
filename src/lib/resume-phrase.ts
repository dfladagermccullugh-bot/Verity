/**
 * Human-readable resume phrase (e.g. `river-mauve-7`). The durable invite link
 * already carries identity across rounds; this phrase is only a device-
 * portability backstop the operator can read back to a respondent who lost
 * their link. It is never required input. A resolver route is deferred — for
 * now the phrase is generated and stored so the backstop exists on record.
 */

const ADJECTIVES = [
  "river",
  "amber",
  "quiet",
  "north",
  "slate",
  "ember",
  "tidal",
  "lunar",
  "cedar",
  "violet",
];

const NOUNS = [
  "mauve",
  "harbor",
  "willow",
  "cobalt",
  "meadow",
  "cinder",
  "marble",
  "lantern",
  "thicket",
  "current",
];

function pick<T>(xs: T[]): T {
  return xs[Math.floor(Math.random() * xs.length)];
}

export function generateResumePhrase(): string {
  const n = Math.floor(Math.random() * 90) + 10; // 10–99
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${n}`;
}
