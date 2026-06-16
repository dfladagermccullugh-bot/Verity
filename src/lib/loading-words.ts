// Quiet processing states surfaced while the model resolves the next turn.
// Calm, sentence-case tone to match the rest of the interface.
const WORDS = [
  "Analyzing…",
  "Processing…",
  "Computing…",
  "Evaluating…",
  "Resolving…",
  "Parsing…",
  "Querying…",
];

export function randomLoadingWord(): string {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

export const LOADING_WORDS = WORDS;
