import { describe, expect, it } from "vitest";
import { htmlToText } from "../src/instrument/text.js";
import { emptyState, markHeard, nextStep, recordAnswer } from "../src/engine/flow.js";
import { readQsf } from "../src/qualtrics/qsf.js";
import { buildScript, isYesNo, linesForStep } from "../src/script/script.js";
import { LIBRARY_QSF, library, question, survey } from "./helpers.js";

describe("spoken script", () => {
  const inst = library();
  const script = buildScript(inst);

  it("every survey line is the survey file's wording, unchanged", () => {
    const raw = JSON.parse(LIBRARY_QSF) as { SurveyElements: { Element: string; Payload: Record<string, any> }[] };
    const wording = new Set<string>();
    for (const e of raw.SurveyElements.filter((x) => x.Element === "SQ")) {
      wording.add(htmlToText(e.Payload.QuestionText));
      if (e.Payload.QuestionType === "Matrix") for (const c of Object.values<any>(e.Payload.Choices)) wording.add(htmlToText(c.Display));
    }
    const surveyLines = script.lines.filter((l) => l.source === "survey");
    expect(surveyLines.length).toBe(12);
    for (const line of surveyLines) expect(wording.has(line.text)).toBe(true);
  });

  it("template lines contain the option wording verbatim, in order", () => {
    expect(script.lines.find((l) => l.id === "q.QID3.options")!.text).toBe("The answer options are: Once a week or more; A few times a month; About once a month; A few times a year; or Only once.");
    expect(script.lines.find((l) => l.id === "q.QID4.options")!.text).toBe("For each one, the answer options are: Strongly disagree; Somewhat disagree; Neither agree nor disagree; Somewhat agree; or Strongly agree.");
    expect(script.lines.find((l) => l.id === "q.QID5.options")!.text).toBe("Please answer with a number from 0 to 10, where 0 means Not at all likely and 10 means Extremely likely.");
  });

  it("plain yes/no questions get no options line; open and number questions neither", () => {
    expect(isYesNo(inst.items[1]!.choices!)).toBe(true);
    for (const id of ["QID2", "QID6", "QID7", "QID8"]) expect(script.lines.filter((l) => l.itemId === id).map((l) => l.role)).toEqual(["question"]);
  });

  it("line ids are unique and the hash is stable", () => {
    expect(new Set(script.lines.map((l) => l.id)).size).toBe(script.lines.length);
    expect(buildScript(library()).hash).toBe(script.hash);
    expect(script.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the hash changes when any wording changes", () => {
    const a = buildScript(readQsf(survey([question("QID1", { QuestionText: "Do you own a car?" })])).instrument!);
    const b = buildScript(readQsf(survey([question("QID1", { QuestionText: "Do you own a car ?" })])).instrument!);
    const c = buildScript(readQsf(survey([question("QID1", { QuestionText: "Do you own a car?", Choices: { "1": { Display: "Yes" }, "2": { Display: "Nope" } } })])).instrument!);
    expect(new Set([a.hash, b.hash, c.hash]).size).toBe(3);
  });

  it("says the grid question and options once, then one statement per step", () => {
    let state = markHeard(inst, emptyState(), "QID1");
    state = recordAnswer(inst, state, "QID2", { kind: "choice", code: "1" });
    state = recordAnswer(inst, state, "QID3", { kind: "choice", code: "1" });
    const first = nextStep(inst, state);
    expect(linesForStep(script, first).map((l) => l.id)).toEqual(["q.QID4.ask", "q.QID4.options", "q.QID4.row.1"]);
    state = recordAnswer(inst, state, "QID4#1", { kind: "choice", code: "4" });
    const second = nextStep(inst, state);
    expect(linesForStep(script, second).map((l) => l.id)).toEqual(["q.QID4.row.2"]);
    expect(linesForStep(script, second, { repeatStem: true }).map((l) => l.id)).toEqual(["q.QID4.ask", "q.QID4.options", "q.QID4.row.2"]);
  });

  it("every step of an interview has something to say, and it is always a script line", () => {
    let state = emptyState();
    for (;;) {
      const step = nextStep(inst, state);
      if (step.kind === "end") break;
      const lines = linesForStep(script, step);
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) expect(script.lines).toContain(l);
      state = step.kind === "statement" ? markHeard(inst, state, step.item.id) : recordAnswer(inst, state, step.slot.key, { kind: "nonresponse", reason: "no_answer" });
    }
  });
});
