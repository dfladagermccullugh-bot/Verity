import { describe, expect, it } from "vitest";
import type { Answer } from "../src/instrument/types.js";
import { FlowError, emptyState, evaluate, markHeard, nextStep, recordAnswer, slotsOf, slotsOnPath, type InterviewState } from "../src/engine/flow.js";
import { readQsf } from "../src/qualtrics/qsf.js";
import { RESPONSE_A, RESPONSE_B, choice, library, question, rng, run, selected, showIf, survey } from "./helpers.js";

describe("library test survey paths", () => {
  const inst = library();

  it("response A: every question is asked, grid one statement at a time", () => {
    const r = run(inst, (k) => RESPONSE_A[k]!);
    expect(r.asked).toEqual(["QID2", "QID3", "QID4#1", "QID4#2", "QID4#3", "QID5", "QID6", "QID7", "QID8", "QID9"]);
    expect(r.reason).toBe("completed");
    expect(r.state.heard).toEqual(["QID1"]);
  });

  it("response B: display logic hides Q3 and Q4, skip logic ends after Q7", () => {
    const r = run(inst, (k) => RESPONSE_B[k]!);
    expect(r.asked).toEqual(["QID2", "QID5", "QID6", "QID7"]);
    expect(r.reason).toBe("skipped_to_end");
  });

  it("starts with the read-only text, then the first question", () => {
    const first = nextStep(inst, emptyState());
    expect(first.kind === "statement" && first.item.id).toBe("QID1");
    const second = nextStep(inst, markHeard(inst, emptyState(), "QID1"));
    expect(second.kind === "ask" && second.slot.key).toBe("QID2");
  });
});

describe("resuming and order", () => {
  const inst = library();

  it("asking for the next step twice gives the same step and changes nothing", () => {
    const state = markHeard(inst, emptyState(), "QID1");
    const frozen = JSON.stringify(state);
    expect(nextStep(inst, state)).toEqual(nextStep(inst, state));
    expect(JSON.stringify(state)).toBe(frozen);
  });

  it("an interview interrupted at any point resumes to the same result", () => {
    const full = run(inst, (k) => RESPONSE_A[k]!);
    const keys = Object.keys(full.state.answers);
    for (let cut = 0; cut <= keys.length; cut++) {
      const partial: InterviewState = { heard: ["QID1"], answers: Object.fromEntries(keys.slice(0, cut).map((k) => [k, full.state.answers[k]!])) };
      const saved = JSON.parse(JSON.stringify(partial)) as InterviewState;
      const resumed = run(inst, (k) => RESPONSE_A[k]!, saved);
      expect(resumed.state.answers).toEqual(full.state.answers);
      expect(resumed.asked).toEqual(keys.slice(cut));
    }
  });

  it("only the question that is due can be answered", () => {
    const state = markHeard(inst, emptyState(), "QID1");
    expect(() => recordAnswer(inst, state, "QID5", choice("8"))).toThrow(FlowError);
    expect(() => recordAnswer(inst, emptyState(), "QID2", choice("1"))).toThrow(FlowError);
    const answered = recordAnswer(inst, state, "QID2", choice("1"));
    expect(() => recordAnswer(inst, answered, "QID2", choice("2"))).toThrow(FlowError);
    expect(() => markHeard(inst, answered, "QID1")).toThrow(FlowError);
  });

  it("rejects answers that do not fit the question", () => {
    const at = (key: string) => {
      let s = markHeard(inst, emptyState(), "QID1");
      for (const k of Object.keys(RESPONSE_A)) {
        if (k === key) return s;
        s = recordAnswer(inst, s, k, RESPONSE_A[k]!);
      }
      throw new Error(key);
    };
    expect(() => recordAnswer(inst, at("QID2"), "QID2", choice("9"))).toThrow(/not one of the options/);
    expect(() => recordAnswer(inst, at("QID2"), "QID2", { kind: "text", value: "yes" })).toThrow(FlowError);
    expect(() => recordAnswer(inst, at("QID6"), "QID6", { kind: "number", value: 501 })).toThrow(/at most 500/);
    expect(() => recordAnswer(inst, at("QID6"), "QID6", { kind: "number", value: -1 })).toThrow(/at least 0/);
    expect(() => recordAnswer(inst, at("QID6"), "QID6", { kind: "number", value: 2.5 })).toThrow(/whole number/);
    expect(() => recordAnswer(inst, at("QID8"), "QID8", { kind: "text", value: "   " })).toThrow(FlowError);
  });

  it("a declined question is recorded and the interview moves on", () => {
    const r = run(inst, (k) => (k === "QID2" ? { kind: "nonresponse", reason: "refused" } : (RESPONSE_B[k] ?? { kind: "nonresponse", reason: "dont_know" })));
    // Q2 declined counts as "Yes not selected", so Q3 and Q4 stay hidden.
    expect(r.asked).toEqual(["QID2", "QID5", "QID6", "QID7"]);
  });
});

describe("logic", () => {
  it("skip to end of block continues with the next block; skip to a question jumps within the block", () => {
    const skipTo = (dest: string) => [{ ChoiceLocator: "q://QID1/SelectableChoice/1", Condition: "Selected", SkipToDestination: dest }];
    const inst = readQsf(survey([question("QID1", { SkipLogic: skipTo("QID3") }), question("QID2"), question("QID3"), question("QID4")])).instrument!;
    expect(run(inst, () => choice("1")).asked).toEqual(["QID1", "QID3", "QID4"]);
    expect(run(inst, () => choice("2")).asked).toEqual(["QID1", "QID2", "QID3", "QID4"]);
  });

  it("not-selected, or, and number comparisons", () => {
    const answers: Record<string, Answer> = { QID1: choice("2"), QID2: { kind: "number", value: 5 } };
    expect(evaluate({ op: "notSelected", itemId: "QID1", choiceCode: "1" }, answers)).toBe(true);
    expect(evaluate({ op: "or", terms: [{ op: "selected", itemId: "QID1", choiceCode: "1" }, { op: "ge", itemId: "QID2", value: 5 }] }, answers)).toBe(true);
    expect(evaluate({ op: "and", terms: [{ op: "selected", itemId: "QID1", choiceCode: "2" }, { op: "lt", itemId: "QID2", value: 5 }] }, answers)).toBe(false);
    expect(evaluate({ op: "eq", itemId: "QID9", value: 1 }, answers)).toBe(false);
    expect(evaluate({ op: "ne", itemId: "QID9", value: 1 }, answers)).toBe(true);
  });

  it("logic on a grid statement", () => {
    const grid = question("QID1", { QuestionType: "Matrix", Selector: "Likert", SubSelector: "SingleAnswer", Choices: { "1": { Display: "Staff" }, "2": { Display: "Hours" } }, ChoiceOrder: [1, 2], Answers: { "1": { Display: "Bad" }, "2": { Display: "Good" } }, AnswerOrder: [1, 2] });
    const inst = readQsf(survey([grid, question("QID2", { DisplayLogic: showIf([selected("QID1", "2/1")]) })])).instrument!;
    expect(run(inst, (k) => choice(k === "QID1#2" ? "1" : "2")).asked).toEqual(["QID1#1", "QID1#2", "QID2"]);
    expect(run(inst, () => choice("2")).asked).toEqual(["QID1#1", "QID1#2"]);
  });
});

describe("any sequence of answers", () => {
  const inst = library();

  it("always ends, never repeats a question, and never asks a hidden one", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rand = rng(seed);
      const pick = (key: string): Answer => {
        const item = inst.items.find((i) => i.id === key.split("#")[0])!;
        if (rand() < 0.15) return { kind: "nonresponse", reason: "refused" };
        if (item.kind === "number") return { kind: "number", value: Math.floor(rand() * 501) };
        if (item.kind === "text") return { kind: "text", value: "something" };
        return choice(item.choices![Math.floor(rand() * item.choices!.length)]!.code);
      };
      const r = run(inst, pick);
      expect(new Set(r.asked).size).toBe(r.asked.length);
      const a = r.state.answers;
      const visited = a.QID2?.kind === "choice" && a.QID2.code === "1";
      expect(r.asked.includes("QID3")).toBe(visited);
      expect(r.asked.includes("QID4#1")).toBe(visited);
      const declinedMore = a.QID7?.kind === "choice" && a.QID7.code === "2";
      expect(r.asked.includes("QID8")).toBe(!declinedMore);
      expect(slotsOnPath(inst, r.state).map((s) => s.key)).toEqual(r.asked);
      expect(r.asked.length).toBeLessThanOrEqual(inst.items.flatMap(slotsOf).length);
    }
  });
});
