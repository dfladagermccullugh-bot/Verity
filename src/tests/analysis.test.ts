import { describe, it, expect } from "vitest";
import {
  computeAnalysis,
  renderAnalysisMarkdown,
  TOO_FAST_MS,
  type AnalyzableTurn,
} from "@/lib/analysis";

function turn(p: Partial<AnalyzableTurn>): AnalyzableTurn {
  return {
    answer: p.answer ?? "yes",
    timeToAnswerMs: p.timeToAnswerMs ?? 2000,
    constructDimension: p.constructDimension ?? "problem",
    leadingVerdict: p.leadingVerdict ?? "clean",
  };
}

describe("computeAnalysis — acquiescence", () => {
  it("raises the flag and counts the straight run when answers skew to yes", () => {
    const turns = Array.from({ length: 6 }, () =>
      turn({ answer: "yes", constructDimension: "problem" })
    );
    const a = computeAnalysis(turns);
    expect(a.answeredQuestions).toBe(6);
    expect(a.yesCount).toBe(6);
    expect(a.yesRatio).toBe(1);
    expect(a.acquiescenceFlag).toBe(true);
    expect(a.longestStraightRun).toBe(6);
  });

  it("does not raise the flag for a balanced, short interview", () => {
    const a = computeAnalysis([
      turn({ answer: "yes" }),
      turn({ answer: "no" }),
      turn({ answer: "yes" }),
    ]);
    expect(a.acquiescenceFlag).toBe(false);
    expect(a.longestStraightRun).toBe(1);
  });
});

describe("computeAnalysis — latency", () => {
  it("counts answers under the satisficing threshold", () => {
    const a = computeAnalysis([
      turn({ timeToAnswerMs: TOO_FAST_MS - 1 }),
      turn({ timeToAnswerMs: TOO_FAST_MS + 1, answer: "no" }),
      turn({ timeToAnswerMs: 5000 }),
    ]);
    expect(a.tooFastCount).toBe(1);
    expect(a.meanLatencyMs).not.toBeNull();
  });
});

describe("computeAnalysis — leading rate", () => {
  it("counts rewritten turns", () => {
    const a = computeAnalysis([
      turn({ leadingVerdict: "rewritten" }),
      turn({ leadingVerdict: "clean", answer: "no" }),
    ]);
    expect(a.leadingRewriteCount).toBe(1);
    expect(a.leadingRate).toBe(0.5);
  });
});

describe("computeAnalysis — coverage + triangulation", () => {
  it("reports covered/uncovered dimensions", () => {
    const a = computeAnalysis([
      turn({ constructDimension: "problem" }),
      turn({ constructDimension: "primary_user", answer: "no" }),
    ]);
    expect(a.coveredDimensions).toContain("problem");
    expect(a.coveredDimensions).toContain("primary_user");
    expect(a.uncoveredDimensions).toContain("scale");
  });

  it("flags an inconsistent repeated-dimension pair", () => {
    const a = computeAnalysis([
      turn({ constructDimension: "scale", answer: "yes" }),
      turn({ constructDimension: "scale", answer: "no" }),
    ]);
    expect(a.triangulation).toHaveLength(1);
    expect(a.triangulation[0].consistent).toBe(false);
    expect(a.reliabilityScore).toBe(0);
  });

  it("marks a consistent repeated-dimension pair as reliable", () => {
    const a = computeAnalysis([
      turn({ constructDimension: "outputs", answer: "yes" }),
      turn({ constructDimension: "outputs", answer: "yes" }),
    ]);
    expect(a.triangulation[0].consistent).toBe(true);
    expect(a.reliabilityScore).toBe(1);
  });
});

describe("renderAnalysisMarkdown", () => {
  it("renders the expected section headings", () => {
    const md = renderAnalysisMarkdown(computeAnalysis([turn({})]));
    expect(md).toMatch(/# Response-Quality Analysis/);
    expect(md).toMatch(/## Acquiescence/);
    expect(md).toMatch(/## Response latency/);
    expect(md).toMatch(/## Construct coverage/);
    expect(md).toMatch(/## Triangulation reliability/);
  });
});
