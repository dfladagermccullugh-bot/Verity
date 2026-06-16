import { describe, it, expect } from "vitest";
import { compareToBaseline, TOLERANCES, formatReport } from "@/lib/canaries/compare";
import type { Baseline, SeedMetrics } from "@/lib/canaries/types";

const MODEL = "claude-sonnet-4-6";

function metrics(overrides: Partial<SeedMetrics> = {}): SeedMetrics {
  return {
    turnCount: 8,
    guardRejectRate: 0.05,
    meanQuestionLengthChars: 60,
    prdHeadingsPresent: ["^# ", "^## "],
    terminatedNaturally: true,
    ...overrides,
  };
}

function baseline(seed = "kids-multiplication-puzzle"): Baseline {
  return { model: MODEL, seeds: { [seed]: metrics() } };
}

describe("compareToBaseline — un-baselined state", () => {
  it("treats a null-model baseline as no-op success and lists every observed seed", () => {
    const b: Baseline = { model: null, seeds: {} };
    const report = compareToBaseline(MODEL, b, { foo: metrics() });
    expect(report.driftFound).toBe(false);
    expect(report.unbaselinedSeeds).toEqual(["foo"]);
  });
});

describe("compareToBaseline — model id", () => {
  it("flags mismatched model id as drift", () => {
    const b = baseline();
    const report = compareToBaseline("claude-opus-4-1", b, {
      "kids-multiplication-puzzle": metrics(),
    });
    expect(report.driftFound).toBe(true);
    expect(report.modelMismatch).toContain("→ claude-opus-4-1");
  });
});

describe("compareToBaseline — per-metric tolerances", () => {
  const seedId = "kids-multiplication-puzzle";

  it("accepts turnCount drift within ±1", () => {
    const report = compareToBaseline(MODEL, baseline(), {
      [seedId]: metrics({ turnCount: 9 }),
    });
    expect(report.driftFound).toBe(false);
  });

  it("flags turnCount drift > ±1", () => {
    const report = compareToBaseline(MODEL, baseline(), {
      [seedId]: metrics({ turnCount: 12 }),
    });
    expect(report.driftFound).toBe(true);
    expect(report.findings.find((f) => f.metric === "turnCount")).toBeTruthy();
  });

  it("accepts guardRejectRate drift within ±0.05", () => {
    const report = compareToBaseline(MODEL, baseline(), {
      [seedId]: metrics({ guardRejectRate: 0.09 }),
    });
    expect(report.driftFound).toBe(false);
  });

  it("flags guardRejectRate drift > ±0.05", () => {
    const report = compareToBaseline(MODEL, baseline(), {
      [seedId]: metrics({ guardRejectRate: 0.25 }),
    });
    expect(report.driftFound).toBe(true);
    expect(
      report.findings.find((f) => f.metric === "guardRejectRate"),
    ).toBeTruthy();
  });

  it("accepts meanQuestionLengthChars drift within ±20%", () => {
    const report = compareToBaseline(MODEL, baseline(), {
      [seedId]: metrics({ meanQuestionLengthChars: 70 }), // +16.7%
    });
    expect(report.driftFound).toBe(false);
  });

  it("flags meanQuestionLengthChars drift > ±20%", () => {
    const report = compareToBaseline(MODEL, baseline(), {
      [seedId]: metrics({ meanQuestionLengthChars: 90 }), // +50%
    });
    expect(report.driftFound).toBe(true);
    expect(
      report.findings.find((f) => f.metric === "meanQuestionLengthChars"),
    ).toBeTruthy();
  });

  it("flags a missing baseline heading regex", () => {
    const report = compareToBaseline(MODEL, baseline(), {
      [seedId]: metrics({ prdHeadingsPresent: ["^# "] }), // dropped ^##
    });
    expect(report.driftFound).toBe(true);
    expect(
      report.findings.find((f) => f.metric === "prdHeadingsPresent"),
    ).toBeTruthy();
  });

  it("flags a termination-path flip", () => {
    const report = compareToBaseline(MODEL, baseline(), {
      [seedId]: metrics({ terminatedNaturally: false }),
    });
    expect(report.driftFound).toBe(true);
    expect(
      report.findings.find((f) => f.metric === "terminatedNaturally"),
    ).toBeTruthy();
  });
});

describe("compareToBaseline — fixture presence", () => {
  it("flags seeds in baseline but missing from the run", () => {
    const b: Baseline = {
      model: MODEL,
      seeds: { a: metrics(), b: metrics() },
    };
    const report = compareToBaseline(MODEL, b, { a: metrics() });
    expect(report.driftFound).toBe(true);
    expect(report.missingFromObserved).toEqual(["b"]);
  });

  it("treats new seeds as unbaselined, not as drift", () => {
    const report = compareToBaseline(MODEL, baseline(), {
      "kids-multiplication-puzzle": metrics(),
      "new-fixture": metrics(),
    });
    expect(report.driftFound).toBe(false);
    expect(report.unbaselinedSeeds).toEqual(["new-fixture"]);
  });
});

describe("formatReport", () => {
  it("renders 'no drift' when nothing failed", () => {
    const report = compareToBaseline(MODEL, baseline(), {
      "kids-multiplication-puzzle": metrics(),
    });
    expect(formatReport(MODEL, report)).toContain("No drift detected");
  });

  it("includes the seed id and metric name in the table for each finding", () => {
    const report = compareToBaseline(MODEL, baseline(), {
      "kids-multiplication-puzzle": metrics({ turnCount: 20 }),
    });
    const out = formatReport(MODEL, report);
    expect(out).toContain("kids-multiplication-puzzle");
    expect(out).toContain("turnCount");
  });
});

describe("tolerances are the values documented in the handoff", () => {
  it("matches the documented tolerances", () => {
    expect(TOLERANCES.countAbs).toBe(1);
    expect(TOLERANCES.ratioAbs).toBe(0.05);
    expect(TOLERANCES.lengthFrac).toBe(0.2);
  });
});
