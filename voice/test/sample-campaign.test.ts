import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runSampleCampaign } from "../src/demo/sample-campaign.js";
import { parseCsv } from "../src/util/csv.js";
import { testDb } from "./db.js";
import { library } from "./helpers.js";

const file = (name: string) => new URL(`../docs/${name}`, import.meta.url);

describe("the simulated campaign", () => {
  it("produces the committed report and response file (set UPDATE_SAMPLES=1 to regenerate)", async () => {
    const out = await runSampleCampaign(await testDb(), library());
    const targets: [string, string][] = [["sample-campaign-report.md", out.report], ["sample-campaign-responses.csv", out.responsesCsv]];
    for (const [name, content] of targets) {
      if (process.env.UPDATE_SAMPLES === "1" || !existsSync(file(name))) writeFileSync(file(name), content);
      expect(readFileSync(file(name), "utf8"), name).toBe(content);
    }

    // The report covers each part a methodologist would look for.
    for (const heading of ["## 1. What happened to each case", "## 2. Outcome rates", "## 3. Answer quality", "## 4. For a person to check", "## 5. Methodology disclosure"]) expect(out.report).toContain(heading);
    expect(out.report).toContain("Sample: 58 people with consent on file. 2 contacts had no valid consent on file and were never called");
    expect(out.report).toContain("I am an automated AI interviewer, not a person.");
    expect(out.report).toMatch(/\| RR1 \| \d+\.\d% \|/);

    // The response file is importable in shape: three header rows, one row per person who answered anything.
    const rows = parseCsv(out.responsesCsv);
    expect(rows[2]!.every((c) => c.startsWith('{"ImportId"'))).toBe(true);
    expect(rows.every((r) => r.length === rows[0]!.length)).toBe(true);
    const data = rows.slice(3);
    const finished = data.filter((r) => r[5] === "1").length;
    expect(finished).toBeGreaterThan(35);
    expect(data.length).toBeGreaterThan(finished);
    // People who asked to be removed are on the do-not-call list, and only they.
    expect(parseCsv(out.doNotCallCsv).length - 1).toBe(3);
  }, 120_000);

  it("is identical on every run", async () => {
    const a = await runSampleCampaign(await testDb(), library());
    const b = await runSampleCampaign(await testDb(), library());
    expect(a).toEqual(b);
  }, 120_000);
});
