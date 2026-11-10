import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readQsf } from "../src/qualtrics/qsf.js";
import { renderReadinessReport } from "../src/report/readiness.js";

/**
 * Optional: point QSF_SAMPLES_DIR at a folder of real .qsf exports to check that each one is
 * either read or refused with reasons, and never crashes. Third-party files are not committed.
 */
const dir = process.env.QSF_SAMPLES_DIR;
const files = dir && existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".qsf")) : [];

describe.skipIf(files.length === 0)("real Qualtrics exports", () => {
  it.each(files)("%s is read or refused with reasons", (file) => {
    const result = readQsf(readFileSync(join(dir!, file), "utf8"));
    const blockers = result.findings.filter((f) => f.severity === "blocker");
    expect(result.instrument === null).toBe(blockers.length > 0);
    expect(blockers.map((b) => b.code)).not.toContain("not_qsf");
    expect(renderReadinessReport(result, file).length).toBeGreaterThan(50);
  });
});
