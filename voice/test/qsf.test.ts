import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readQsf } from "../src/qualtrics/qsf.js";
import { htmlToText } from "../src/instrument/text.js";
import { LIBRARY_QSF, blockerCodes, library, question, selected, showIf, survey } from "./helpers.js";

describe("reading the library test survey", () => {
  const inst = library();

  it("reads every question in flow order with its kind", () => {
    expect(inst.name).toBe("Library test");
    expect(inst.items.map((i) => [i.id, i.kind])).toEqual([
      ["QID1", "statement"],
      ["QID2", "single"],
      ["QID3", "single"],
      ["QID4", "grid"],
      ["QID5", "scale"],
      ["QID6", "number"],
      ["QID7", "single"],
      ["QID8", "text"],
      ["QID9", "single"],
    ]);
    expect(readQsf(LIBRARY_QSF).findings).toEqual([]);
  });

  it("keeps question and option wording exactly", () => {
    const q3 = inst.items[2]!;
    expect(q3.text).toBe("How often did you visit a public library in the past 12 months?");
    expect(q3.choices!.map((c) => c.label)).toEqual(["Once a week or more", "A few times a month", "About once a month", "A few times a year", "Only once"]);
  });

  it("reads the grid as statements with a shared scale", () => {
    const q4 = inst.items[3]!;
    expect(q4.rows!.map((r) => r.label)).toEqual(["The library staff are helpful.", "The opening hours suit me.", "The library is easy to get to."]);
    expect(q4.choices).toHaveLength(5);
    expect(q4.choices![4]).toEqual({ code: "5", label: "Strongly agree", exportValue: "5" });
  });

  it("reads the 0 to 10 scale with its end labels", () => {
    const q5 = inst.items[4]!;
    expect(q5.choices!.map((c) => c.exportValue)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    expect(q5.endLabels).toEqual({ low: "Not at all likely", high: "Extremely likely" });
  });

  it("reads number limits, display logic, skip logic and embedded data", () => {
    expect(inst.items[5]!.number).toEqual({ integer: true, min: 0, max: 500 });
    expect(inst.items[2]!.displayIf).toEqual({ op: "selected", itemId: "QID2", choiceCode: "1" });
    expect(inst.items[6]!.skips).toEqual([{ when: { op: "selected", itemId: "QID7", choiceCode: "2" }, to: { kind: "endOfSurvey" } }]);
    expect(inst.embeddedFields).toEqual(["vv_mode", "vv_case_id"]);
  });
});

describe("the same survey as Qualtrics itself exports it", () => {
  // library-test-real.qsf is the hand-written file after a round trip through a Qualtrics account
  // (imported, then exported, 2026-11-11). Qualtrics rewrote parts of it, so this is the format as
  // Qualtrics writes it today.
  const real = readQsf(readFileSync(new URL("../fixtures/qualtrics/library-test-real.qsf", import.meta.url), "utf8"));

  it("is read without findings, to the same questionnaire apart from its name and ID", () => {
    expect(real.findings).toEqual([]);
    const hand = readQsf(LIBRARY_QSF).instrument!;
    expect({ ...real.instrument!, surveyId: "", name: "" }).toEqual({ ...hand, surveyId: "", name: "" });
    expect(real.instrument!.name).toBe("verity_talk_test");
  });

  it("reads options that Qualtrics wrote as a list (codes 0, 1, 2, …) by their position", () => {
    const nps = real.instrument!.items.find((i) => i.id === "QID5")!;
    expect(nps.choices!.map((c) => c.code)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    expect(nps.choices!.map((c) => c.exportValue)).toEqual(nps.choices!.map((c) => c.code));
  });
});

describe("details of the format", () => {
  it("uses recode values for export and choice order for reading order", () => {
    const r = readQsf(survey([question("QID1", { Choices: { "1": { Display: "A" }, "4": { Display: "B" }, "7": { Display: "C" } }, ChoiceOrder: ["7", 1, 4], RecodeValues: { "1": "10", "4": "20", "7": "30" } })]));
    expect(r.instrument!.items[0]!.choices).toEqual([
      { code: "7", label: "C", exportValue: "30" },
      { code: "1", label: "A", exportValue: "10" },
      { code: "4", label: "B", exportValue: "20" },
    ]);
  });

  it("turns editor HTML into plain spoken text", () => {
    expect(htmlToText("This is a question.&nbsp;<div><br></div><div>What <b>kind</b> of fruit do you like most?</div>")).toBe("This is a question. What kind of fruit do you like most?");
    expect(htmlToText("Tom &amp; Jerry&#39;s &lt;show&gt; &#x263A;")).toBe("Tom & Jerry's <show> \u263a");
  });

  it("leaves out the trash block and questions that are in no block", () => {
    const doc = survey([question("QID1"), question("QID2")], { blockElements: [{ Type: "Question", QuestionID: "QID1" }, { Type: "Page Break" }] });
    expect(readQsf(doc).instrument!.items.map((i) => i.id)).toEqual(["QID1"]);
  });

  it("reads skip logic stored on the block element (older exports)", () => {
    const skip = [{ SkipLogicID: 1, ChoiceLocator: "q://QID1/SelectableChoice/1", Condition: "Selected", SkipToDestination: "ENDOFBLOCK", Locator: "q://QID1/SelectableChoice/1", QuestionID: "QID1" }];
    const doc = survey([question("QID1"), question("QID2")], { blockElements: [{ Type: "Question", QuestionID: "QID1", SkipLogic: skip }, { Type: "Question", QuestionID: "QID2" }] });
    expect(readQsf(doc).instrument!.items[0]!.skips).toEqual([{ when: { op: "selected", itemId: "QID1", choiceCode: "1" }, to: { kind: "endOfBlock" } }]);
  });

  it("reads combined conditions and number comparisons", () => {
    const num = question("QID2", { QuestionType: "TE", Selector: "SL", Choices: undefined, Validation: { Settings: { Type: "ContentType", ContentType: "ValidNumber", ValidNumber: { Min: "", Max: "", NumDecimals: "" } } } });
    const logic = showIf([selected("QID1", 1), { QuestionID: "QID2", LeftOperand: "q://QID2/ChoiceTextEntryValue", Operator: "GreaterThan", RightOperand: "3", Conjuction: "And" }]);
    const r = readQsf(survey([question("QID1"), num, question("QID3", { DisplayLogic: logic })]));
    expect(r.instrument!.items[1]!.number).toEqual({ integer: false });
    expect(r.instrument!.items[2]!.displayIf).toEqual({ op: "and", terms: [{ op: "selected", itemId: "QID1", choiceCode: "1" }, { op: "gt", itemId: "QID2", value: 3 }] });
  });

  it("omits page-timing questions with a warning rather than refusing", () => {
    const r = readQsf(survey([question("QID1"), question("QID2", { QuestionType: "Timing", Selector: "PageTimer" })]));
    expect(r.instrument!.items.map((i) => i.id)).toEqual(["QID1"]);
    expect(r.findings.map((f) => [f.severity, f.code])).toEqual([["warning", "not_asked"]]);
  });
});

describe("refusing what cannot be run by voice", () => {
  const cases: [string, unknown, string][] = [
    ["not JSON", "<html>", "not_qsf"],
    ["JSON that is not a survey file", { hello: 1 }, "not_qsf"],
    ["select all that apply", survey([question("QID1", { Selector: "MAVR" })]), "multi_select"],
    ["slider", survey([question("QID1", { QuestionType: "Slider", Selector: "HSLIDER" })]), "unsupported_type"],
    ["side by side", survey([question("QID1", { QuestionType: "SBS", Selector: "SBSMatrix" })]), "unsupported_type"],
    ["multi-answer grid", survey([question("QID1", { QuestionType: "Matrix", Selector: "Likert", SubSelector: "MultipleAnswer", Answers: { "1": { Display: "a" }, "2": { Display: "b" } } })]), "unsupported_type"],
    ["form text entry", survey([question("QID1", { QuestionType: "TE", Selector: "FORM" })]), "unsupported_type"],
    ["email validation", survey([question("QID1", { QuestionType: "TE", Selector: "SL", Validation: { Settings: { Type: "ContentType", ContentType: "ValidEmail" } } })]), "unsupported_validation"],
    ["other, please specify", survey([question("QID1", { Choices: { "1": { Display: "Yes" }, "2": { Display: "Other", TextEntry: "true" } } })]), "choice_text_entry"],
    ["display logic on an option", survey([question("QID1"), question("QID2", { Choices: { "1": { Display: "Yes", DisplayLogic: showIf([selected("QID1", 1)]) }, "2": { Display: "No" } } })]), "choice_display_logic"],
    ["randomized options", survey([question("QID1", { Randomization: { Type: "All" } })]), "randomized_choices"],
    ["randomized block", survey([question("QID1")], { blockOptions: { RandomizeQuestions: "RandomWithXPerPage" } }), "randomized_block"],
    ["loop and merge", survey([question("QID1")], { blockOptions: { Looping: "Static" } }), "loop_and_merge"],
    ["image in the question", survey([question("QID1", { QuestionText: 'Rate this logo <img src="x.png">' })]), "visual_content"],
    ["piped text", survey([question("QID1"), question("QID2", { QuestionText: "You said ${q://QID1/ChoiceGroup/SelectedChoices}. Why?" })]), "piped_text"],
    ["custom JavaScript", survey([question("QID1", { QuestionJS: "Qualtrics.SurveyEngine.addOnload(function(){});" })]), "custom_script"],
    ["carried-forward options", survey([question("QID1"), question("QID2", { DynamicChoices: { Locator: "q://QID1/ChoiceGroup/SelectedChoices" } })]), "carry_forward"],
    ["one answer option", survey([question("QID1", { Choices: { "1": { Display: "Only" } }, ChoiceOrder: [1] })]), "too_few_choices"],
    ["empty question", survey([question("QID1", { QuestionText: "<div><br></div>" })]), "empty_question"],
    ["branch in the survey flow", survey([question("QID1")], { flow: [{ ID: "BL_1", Type: "Block" }, { Type: "Branch", Flow: [] }] }), "flow_element"],
    ["randomizer in the survey flow", survey([question("QID1")], { flow: [{ Type: "BlockRandomizer", Flow: [{ ID: "BL_1", Type: "Block" }] }] }), "flow_element"],
    ["logic on embedded data", survey([question("QID1"), question("QID2", { DisplayLogic: showIf([{ LogicType: "EmbeddedField", LeftOperand: "x", Operator: "EqualTo", RightOperand: "1" }]) })]), "unsupported_logic"],
    ["logic mixing and with or", survey([question("QID1"), question("QID2"), question("QID3"), question("QID4", { DisplayLogic: showIf([selected("QID1", 1), { ...selected("QID2", 1), Conjuction: "And" }, { ...selected("QID3", 1), Conjuction: "Or" }]) })]), "unsupported_logic"],
    ["logic operator not understood", survey([question("QID1"), question("QID2", { DisplayLogic: showIf([selected("QID1", 1, "Displayed")]) })]), "unsupported_logic"],
    ["in-page display logic", survey([question("QID1"), question("QID2", { DisplayLogic: { ...showIf([selected("QID1", 1)]), inPage: true } })]), "unsupported_logic"],
    ["logic on a later question", survey([question("QID1", { DisplayLogic: showIf([selected("QID2", 1)]) }), question("QID2")]), "logic_forward_reference"],
    ["logic on a missing question", survey([question("QID1", { DisplayLogic: showIf([selected("QID9", 1)]) })]), "logic_unknown_question"],
    ["logic on a missing option", survey([question("QID1"), question("QID2", { DisplayLogic: showIf([selected("QID1", 7)]) })]), "logic_unknown_answer"],
    ["skip to an earlier question", survey([question("QID1"), question("QID2", { SkipLogic: [{ ChoiceLocator: "q://QID2/SelectableChoice/1", Condition: "Selected", SkipToDestination: "QID1" }] })]), "skip_bad_destination"],
    ["only read-only text", survey([question("QID1", { QuestionType: "DB", Selector: "TB" })]), "no_questions"],
  ];

  it.each(cases)("%s", (_name, doc, code) => {
    const result = readQsf(doc);
    expect(result.instrument).toBeNull();
    expect(blockerCodes(doc)).toContain(code);
  });

  it("names the question in each refusal", () => {
    const r = readQsf(survey([question("QID1"), question("QID2", { Selector: "MAVR" })]));
    expect(r.findings).toEqual([{ severity: "blocker", code: "multi_select", itemId: "QID2", message: "Select-all-that-apply questions are not supported yet." }]);
  });
});

describe("advice on wording", () => {
  const warnings = (over: Record<string, unknown>) =>
    readQsf(survey([question("QID1", over)]))
      .findings.filter((f) => f.severity === "warning")
      .map((f) => f.code);

  it("flags screen wording, long lists, leading wording and forced answers without refusing", () => {
    expect(warnings({ QuestionText: "Click the option below that fits best." })).toEqual(["visual_wording"]);
    expect(warnings({ Choices: Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [n, { Display: `Option ${n}` }])), ChoiceOrder: [1, 2, 3, 4, 5, 6] })).toEqual(["many_options"]);
    expect(warnings({ QuestionText: "The new hours are better, aren't they?" })).toEqual(["leading_wording"]);
    expect(warnings({ Validation: { Settings: { ForceResponse: "ON", Type: "None" } } })).toEqual(["forced_response"]);
    expect(readQsf(survey([question("QID1", { QuestionText: "Click the option below that fits best." })])).instrument).not.toBeNull();
  });

  it("does not flag ordinary wording", () => {
    expect(warnings({ QuestionText: "Is the entrance on the right side of the building?" })).toEqual([]);
  });
});
