const WORDS = [
  "planting",
  "sprouting",
  "watering",
  "rooting",
  "blooming",
  "growing",
  "weeding",
];

export function randomLoadingWord(): string {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

export const LOADING_WORDS = WORDS;
