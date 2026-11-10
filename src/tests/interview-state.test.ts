import { describe, it, expect } from "vitest";
import {
  canAnswer,
  initialInterviewState,
  interviewReducer as r,
  timeToAnswer,
  type InterviewState,
} from "@/lib/interview-state";

const start = initialInterviewState({ turnId: "t1", question: "Q1?", answered: 2 });

describe("interviewReducer", () => {
  it("submit → submitting with an optimistic step", () => {
    const s = r(start, { type: "submit", value: "yes" });
    expect(s.phase).toBe("submitting");
    expect(s.answered).toBe(3);
    expect(s.inFlight).toBe("yes");
    expect(canAnswer(s)).toBe(false);
  });

  it("'done' does not advance progress", () => {
    expect(r(start, { type: "submit", value: "done" }).answered).toBe(2);
  });

  it("ignores a second submit while one is in flight", () => {
    const s = r(start, { type: "submit", value: "yes" });
    expect(r(s, { type: "submit", value: "no" })).toBe(s);
  });

  it("a returned question replaces the turn and takes the server count", () => {
    const s = r(r(start, { type: "submit", value: "yes" }), {
      type: "question",
      turnId: "t2",
      text: "Q2?",
      answered: 3,
    });
    expect(s).toMatchObject({ phase: "asking", turnId: "t2", question: "Q2?", answered: 3 });
    expect(canAnswer(s)).toBe(true);
  });

  it("a stale resync can move the count backwards to the server's truth", () => {
    const s = r(r(start, { type: "submit", value: "yes" }), {
      type: "question",
      turnId: "t9",
      text: "Other?",
      answered: 5,
    });
    expect(s.answered).toBe(5);
  });

  it("done → leaving", () => {
    const s = r(r(start, { type: "submit", value: "done" }), { type: "done" });
    expect(s.phase).toBe("leaving");
    expect(canAnswer(s)).toBe(false);
  });

  it("fail rolls back the optimistic step and blocks answering until retry", () => {
    const failed = r(r(start, { type: "submit", value: "no" }), { type: "fail", error: "x" });
    expect(failed).toMatchObject({ phase: "failed", error: "x", answered: 2 });
    expect(canAnswer(failed)).toBe(false);
    expect(r(failed, { type: "submit", value: "yes" })).toBe(failed);
    const retrying = r(failed, { type: "retry" });
    expect(retrying.phase).toBe("submitting");
    expect(retrying.error).toBeNull();
  });

  it("ignores late results in the wrong phase", () => {
    const states: InterviewState[] = [start, r(r(start, { type: "submit", value: "yes" }), { type: "done" })];
    for (const s of states) {
      expect(r(s, { type: "question", turnId: "z", text: "z", answered: 0 })).toBe(s);
      expect(r(s, { type: "fail", error: "late" })).toBe(s);
    }
    expect(r(start, { type: "retry" })).toBe(start);
  });
});

describe("timeToAnswer", () => {
  it("measures from when this turn became visible", () => {
    expect(timeToAnswer({ turnId: "t2", at: 10_000 }, "t2", 11_250)).toBe(1250);
  });
  it("is null when the timestamp belongs to another turn", () => {
    expect(timeToAnswer({ turnId: "t1", at: 10_000 }, "t2", 11_250)).toBeNull();
    expect(timeToAnswer(null, "t2", 11_250)).toBeNull();
  });
});
