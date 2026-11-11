import { describe, expect, it } from "vitest";
import { DATASET, datasetSize, type Target } from "../eval/dataset.js";
import { renderSummary, requestFor, scoreAll, summarize } from "../eval/score.js";
import { validateAnswer } from "../src/engine/flow.js";
import { CLASSIFIER_INSTRUCTIONS, claudeClassifier, describeRequest, toVerdict, type ParseClient } from "../src/interviewer/claude-classifier.js";
import { classify } from "../src/interviewer/classify.js";
import { parseSpokenNumber } from "../src/util/number-words.js";
import { library } from "./helpers.js";

const inst = library();

describe("labelled replies", () => {
  it("has about 300 entries and every label is a valid reading for its question", () => {
    expect(datasetSize()).toBeGreaterThanOrEqual(290);
    for (const [target, rows] of Object.entries(DATASET) as [Target, (typeof DATASET)[Target]][]) {
      const seen = new Set<string>();
      for (const [utterance, ...expected] of rows) {
        expect(seen.has(utterance), `duplicate "${utterance}" in ${target}`).toBe(false);
        seen.add(utterance);
        expect(expected.length).toBeGreaterThan(0);
        const item = requestFor(inst, target, utterance).item;
        for (const e of expected) {
          if (e.startsWith("c:")) expect(validateAnswer(item!, { kind: "choice", code: e.slice(2) }), `${target} "${utterance}" ${e}`).toBeNull();
          else if (e.startsWith("n:")) expect(validateAnswer(item!, { kind: "number", value: Number(e.slice(2)) })).toBeNull();
          else if (e === "text") expect(item!.kind).toBe("text");
          else if (e === "yes" || e === "no") expect(target).toBe("consent");
          else expect(["dk", "ref", "repeat", "optout", "stop", "callback", "question", "unclear"]).toContain(e);
        }
      }
    }
  });
});

describe("rules alone, on the labelled replies", () => {
  it("every reply a rule decides is decided correctly, and nothing wrong would be recorded", async () => {
    const summary = summarize(await scoreAll(inst));
    expect(summary.byRule.correct).toBe(summary.byRule.n);
    expect(summary.falseAccepts).toEqual([]);
    // Rules settle a useful share without any model; the rest is left for the model, never guessed.
    expect(summary.byRule.n / summary.n).toBeGreaterThan(0.4);
    expect(summary.wrong.every((w) => w.got === "unclear")).toBe(true);
    expect(renderSummary(summary, "Rules only")).toContain("Wrong answers that would be recorded without a probe | 0 ");
  });
});

describe("scoring", () => {
  it("counts a confident wrong answer as the costly error and a hesitant right one as a needless probe", async () => {
    const wrongButSure = { id: "m", classify: async () => ({ intent: "answer" as const, answer: { kind: "choice" as const, code: "1" }, confidence: 0.99, evidence: "often" }) };
    const scored = await scoreAll(inst, wrongButSure);
    const s = summarize(scored);
    const pretty = s.falseAccepts.find((f) => f.utterance === "pretty often")!;
    expect(pretty).toMatchObject({ target: "QID3", got: "c:1", expected: ["unclear"] });
    // Verdicts whose evidence was never said are discarded by code, so they cannot be false accepts.
    expect(s.discarded).toBeGreaterThan(50);
    expect(s.falseAccepts.every((f) => f.utterance.toLowerCase().includes("often"))).toBe(true);
  });
});

describe("Claude classifier adapter", () => {
  const fake = (reply: unknown, stop_reason = "end_turn"): ParseClient & { bodies: Record<string, any>[] } => {
    const bodies: Record<string, any>[] = [];
    return { bodies, messages: { parse: async (body) => (bodies.push(body), { stop_reason, parsed_output: reply }) } };
  };
  const q3 = requestFor(inst, "QID3", "probably about once a month I'd say");

  it("sends the question, its options and the reply; never the audio, the phone number or other answers", async () => {
    const client = fake({ intent: "answer", option_code: "3", number: null, confidence: 0.93, evidence: "about once a month" });
    const model = claudeClassifier({ client, model: "claude-haiku-5-5" });
    expect(model.id).toBe("claude-haiku-5-5/prompt-v1");
    const c = await classify(q3, model);
    expect(c).toEqual({ intent: "answer", answer: { kind: "choice", code: "3" }, confidence: 0.93, evidence: "about once a month", by: "model", model: "claude-haiku-5-5/prompt-v1" });
    const body = client.bodies[0]!;
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.system).toBe(CLASSIFIER_INSTRUCTIONS);
    expect(body.output_config.effort).toBe("low");
    expect(JSON.parse(body.messages[0].content)).toEqual({
      question_type: "choose one option",
      question: "How often did you visit a public library in the past 12 months?",
      reply: "probably about once a month I'd say",
      options: [
        { code: "1", label: "Once a week or more" },
        { code: "2", label: "A few times a month" },
        { code: "3", label: "About once a month" },
        { code: "4", label: "A few times a year" },
        { code: "5", label: "Only once" },
      ],
    });
  });

  it("describes consent, number and open questions", () => {
    expect(JSON.parse(describeRequest(requestFor(inst, "consent", "fine")))).toMatchObject({ question_type: "consent", reply: "fine" });
    expect(JSON.parse(describeRequest(requestFor(inst, "QID6", "a dozen")))).toMatchObject({ question_type: "number", minimum: 0, maximum: 500 });
    expect(JSON.parse(describeRequest(requestFor(inst, "QID8", "more parking")))).toMatchObject({ question_type: "open answer in their own words" });
  });

  it("maps replies to verdicts, and an answer with nothing chosen to unclear", () => {
    const base = { option_code: null, number: null, confidence: 0.9, evidence: "x" };
    expect(toVerdict({ ...base, intent: "dont_know" }, q3)).toMatchObject({ intent: "answer", answer: { kind: "nonresponse", reason: "dont_know" } });
    expect(toVerdict({ ...base, intent: "refused" }, q3)).toMatchObject({ intent: "answer", answer: { kind: "nonresponse", reason: "refused" } });
    expect(toVerdict({ ...base, intent: "answer" }, q3)).toMatchObject({ intent: "unclear" });
    expect(toVerdict({ ...base, intent: "answer", number: 12 }, requestFor(inst, "QID6", "a dozen"))).toMatchObject({ intent: "answer", answer: { kind: "number", value: 12 } });
    expect(toVerdict({ ...base, intent: "repeat" }, q3)).toEqual({ intent: "repeat", confidence: 0.9, evidence: "x" });
  });

  it("a refusal, a cut-off reply, malformed output or a timeout all become unclear", async () => {
    for (const client of [fake(null, "refusal"), fake(null, "max_tokens"), fake({ intent: "sing" }), { messages: { parse: async () => Promise.reject(new Error("timeout")) } }]) {
      const c = await classify(q3, claudeClassifier({ client: client as ParseClient }));
      expect(c).toMatchObject({ intent: "unclear", confidence: 0, by: "model" });
      expect(c.rejected).toMatch(/model call failed/);
    }
  });

  it("the model's wording of an open answer is never recorded", async () => {
    const req = requestFor(inst, "QID8", "well honestly the hours, they close at five");
    const client = fake({ intent: "answer", option_code: null, number: null, confidence: 0.95, evidence: "they close at five" });
    expect((await classify({ ...req, utterance: "well honestly the hours? they close at five?" }, claudeClassifier({ client }))).answer).toEqual({ kind: "text", value: "well honestly the hours? they close at five?" });
  });
});

describe("spoken numbers", () => {
  it("reads plain whole numbers and nothing else", () => {
    const cases: [string, number | null][] = [["zero", 0], ["twelve", 12], ["twenty", 20], ["twenty five", 25], ["twenty-five", 25], ["ninety nine", 99], ["a hundred", 100], ["one hundred", 100], ["one hundred and twenty", 120], ["three hundred forty two", 342], ["7", 7], ["a dozen", null], ["ten to fifteen", null], ["twenty twelve", null], ["hundred", null], ["a few", null], ["eight and a half", null], ["", null], ["1000", null]];
    for (const [text, n] of cases) expect(parseSpokenNumber(text), text).toBe(n);
  });
});
