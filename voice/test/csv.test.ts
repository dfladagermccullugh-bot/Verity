import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { writeResponsesCsv, responseColumns, type InterviewRecord } from "../src/qualtrics/csv.js";
import { emptyState } from "../src/engine/flow.js";
import { readQsf } from "../src/qualtrics/qsf.js";
import { RESPONSE_A, RESPONSE_B, library, question, run, survey } from "./helpers.js";

const inst = library();

function record(caseId: string, answers: typeof RESPONSE_A, minutes: number): InterviewRecord {
  const r = run(inst, (k) => answers[k]!);
  const startedAt = new Date("2026-11-10T15:00:00Z");
  return { caseId, startedAt, endedAt: new Date(startedAt.getTime() + minutes * 60_000), finished: true, state: r.state, embedded: { vv_mode: "ai_voice", vv_case_id: caseId, vv_outcome: "complete" } };
}

/** Minimal CSV reader for checking our own output. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(cell), (cell = "");
    else if (ch === "\r" && text[i + 1] === "\n") row.push(cell), rows.push(row), (row = []), (cell = ""), i++;
    else cell += ch;
  }
  return rows;
}

describe("Qualtrics response file", () => {
  const csv = writeResponsesCsv(inst, [record("case-A", RESPONSE_A, 6), record("case-B", RESPONSE_B, 2)]);
  const rows = parseCsv(csv);

  it("matches the committed expected file exactly", () => {
    const expected = readFileSync(new URL("../fixtures/qualtrics/library-test-expected-import.csv", import.meta.url), "utf8");
    expect(csv).toBe(expected);
  });

  it("has three header rows: names, descriptions, import ids", () => {
    expect(rows[0]).toEqual(["StartDate", "EndDate", "Status", "Progress", "Duration (in seconds)", "Finished", "Q2", "Q3", "Q4_1", "Q4_2", "Q4_3", "Q5", "Q6", "Q7", "Q8", "Q9", "vv_mode", "vv_case_id"]);
    expect(rows[1]![6]).toBe("In the past 12 months, have you visited a public library?");
    expect(rows[1]![9]).toBe("How much do you agree or disagree with each statement? - The opening hours suit me.");
    expect(rows[2]!.map((c) => (JSON.parse(c) as { ImportId: string }).ImportId)).toEqual(["startDate", "endDate", "status", "progress", "duration", "finished", "QID2", "QID3", "QID4_1", "QID4_2", "QID4_3", "QID5", "QID6_TEXT", "QID7", "QID8_TEXT", "QID9", "vv_mode", "vv_case_id"]);
    expect(rows.every((r) => r.length === rows[0]!.length)).toBe(true);
  });

  it("writes response A in full", () => {
    expect(rows[3]).toEqual(["2026-11-10 15:00:00", "2026-11-10 15:06:00", "0", "100", "360", "1", "1", "3", "4", "3", "5", "8", "12", "1", "Longer weekend hours", "2", "ai_voice", "case-A"]);
  });

  it("leaves questions that were not asked blank (response B)", () => {
    expect(rows[4]).toEqual(["2026-11-10 15:00:00", "2026-11-10 15:02:00", "0", "100", "120", "1", "2", "", "", "", "", "3", "0", "2", "", "", "ai_voice", "case-B"]);
  });

  it("only writes embedded fields the survey declares", () => {
    expect(rows[0]).not.toContain("vv_outcome");
  });

  it("writes a declined answer as blank and an unfinished interview as partial", () => {
    const state = { ...emptyState(), heard: ["QID1"], answers: { QID2: { kind: "nonresponse", reason: "refused" } as const, QID5: { kind: "choice", code: "7" } as const } };
    const partial: InterviewRecord = { caseId: "p", startedAt: new Date("2026-11-10T15:00:00Z"), endedAt: new Date("2026-11-10T15:00:30Z"), finished: false, state };
    const row = parseCsv(writeResponsesCsv(inst, [partial]))[3]!;
    expect(row.slice(2, 7)).toEqual(["0", "20", "30", "0", ""]);
    expect(row[11]).toBe("7");
  });

  it("quotes commas, quotes and line breaks", () => {
    const state = run(inst, (k) => (k === "QID8" ? { kind: "text", value: 'More "quiet" rooms, please\nand longer hours' } : RESPONSE_A[k]!)).state;
    const out = writeResponsesCsv(inst, [{ caseId: "q", startedAt: new Date(0), endedAt: new Date(0), finished: true, state }]);
    expect(out).toContain('"More ""quiet"" rooms, please\nand longer hours"');
    expect(parseCsv(out)[3]![14]).toBe('More "quiet" rooms, please\nand longer hours');
  });

  it("writes recode values, not internal choice ids", () => {
    const i2 = readQsf(survey([question("QID1", { RecodeValues: { "1": "100", "2": "0" } })])).instrument!;
    const out = writeResponsesCsv(i2, [{ caseId: "r", startedAt: new Date(0), endedAt: new Date(0), finished: true, state: { heard: [], answers: { QID1: { kind: "choice", code: "1" } } } }]);
    expect(parseCsv(out)[3]![6]).toBe("100");
    expect(responseColumns(i2).map((c) => c.name)).toContain("Q1");
  });
});

describe("what Qualtrics did with our import file (its own export afterwards, 2026-11-11)", () => {
  // library-test-numeric.csv is a genuine export from a Qualtrics account after
  // library-test-expected-import.csv was imported into the test survey.
  const table = (file: string) => {
    const [header, , , ...rows] = parseCsv(readFileSync(new URL(`../fixtures/qualtrics/${file}`, import.meta.url), "utf8"));
    const byCase = new Map(rows.filter((r) => r.length > 1).map((r) => [r[header!.indexOf("vv_case_id")]!, r]));
    return { header: header!, byCase };
  };
  const sent = table("library-test-expected-import.csv");
  const got = table("library-test-numeric.csv");

  it("kept both responses, with every value in the field it was sent to", () => {
    expect([...got.byCase.keys()].sort()).toEqual(["case-A", "case-B"]);
    for (const [caseId, row] of sent.byCase) {
      for (const [i, column] of sent.header.entries()) {
        if (column === "Status") continue;
        expect([caseId, column, got.byCase.get(caseId)![got.header.indexOf(column)]]).toEqual([caseId, column, row[i]]);
      }
    }
  });

  it("marks them as imported, and works out the recommend group itself", () => {
    const col = (name: string) => [...got.byCase.values()].map((r) => r[got.header.indexOf(name)]);
    // We send Status 0 (a normal response); Qualtrics records 4, its code for an imported response.
    expect(col("Status")).toEqual(["4", "4"]);
    expect(got.header).toContain("Q5_NPS_GROUP");
    expect(got.byCase.get("case-A")![got.header.indexOf("Q5_NPS_GROUP")]).toBe("2"); // 8 of 10: passive
    expect(got.byCase.get("case-B")![got.header.indexOf("Q5_NPS_GROUP")]).toBe("1"); // 3 of 10: detractor
  });
});
