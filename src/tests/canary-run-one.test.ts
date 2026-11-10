import { describe, it, expect } from "vitest";
import { runOne } from "@/lib/canaries/run-one";
import { STOP_CONFIRM } from "@/lib/guard";
import { scriptedModel, PRD_REPLY } from "./helpers/scripted-model";

const fixture = {
  id: "fx",
  category: "test",
  seed: "A bottle.",
  answerScript: ["yes", "no", "yes"],
};

describe("canary runOne (shared policy, injected model)", () => {
  it("counts accepted questions and rejects, and forces the PRD on a stop", async () => {
    const m = scriptedModel([
      "Is it for adults?",
      "bad output.",
      "Is it used at work?",
      STOP_CONFIRM, // coverage not met → nudge
      STOP_CONFIRM, // nudge refused → force PRD
      PRD_REPLY,
    ]);
    const metrics = await runOne(fixture, m.fn);
    expect(metrics.turnCount).toBe(2);
    // 4 accepts (2 questions, stop, nudge stop) + 1 PRD accept; 1 reject.
    expect(metrics.guardRejectRate).toBe(Math.round((1 / 6) * 1000) / 1000);
    expect(metrics.terminatedNaturally).toBe(true);
    expect(metrics.prdHeadingsPresent).toEqual(["^# ", "^## "]);
    expect(m.remaining()).toBe(0);
  });

  it("marks a scripted 'done' as an unnatural termination", async () => {
    const m = scriptedModel(["Is it for adults?", PRD_REPLY]);
    const metrics = await runOne({ ...fixture, answerScript: ["done"] }, m.fn);
    expect(metrics.terminatedNaturally).toBe(false);
    expect(metrics.turnCount).toBe(1);
  });
});
