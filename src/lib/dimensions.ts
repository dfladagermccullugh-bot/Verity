/**
 * Construct-dimension tagging (Survey Methodology — measurement coverage).
 *
 * Each interview question is mapped to one of the coverage dimensions the
 * interview already tracks (see `skill/idea-seeding-agent.md` Step 2). This is
 * a deterministic, keyword-based classifier — no model call, so it adds no
 * latency to the question loop and is fully auditable. It is intentionally
 * blunt; the goal is a useful coverage map and a triangulation signal, not
 * perfect linguistic classification. Tags are stored per turn and rolled up
 * into the per-round analysis document.
 */

export type DimensionId =
  | "problem"
  | "primary_user"
  | "core_jobs"
  | "inputs"
  | "outputs"
  | "platform_context"
  | "data_sensitivity"
  | "scale"
  | "integrations"
  | "success_signal"
  | "unclassified";

/** Canonical order + human label for each tracked dimension. */
export const DIMENSIONS: { id: DimensionId; label: string }[] = [
  { id: "problem", label: "Problem" },
  { id: "primary_user", label: "Primary user" },
  { id: "core_jobs", label: "Core jobs" },
  { id: "inputs", label: "Inputs" },
  { id: "outputs", label: "Outputs" },
  { id: "platform_context", label: "Platform & context" },
  { id: "data_sensitivity", label: "Data sensitivity" },
  { id: "scale", label: "Scale" },
  { id: "integrations", label: "Integrations" },
  { id: "success_signal", label: "Success signal" },
];

/** The ten substantive dimensions (excludes the `unclassified` residual). */
export const TRACKED_DIMENSIONS: DimensionId[] = DIMENSIONS.map((d) => d.id);

// Keyword sets, checked case-insensitively as substrings. Order of the map
// follows the canonical dimension order; ties in hit-count resolve to the
// earliest dimension.
const KEYWORDS: Record<Exclude<DimensionId, "unclassified">, string[]> = {
  problem: [
    "problem",
    "pain",
    "frustrat",
    "struggle",
    "currently",
    "right now",
    "instead of",
    "solve",
    "difficult",
    "hard to",
  ],
  primary_user: [
    "who ",
    "user",
    "audience",
    "customer",
    "parent",
    "teacher",
    "student",
    "kid",
    "child",
    "professional",
    "for people",
    "for adults",
    "beginner",
  ],
  core_jobs: [
    "task",
    " job",
    "accomplish",
    "want to",
    "need to",
    "able to",
    "use it to",
    "main thing",
    "primarily",
    "core",
  ],
  inputs: [
    "input",
    "enter",
    "provide",
    "upload",
    "fill in",
    "type in",
    "record their",
    "capture",
    "log ",
    "add their",
  ],
  outputs: [
    "output",
    "result",
    "report",
    "receive",
    "get back",
    "produce",
    "generate",
    "summary",
    "recommend",
    "see a",
    "shown",
  ],
  platform_context: [
    "phone",
    "mobile",
    "desktop",
    "laptop",
    "web",
    "browser",
    "device",
    "offline",
    "on the go",
    "at home",
    "at work",
    "where ",
    "in person",
  ],
  data_sensitivity: [
    "private",
    "sensitive",
    "personal",
    "confidential",
    "health",
    "financial",
    "secure",
    "privacy",
    "anonym",
    "consent",
  ],
  scale: [
    "many",
    "thousand",
    "volume",
    "at once",
    "a lot of",
    "large number",
    "how many",
    "grow",
    "busy",
    "concurrent",
  ],
  integrations: [
    "integrat",
    "connect",
    "third-party",
    "third party",
    "external",
    "sync",
    "import",
    "export",
    "calendar",
    "payment",
    "other tools",
    "existing tool",
  ],
  success_signal: [
    "success",
    "metric",
    "measure",
    "worth",
    "valuable",
    "working well",
    "come back",
    "retention",
    "engagement",
    "satisfied",
  ],
};

/**
 * Classify a question into its most likely coverage dimension. Returns
 * `unclassified` when no keyword matches. Scoring counts keyword hits and
 * picks the highest-scoring dimension, breaking ties by canonical order.
 */
export function classifyDimension(questionText: string): DimensionId {
  const lower = ` ${questionText.toLowerCase()} `;
  let best: DimensionId = "unclassified";
  let bestScore = 0;
  for (const { id } of DIMENSIONS) {
    const terms = KEYWORDS[id as Exclude<DimensionId, "unclassified">];
    let score = 0;
    for (const term of terms) {
      if (lower.includes(term)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}
