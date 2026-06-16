import { describe, it, expect } from "vitest";
import {
  coveredDimensions,
  uncoveredDimensions,
  uncoveredDimensionLabels,
  coverageMet,
  COVERAGE_FLOOR,
} from "@/lib/coverage";
import { TRACKED_DIMENSIONS, type DimensionId } from "@/lib/dimensions";

/** Build answered turns covering the given dimensions (one "yes" each). */
function turns(dims: DimensionId[]) {
  return dims.map((d) => ({ answer: "yes", constructDimension: d }));
}

describe("coveredDimensions", () => {
  it("is empty with no turns", () => {
    expect(coveredDimensions([])).toEqual([]);
  });

  it("excludes pending (null) and 'done' turns", () => {
    const ts = [
      { answer: null, constructDimension: "problem" },
      { answer: "done", constructDimension: "scale" },
      { answer: "yes", constructDimension: "inputs" },
    ];
    expect(coveredDimensions(ts)).toEqual(["inputs"]);
  });

  it("counts a repeated dimension only once", () => {
    const ts = turns(["problem", "problem", "scale"]);
    expect(coveredDimensions(ts).sort()).toEqual(["problem", "scale"].sort());
  });

  it("ignores unclassified / unknown dimension tags", () => {
    const ts = [
      { answer: "yes", constructDimension: "unclassified" },
      { answer: "no", constructDimension: null },
      { answer: "yes", constructDimension: "outputs" },
    ];
    expect(coveredDimensions(ts)).toEqual(["outputs"]);
  });

  it("returns dimensions in canonical order", () => {
    const ts = turns(["success_signal", "problem", "inputs"]);
    expect(coveredDimensions(ts)).toEqual(["problem", "inputs", "success_signal"]);
  });
});

describe("uncoveredDimensions", () => {
  it("is all tracked dimensions when nothing is covered", () => {
    expect(uncoveredDimensions([])).toEqual(TRACKED_DIMENSIONS);
  });

  it("is the complement of covered", () => {
    const ts = turns(["problem", "scale"]);
    const uncovered = uncoveredDimensions(ts);
    expect(uncovered).not.toContain("problem");
    expect(uncovered).not.toContain("scale");
    expect(uncovered.length).toBe(TRACKED_DIMENSIONS.length - 2);
  });
});

describe("uncoveredDimensionLabels", () => {
  it("returns human labels for the uncovered set", () => {
    const ts = turns(TRACKED_DIMENSIONS.filter((d) => d !== "data_sensitivity"));
    expect(uncoveredDimensionLabels(ts)).toEqual(["Data sensitivity"]);
  });
});

describe("coverageMet", () => {
  it("is false below the floor and true at/above it", () => {
    const below = turns(TRACKED_DIMENSIONS.slice(0, COVERAGE_FLOOR - 1));
    const at = turns(TRACKED_DIMENSIONS.slice(0, COVERAGE_FLOOR));
    expect(coverageMet(below)).toBe(false);
    expect(coverageMet(at)).toBe(true);
  });

  it("respects a custom floor", () => {
    const ts = turns(["problem", "scale"]);
    expect(coverageMet(ts, 2)).toBe(true);
    expect(coverageMet(ts, 3)).toBe(false);
  });

  it("default floor is below the full set so a blunt classifier won't over-trigger", () => {
    expect(COVERAGE_FLOOR).toBeLessThan(TRACKED_DIMENSIONS.length);
  });
});
