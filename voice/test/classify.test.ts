import { describe, expect, it } from "vitest";
import { checkVerdict, classify, classifyByRule, type ModelRequest } from "../src/interviewer/classify.js";
import { scriptedModel } from "../src/interviewer/simulate.js";
import { library } from "./helpers.js";

const inst = library();
const item = (id: string) => inst.items.find((i) => i.id === id)!;
const ask = (id: string, utterance: string): ModelRequest => ({ utterance, expecting: "answer", item: item(id) });
const consent = (utterance: string): ModelRequest => ({ utterance, expecting: "consent" });

describe("rules", () => {
  it("opt-out is recognised anywhere, in many wordings", () => {
    for (const u of ["remove me", "Please take me off your list.", "stop calling me", "Don't call this number again", "I want off the list", "do not call"]) {
      expect(classifyByRule(consent(u))?.intent).toBe("opt_out");
      expect(classifyByRule(ask("QID3", u))?.intent).toBe("opt_out");
    }
  });

  it("stop, call back and repeat", () => {
    expect(classifyByRule(ask("QID3", "Stop."))?.intent).toBe("stop");
    expect(classifyByRule(ask("QID3", "I have to go"))?.intent).toBe("stop");
    expect(classifyByRule(ask("QID3", "can you call me back later"))?.intent).toBe("callback");
    expect(classifyByRule(consent("this is not a good time"))?.intent).toBe("callback");
    for (const u of ["Sorry?", "what was the question", "Can you repeat that?", "pardon", "sorry, can you repeat that?", "Could you say that again please?", "Um, repeat the options", "I didn't catch that", "wait, what?", "say again"]) {
      expect(classifyByRule(ask("QID3", u))?.intent, u).toBe("repeat");
    }
    // Sentences that merely contain those words are not repeat requests.
    for (const u of ["what I mean is monthly", "sorry I only went once", "say about once a month"]) expect(classifyByRule(ask("QID3", u))?.intent, u).not.toBe("repeat");
  });

  it("consent takes only a clear yes or no", () => {
    expect(classifyByRule(consent("Yes."))?.intent).toBe("yes");
    expect(classifyByRule(consent("okay"))?.intent).toBe("yes");
    expect(classifyByRule(consent("No thank you"))?.intent).toBe("no");
    expect(classifyByRule(consent("I suppose, what is it about"))).toBeNull();
    expect(classifyByRule(consent(""))).toBeNull();
  });

  it("an exact option is an answer with full confidence", () => {
    expect(classifyByRule(ask("QID3", "About once a month."))).toEqual({ intent: "answer", answer: { kind: "choice", code: "3" }, confidence: 1, evidence: "About once a month.", by: "rule" });
    expect(classifyByRule(ask("QID5", "8"))?.answer).toEqual({ kind: "choice", code: "8" });
    expect(classifyByRule(ask("QID6", "12"))?.answer).toEqual({ kind: "number", value: 12 });
  });

  it("a survey option is never mistaken for a command", () => {
    expect(classifyByRule(ask("QID2", "No"))).toMatchObject({ intent: "answer", answer: { kind: "choice", code: "2" } });
    expect(classifyByRule(ask("QID9", "don't know"))).toMatchObject({ intent: "answer", answer: { kind: "choice", code: "5" } });
  });

  it("don't know and refusal are answers of their own kind", () => {
    expect(classifyByRule(ask("QID3", "I don't know"))?.answer).toEqual({ kind: "nonresponse", reason: "dont_know" });
    expect(classifyByRule(ask("QID3", "prefer not to say"))?.answer).toEqual({ kind: "nonresponse", reason: "refused" });
  });

  it("an open question takes the respondent's own words", () => {
    expect(classifyByRule(ask("QID8", " Longer weekend hours "))?.answer).toEqual({ kind: "text", value: "Longer weekend hours" });
  });

  it("does not guess at anything else", () => {
    for (const u of ["maybe monthly", "pretty often I guess", "a dozen", "yes"]) expect(classifyByRule(ask("QID3", u))).toBeNull();
    expect(classifyByRule(ask("QID6", "a dozen"))).toBeNull();
  });
});

describe("everyday speech, as heard on the operator's own test (11 Nov 2026)", () => {
  it("sure, okay, of course and the like are yes to a yes-or-no question; not really and no thanks are no", () => {
    for (const said of ["sure", "Sure.", "okay", "ok", "of course", "absolutely", "yeah, sure", "sure thing", "go ahead", "I would", "oh yes", "why not"]) {
      expect([said, classifyByRule(ask("QID7", said))]).toEqual([said, expect.objectContaining({ intent: "answer", answer: { kind: "choice", code: "1" }, by: "rule" })]);
    }
    for (const said of ["nope", "not really", "no thanks", "No, thank you", "I wouldn't", "nah"]) {
      expect([said, classifyByRule(ask("QID7", said))]).toEqual([said, expect.objectContaining({ intent: "answer", answer: { kind: "choice", code: "2" } })]);
    }
  });

  it("but only where the options are Yes and No: sure is not an answer to a five-point scale", () => {
    expect(classifyByRule(ask("QID3", "sure"))).toBeNull();
    expect(classifyByRule(ask("QID4", "okay"))).toBeNull();
  });

  it("asking for the question, the scale or the choices again is a request to repeat", () => {
    for (const said of ["Sorry, what was the question?", "what was the scale again?", "Sorry, what was the scale again?", "what were my options?", "what are the choices again", "can you repeat the options?", "could you read the choices again", "remind me of the scale", "what's the question"]) {
      expect([said, classifyByRule(ask("QID4", said))?.intent]).toEqual([said, "repeat"]);
    }
  });
});

describe("model verdicts are checked in code", () => {
  const req = ask("QID3", "probably about once a month I'd say");
  const good = { intent: "answer" as const, answer: { kind: "choice" as const, code: "3" }, confidence: 0.93, evidence: "about once a month" };

  it("accepts a valid verdict and keeps the evidence", () => {
    expect(checkVerdict(req, good, "m1")).toEqual({ intent: "answer", answer: { kind: "choice", code: "3" }, confidence: 0.93, evidence: "about once a month", by: "model", model: "m1" });
  });

  it("discards a verdict whose evidence the respondent never said", () => {
    const c = checkVerdict(req, { ...good, evidence: "every single week" }, "m1");
    expect(c).toMatchObject({ intent: "unclear", confidence: 0, by: "model", rejected: "evidence is not part of what the respondent said" });
  });

  it("discards an option that does not exist, a bad confidence, a missing answer, and an intent that does not fit", () => {
    expect(checkVerdict(req, { ...good, answer: { kind: "choice", code: "9" } }, "m1").rejected).toMatch(/not valid for this question/);
    expect(checkVerdict(req, { ...good, confidence: 1.4 }, "m1").rejected).toMatch(/confidence/);
    expect(checkVerdict(req, { ...good, confidence: Number.NaN }, "m1").rejected).toMatch(/confidence/);
    expect(checkVerdict(req, { intent: "answer", confidence: 0.9, evidence: "about once a month" }, "m1").rejected).toBe("no answer given");
    expect(checkVerdict(req, { intent: "yes", confidence: 0.9, evidence: "about once a month" }, "m1").rejected).toMatch(/not valid here/);
    expect(checkVerdict(ask("QID6", "five hundred and one"), { intent: "answer", answer: { kind: "number", value: 501 }, confidence: 0.9, evidence: "five hundred and one" }, "m1").rejected).toMatch(/at most 500/);
  });

  it("an open answer is always the respondent's words, not the model's", () => {
    const u = "uh I think longer hours on weekends would help";
    const c = checkVerdict(ask("QID8", u), { intent: "answer", answer: { kind: "text", value: "Longer weekend hours" }, confidence: 0.9, evidence: "longer hours on weekends" }, "m1");
    expect(c.answer).toEqual({ kind: "text", value: u });
  });
});

describe("rules first, model second", () => {
  it("does not call the model when a rule decides", async () => {
    const model = scriptedModel({});
    expect((await classify(ask("QID3", "Only once"), model)).by).toBe("rule");
    expect((await classify(consent("remove me"), model)).intent).toBe("opt_out");
    expect(model.calls).toEqual([]);
  });

  it("calls the model for the rest, and is unclear without one", async () => {
    const u = "probably about once a month I'd say";
    const model = scriptedModel({ [u]: { intent: "answer", answer: { kind: "choice", code: "3" }, confidence: 0.93, evidence: "about once a month" } });
    expect(await classify(ask("QID3", u), model)).toMatchObject({ intent: "answer", by: "model", model: "scripted-model" });
    expect(model.calls).toEqual([u]);
    expect(await classify(ask("QID3", u))).toMatchObject({ intent: "unclear", confidence: 0 });
  });

  it("a failing model call is unclear, not a crash", async () => {
    const broken = { id: "broken", classify: async () => Promise.reject(new Error("timeout")) };
    expect(await classify(ask("QID3", "sort of monthly"), broken)).toMatchObject({ intent: "unclear", rejected: "model call failed: timeout" });
  });
});
