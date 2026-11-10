import { readFileSync } from "node:fs";
import type { Answer, Instrument } from "../src/instrument/types.js";
import { emptyState, markHeard, nextStep, recordAnswer, type InterviewState } from "../src/engine/flow.js";
import { readQsf } from "../src/qualtrics/qsf.js";

export const LIBRARY_QSF = readFileSync(new URL("../fixtures/qualtrics/library-test.qsf", import.meta.url), "utf8");

export function library(): Instrument {
  const r = readQsf(LIBRARY_QSF);
  if (!r.instrument) throw new Error(`fixture refused: ${JSON.stringify(r.findings)}`);
  return r.instrument;
}

type Json = Record<string, unknown>;

const VALIDATION = { Settings: { ForceResponse: "OFF", Type: "None" } };

/** A question payload in QSF shape. `over` replaces or adds fields. */
export function question(qid: string, over: Json = {}): Json {
  return {
    QuestionText: `Question ${qid}?`,
    DataExportTag: qid.replace("QID", "Q"),
    QuestionType: "MC",
    Selector: "SAVR",
    SubSelector: "TX",
    Choices: { "1": { Display: "Yes" }, "2": { Display: "No" } },
    ChoiceOrder: [1, 2],
    Validation: VALIDATION,
    QuestionID: qid,
    ...over,
  };
}

/** A minimal survey file in QSF shape: one block holding the given questions, in order. */
export function survey(questions: Json[], opts: { flow?: Json[]; blockOptions?: Json; blockElements?: Json[] } = {}): Json {
  const el = (Element: string, PrimaryAttribute: string, Payload: unknown) => ({ SurveyID: "SV_test", Element, PrimaryAttribute, SecondaryAttribute: null, TertiaryAttribute: null, Payload });
  const block: Json = {
    Type: "Default",
    Description: "Block 1",
    ID: "BL_1",
    BlockElements: opts.blockElements ?? questions.map((q) => ({ Type: "Question", QuestionID: q.QuestionID })),
  };
  if (opts.blockOptions) block.Options = opts.blockOptions;
  return {
    SurveyEntry: { SurveyID: "SV_test", SurveyName: "Test survey" },
    SurveyElements: [
      el("BL", "Survey Blocks", [block]),
      el("FL", "Survey Flow", { Flow: opts.flow ?? [{ ID: "BL_1", Type: "Block", FlowID: "FL_2" }], FlowID: "FL_1", Type: "Root" }),
      ...questions.map((q) => el("SQ", String(q.QuestionID), q)),
    ],
  };
}

export function showIf(expressions: Json[]): Json {
  const group: Json = { Type: "If" };
  expressions.forEach((e, i) => (group[String(i)] = { LogicType: "Question", Type: "Expression", ...e }));
  return { "0": group, Type: "BooleanExpression", inPage: false };
}

export function selected(qid: string, choice: string | number, operator = "Selected"): Json {
  const loc = `q://${qid}/SelectableChoice/${choice}`;
  return { QuestionID: qid, ChoiceLocator: loc, LeftOperand: loc, Operator: operator };
}

export function blockerCodes(doc: unknown): string[] {
  return readQsf(doc)
    .findings.filter((f) => f.severity === "blocker")
    .map((f) => f.code);
}

/** Small seeded generator so randomized tests are repeatable. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export const choice = (code: string): Answer => ({ kind: "choice", code });

/** Drive an interview with a function that answers each slot; returns the slots asked, in order. */
export function run(inst: Instrument, answer: (key: string) => Answer, start: InterviewState = emptyState()): { state: InterviewState; asked: string[]; reason: string } {
  let state = start;
  const asked: string[] = [];
  for (let guard = 0; guard < 1000; guard++) {
    const step = nextStep(inst, state);
    if (step.kind === "end") return { state, asked, reason: step.reason };
    if (step.kind === "statement") state = markHeard(inst, state, step.item.id);
    else {
      asked.push(step.slot.key);
      state = recordAnswer(inst, state, step.slot.key, answer(step.slot.key));
    }
  }
  throw new Error("interview did not end");
}

export const RESPONSE_A: Record<string, Answer> = {
  QID2: choice("1"),
  QID3: choice("3"),
  "QID4#1": choice("4"),
  "QID4#2": choice("3"),
  "QID4#3": choice("5"),
  QID5: choice("8"),
  QID6: { kind: "number", value: 12 },
  QID7: choice("1"),
  QID8: { kind: "text", value: "Longer weekend hours" },
  QID9: choice("2"),
};

export const RESPONSE_B: Record<string, Answer> = {
  QID2: choice("2"),
  QID5: choice("3"),
  QID6: { kind: "number", value: 0 },
  QID7: choice("2"),
};
