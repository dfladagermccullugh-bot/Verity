import { describe, it, expect } from "vitest";
import {
  MAX_ATTEMPTS,
  enforceCoverage,
  forcePrd,
  generateNextShape,
  type GenResult,
} from "@/lib/interview-policy";
import { STOP_CONFIRM } from "@/lib/guard";
import { TRACKED_DIMENSIONS } from "@/lib/dimensions";
import type { ChatMessage } from "@/lib/model-client";
import { scriptedModel, PRD_REPLY } from "./helpers/scripted-model";

const seed: ChatMessage[] = [{ role: "user", content: "A water bottle that nudges you." }];

describe("generateNextShape", () => {
  it("accepts a clean question on the first try", async () => {
    const m = scriptedModel(["Is this for adults?"]);
    const g = await generateNextShape(m.fn, seed);
    expect(g.shape).toEqual({ kind: "question", text: "Is this for adults?" });
    expect(g.regenCount).toBe(0);
    expect(g.guardRejections).toEqual([]);
    expect(m.calls).toHaveLength(1);
  });

  it("regenerates after a guard reject and records the reason", async () => {
    const m = scriptedModel(["Not a question.", "Is this for adults?"]);
    const g = await generateNextShape(m.fn, seed);
    expect(g.shape.kind).toBe("question");
    expect(g.regenCount).toBe(1);
    expect(g.guardRejections).toEqual(["no_question_mark"]);
  });

  it("rejects a leading question and counts the rewrite", async () => {
    const m = scriptedModel(["Surely this is for adults?", "Is this for adults?"]);
    const g = await generateNextShape(m.fn, seed);
    expect(g.shape.kind).toBe("question");
    expect(g.leadingRewrites).toBe(1);
    expect(g.guardRejections).toEqual(["leading:leading_opener"]);
  });

  it("passes stop confirmations and PRDs through", async () => {
    const stop = await generateNextShape(scriptedModel([STOP_CONFIRM]).fn, seed);
    expect(stop.shape.kind).toBe("stop_confirm");
    const prd = await generateNextShape(scriptedModel([PRD_REPLY]).fn, seed);
    expect(prd.shape.kind).toBe("prd");
  });

  it("reports exhaustion distinctly from a stop confirmation", async () => {
    const m = scriptedModel(["nope.", "still nope.", "Line one\nIs it?"]);
    const g = await generateNextShape(m.fn, seed);
    expect(g.shape.kind).toBe("exhausted");
    expect(g.regenCount).toBe(MAX_ATTEMPTS);
    expect(g.guardRejections).toHaveLength(MAX_ATTEMPTS);
    expect(m.calls).toHaveLength(MAX_ATTEMPTS);
  });

  it("propagates a model failure", async () => {
    const m = scriptedModel([new Error("network")]);
    await expect(generateNextShape(m.fn, seed)).rejects.toThrow("network");
  });
});

describe("enforceCoverage", () => {
  const stopGen: GenResult = {
    shape: { kind: "stop_confirm" },
    regenCount: 0,
    guardRejections: [],
    leadingRewrites: 0,
  };

  it("honours the stop once coverage is met, without calling the model", async () => {
    const m = scriptedModel([]);
    const answered = TRACKED_DIMENSIONS.map((d) => ({ answer: "yes", constructDimension: d }));
    const r = await enforceCoverage(m.fn, seed, answered, stopGen);
    expect(r.gen).toBe(stopGen);
    expect(r.nudge).toBeNull();
    expect(m.calls).toHaveLength(0);
  });

  it("nudges toward uncovered dimensions and returns the new question", async () => {
    const m = scriptedModel(["Will many people use it at once?"]);
    const r = await enforceCoverage(m.fn, seed, [], stopGen);
    expect(r.gen.shape).toEqual({ kind: "question", text: "Will many people use it at once?" });
    const last = m.calls[0][m.calls[0].length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toMatch(/still unaddressed: Problem, Primary user/);
  });

  it("falls back to the original stop when the nudge is refused", async () => {
    const m = scriptedModel([STOP_CONFIRM]);
    const r = await enforceCoverage(m.fn, seed, [], stopGen);
    expect(r.gen).toBe(stopGen);
    expect(r.nudge?.shape.kind).toBe("stop_confirm");
  });
});

describe("forcePrd", () => {
  it("returns a marked PRD on the first try", async () => {
    const m = scriptedModel([PRD_REPLY]);
    const r = await forcePrd(m.fn, seed);
    expect(r.accepted).toBe(true);
    expect(r.rejects).toBe(0);
    expect(r.markdown.startsWith("# One-line pitch")).toBe(true);
    // The forced path replays the stop confirmation and a "yes".
    const sent = m.calls[0];
    expect(sent[sent.length - 2]).toEqual({ role: "assistant", content: STOP_CONFIRM });
    expect(sent[sent.length - 1]).toEqual({ role: "user", content: "yes" });
  });

  it("re-asks for the marker after an unmarked reply", async () => {
    const m = scriptedModel(["Sure! Here it is soon.", PRD_REPLY]);
    const r = await forcePrd(m.fn, seed);
    expect(r.accepted).toBe(true);
    expect(r.rejects).toBe(1);
    expect(m.calls[1][m.calls[1].length - 1].content).toMatch(/===PRD===/);
  });

  it("falls back to the third reply when the marker never appears", async () => {
    const m = scriptedModel(["no marker", "still none", "# Pitch\nA thing."]);
    const r = await forcePrd(m.fn, seed);
    expect(r.accepted).toBe(false);
    expect(r.rejects).toBe(2);
    expect(r.markdown).toBe("# Pitch\nA thing.");
  });
});
