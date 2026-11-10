import { describe, expect, it } from "vitest";
import { readQsf } from "../src/qualtrics/qsf.js";
import { renderReadinessReport } from "../src/report/readiness.js";
import { buildScript } from "../src/script/script.js";
import { LIBRARY_QSF, library, question, survey } from "./helpers.js";

describe("phone-readiness report", () => {
  it("for a ready survey: verdict, logic in plain words, the full script and its version", () => {
    const report = renderReadinessReport(readQsf(LIBRARY_QSF), "library-test.qsf");
    expect(report).toContain("# Phone-readiness report: Library test");
    expect(report).toContain("**Verdict: READY.** No concerns found.");
    expect(report).toContain('| 3 | QID3 | Single choice | QID2 is "Yes" | Continue |');
    expect(report).toContain('If QID7 is "No": end the survey');
    const script = buildScript(library());
    expect(report).toContain(script.hash.slice(0, 12));
    for (const line of script.lines) expect(report).toContain(line.text);
    expect(report).toContain("`vv_outcome`, `vv_script`");
  });

  it("for a refused survey: names each problem and shows no script", () => {
    const report = renderReadinessReport(readQsf(survey([question("QID1"), question("QID2", { Selector: "MAVR" })])), "x.qsf");
    expect(report).toContain("# Phone-readiness report: Test survey");
    expect(report).toContain("**Verdict: NOT READY.** 1 thing must change");
    expect(report).toContain("- **QID2:** Select-all-that-apply questions are not supported yet.");
    expect(report).not.toContain("## Spoken script");
  });

  it("lists warnings without blocking", () => {
    const report = renderReadinessReport(readQsf(survey([question("QID1", { QuestionText: "Click the answer below." })])), "x.qsf");
    expect(report).toContain("**Verdict: READY.** 1 point worth reviewing.");
    expect(report).toContain("## Worth reviewing");
  });

  it("falls back to the file name when the file cannot be read", () => {
    expect(renderReadinessReport(readQsf("nope"), "broken.qsf")).toContain("# Phone-readiness report: broken.qsf");
  });
});
