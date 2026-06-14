// Telemetry-style processing states surfaced while the model resolves the next
// turn. Engraved-uppercase, instrument tone — no consumer-grade flourish.
const WORDS = [
  "ANALYZING",
  "PROCESSING",
  "COMPUTING",
  "EVALUATING",
  "RESOLVING",
  "PARSING",
  "QUERYING",
];

export function randomLoadingWord(): string {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

export const LOADING_WORDS = WORDS;
