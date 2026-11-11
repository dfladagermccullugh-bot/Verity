import { describe, expect, it } from "vitest";
import type { ModelVerdict } from "../src/interviewer/classify.js";
import { Interviewer, type AuditEvent } from "../src/interviewer/interviewer.js";
import { AI_DISCLOSURE, buildProtocol, buildSpeechTable } from "../src/interviewer/protocol.js";
import { DEFAULT_WORDING, at, cooperative, firstSaying, mumbler, scriptedModel, simulateCall, toRecord, type Persona, type SimulatedCall } from "../src/interviewer/simulate.js";
import { writeResponsesCsv } from "../src/qualtrics/csv.js";
import { buildScript } from "../src/script/script.js";
import { RESPONSE_A, RESPONSE_B, library, rng } from "./helpers.js";

const inst = library();

const SPOKEN_A: Record<string, string> = {
  QID2: "Yes",
  QID3: "About once a month",
  "QID4#1": "Somewhat agree",
  "QID4#2": "Neither agree nor disagree",
  "QID4#3": "Strongly agree",
  QID5: "8",
  QID6: "12",
  QID7: "yes",
  QID8: "Longer weekend hours",
  QID9: "Good",
};
const SPOKEN_B: Record<string, string> = { QID2: "No", QID5: "3", QID6: "0", QID7: "no" };

const call = (persona: Persona, extra: Partial<Parameters<typeof simulateCall>[0]> = {}) => simulateCall({ instrument: inst, persona, ...extra });
const said = (c: SimulatedCall) => c.interviewer.log.filter((e): e is Extract<AuditEvent, { type: "say" }> => e.type === "say");
const saidIds = (c: SimulatedCall) => said(c).map((e) => e.lineId);
const decisions = (c: SimulatedCall) => c.interviewer.log.filter((e): e is Extract<AuditEvent, { type: "decision" }> => e.type === "decision");

function expectOnScript(c: SimulatedCall): void {
  for (const e of said(c)) {
    const line = c.table.lines.get(e.lineId as never);
    expect(line, `line ${e.lineId} is in the speech table`).toBeDefined();
    expect(e.text).toBe(line!.text);
  }
  const spoken = c.transcript.filter((t) => t.speaker === "interviewer").map((t) => t.text);
  const allowed = new Set([...c.table.lines.values()].map((l) => l.text));
  for (const text of spoken) expect(allowed.has(text)).toBe(true);
}

describe("a cooperative call", () => {
  it("runs the whole survey and produces the expected Qualtrics row", async () => {
    const c = await call(cooperative(SPOKEN_A));
    expect(c.interviewer.state.outcome).toBe("complete");
    expect(c.interviewer.state.interview.answers).toEqual(RESPONSE_A);
    expect(c.interviewer.state.review).toEqual([]);
    const row = writeResponsesCsv(inst, [toRecord(c, "case-A", new Date("2026-11-10T15:00:00Z"), new Date("2026-11-10T15:06:00Z"))]).split("\r\n")[3];
    expect(row).toBe("2026-11-10 15:00:00,2026-11-10 15:06:00,0,100,360,1,1,3,4,3,5,8,12,1,Longer weekend hours,2,ai_voice,case-A");
  });

  it("follows survey logic for the short path", async () => {
    const c = await call(cooperative(SPOKEN_B));
    expect(c.interviewer.state.outcome).toBe("complete");
    expect(c.interviewer.state.interview.answers).toEqual(RESPONSE_B);
    expect(saidIds(c)).not.toContain("q.QID3.ask");
    expect(saidIds(c)).not.toContain("q.QID8.ask");
  });

  it("speaks in the fixed order: disclosure, purpose, consent, then questions word for word", async () => {
    const c = await call(cooperative(SPOKEN_A));
    expect(saidIds(c)).toEqual([
      "p.intro", "p.purpose", "p.transcribed", "p.how_to_stop", "p.consent_ask",
      "p.begin", "q.QID1.text", "q.QID2.ask",
      "q.QID3.ask", "q.QID3.options",
      "q.QID4.ask", "q.QID4.options", "q.QID4.row.1", "q.QID4.row.2", "q.QID4.row.3",
      "q.QID5.ask", "q.QID5.options", "q.QID6.ask", "q.QID7.ask", "q.QID8.ask", "q.QID9.ask", "q.QID9.options",
      "p.closing",
    ]);
    expect(said(c)[0]!.text).toBe(`Hello. This is a call from the Library Study. ${AI_DISCLOSURE}`);
    expect(said(c).find((e) => e.lineId === "q.QID3.ask")!.text).toBe(inst.items[2]!.text);
  });

  it("gives no feedback on answers: nothing is said between an accepted answer and the next question", async () => {
    const c = await call(cooperative(SPOKEN_A));
    const log = c.interviewer.log;
    log.forEach((e, i) => {
      if (e.type === "decision" && e.action === "record") {
        const next = log[i + 1]!;
        expect(next.type).toBe("say");
        expect((next as Extract<AuditEvent, { type: "say" }>).lineId).toMatch(/^(q\.|p\.closing)/);
      }
    });
  });
});

describe("nothing off-script can be spoken", () => {
  it("refuses to speak a line that is not in the table", () => {
    const script = buildScript(inst);
    const table = buildSpeechTable(script, buildProtocol(DEFAULT_WORDING));
    const iv = new Interviewer({ instrument: inst, script, table });
    expect(() => (iv as unknown as { say(id: string): void }).say("p.great_answer")).toThrow(/not in the approved speech table/);
    expect(() => (iv as unknown as { say(id: string): void }).say("Great answer!")).toThrow(/not in the approved speech table/);
  });

  it("the introduction always carries the AI disclosure and a campaign cannot remove it", () => {
    const protocol = buildProtocol({ sponsor: "Acme Research", topic: "local transport", minutes: 5, askRecording: true });
    expect(protocol[0]!.text).toBe(`Hello. This is a call from Acme Research. ${AI_DISCLOSURE}`);
    const tampered = protocol.map((l) => (l.key === "intro" ? { ...l, text: "Hello. This is a call from Acme Research." } : l));
    expect(() => buildSpeechTable(buildScript(inst), tampered)).toThrow(/AI disclosure/);
    expect(() => buildProtocol({ sponsor: " ", topic: "x", minutes: 5, askRecording: false })).toThrow();
    expect(() => buildProtocol({ sponsor: "A", topic: "x", minutes: 0, askRecording: false })).toThrow();
  });

  it("holds for 400 random respondents, whatever they say and whatever the model returns", async () => {
    const phrases = ["yes", "no", "Yes", "No", "8", "3", "0", "12", "501", "Good", "Fair", "Only once", "Strongly agree", "Somewhat disagree", "I don't know", "refuse", "what do you mean?", "sorry?", "mmm", "", "maybe monthly", "a dozen", "it depends really", "Excellent", "10", "skip"];
    const endings = ["remove me", "stop", "call me back later", null];
    for (let seed = 1; seed <= 400; seed++) {
      const rand = rng(seed);
      const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
      const wild: ModelVerdict[] = [
        { intent: "answer", answer: { kind: "choice", code: pick(["1", "2", "3", "9"]) }, confidence: rand(), evidence: pick(["monthly", "a dozen", "made up words"]) },
        { intent: "question", confidence: 0.9, evidence: "what do you mean" },
        { intent: "unclear", confidence: 0.1, evidence: "mmm" },
        { intent: "yes", confidence: rand(), evidence: "it depends" },
      ];
      const model = { id: "wild", classify: async () => pick(wild) };
      const persona: Persona = () => (rand() < 0.03 ? pick(endings) : pick(phrases));
      const c = await call(persona, { model, wording: { ...DEFAULT_WORDING, askRecording: seed % 2 === 0 } });
      expectOnScript(c);
      expect(c.hungUp || c.interviewer.ended).toBe(true);
      expect(c.interviewer.log.map((e) => e.seq)).toEqual(c.interviewer.log.map((_, i) => i + 1));
      // No question is ever asked without consent.
      if (c.interviewer.state.consent.participate !== true) expect(saidIds(c).some((id) => id.startsWith("q."))).toBe(false);
    }
  });
});

describe("consent", () => {
  it("a no ends the call before any question", async () => {
    const c = await call(() => "no");
    expect(c.interviewer.state.outcome).toBe("consent_declined");
    expect(saidIds(c)).toEqual(["p.intro", "p.purpose", "p.transcribed", "p.how_to_stop", "p.consent_ask", "p.consent_declined"]);
    expect(c.interviewer.state.interview.answers).toEqual({});
  });

  it("anything short of a clear yes is not consent", async () => {
    const c = await call(() => "hmm I guess, what is this");
    expect(c.interviewer.state.outcome).toBe("consent_declined");
    expect(saidIds(c).filter((id) => id === "p.consent_unclear")).toHaveLength(2);
    expect(saidIds(c).some((id) => id.startsWith("q."))).toBe(false);
  });

  it("a model's hesitant yes is not enough", async () => {
    const model = scriptedModel({ "I suppose so": { intent: "yes", confidence: 0.7, evidence: "I suppose so" } });
    const c = await call(({ attempt }) => (attempt === 1 ? "I suppose so" : "no"), { model });
    expect(saidIds(c)).toContain("p.consent_unclear");
    expect(c.interviewer.state.outcome).toBe("consent_declined");
  });

  it("the introduction is repeated on request; opt-out and call-back work before consent", async () => {
    const repeat = await call(({ attempt }) => (attempt === 1 ? "sorry?" : "no"));
    expect(saidIds(repeat).filter((id) => id === "p.purpose")).toHaveLength(2);
    expect((await call(() => "take me off your list")).interviewer.state.outcome).toBe("opt_out");
    expect((await call(() => "this is not a good time")).interviewer.state.outcome).toBe("callback");
  });

  it("audio is kept only on a clear yes", async () => {
    const wording = { ...DEFAULT_WORDING, askRecording: true };
    const yes = await call(cooperative(SPOKEN_B), { wording });
    expect(saidIds(yes)).toContain("p.recording_ask");
    expect(yes.interviewer.state.consent).toEqual({ participate: true, recording: true });
    const vague = await call(at("recording", "uh whatever", cooperative(SPOKEN_B)), { wording });
    expect(vague.interviewer.state.consent.recording).toBe(false);
    expect(vague.interviewer.state.outcome).toBe("complete");
    expect((await call(cooperative(SPOKEN_B))).interviewer.state.consent.recording).toBeNull();
  });
});

describe("respect for the respondent", () => {
  it("opt-out mid-call ends at once and keeps the answers given", async () => {
    const c = await call(at("QID5", "please remove me from your list", cooperative(SPOKEN_A)));
    expect(c.interviewer.state.outcome).toBe("opt_out");
    expect(saidIds(c).at(-1)).toBe("p.opt_out_done");
    expect(Object.keys(c.interviewer.state.interview.answers)).toEqual(["QID2", "QID3", "QID4#1", "QID4#2", "QID4#3"]);
    expect(toRecord(c, "x", new Date(0), new Date(0))).toMatchObject({ finished: false, embedded: { vv_outcome: "opt_out" } });
  });

  it("a refusal is recorded at once, without pressing", async () => {
    const c = await call(at("QID6", "I'd rather not say", cooperative(SPOKEN_A)));
    expect(c.interviewer.state.interview.answers.QID6).toEqual({ kind: "nonresponse", reason: "refused" });
    expect(saidIds(c).filter((id) => id.startsWith("p.probe"))).toEqual([]);
    expect(c.interviewer.state.outcome).toBe("complete");
  });

  it("don't know gets one neutral probe, then is accepted", async () => {
    const c = await call(at("QID3", "I don't know", cooperative(SPOKEN_A)));
    expect(c.interviewer.state.interview.answers.QID3).toEqual({ kind: "nonresponse", reason: "dont_know" });
    const ids = saidIds(c);
    const i = ids.indexOf("p.probe_dont_know");
    expect(ids.slice(i, i + 4)).toEqual(["p.probe_dont_know", "q.QID3.options", "p.moving_on", "q.QID4.ask"]);
    expect(ids.filter((id) => id === "p.probe_dont_know")).toHaveLength(1);
  });

  it("a stopped call resumes later at the next unanswered question", async () => {
    const first = await call(at("QID4#2", "stop", cooperative(SPOKEN_A)));
    expect(first.interviewer.state.outcome).toBe("breakoff");
    const saved = JSON.parse(JSON.stringify(first.interviewer.state.interview));
    const second = await call(cooperative(SPOKEN_A), { resumeFrom: saved });
    expect(saidIds(second).slice(0, 10)).toEqual(["p.intro", "p.purpose", "p.transcribed", "p.how_to_stop", "p.consent_ask", "p.resume", "q.QID4.ask", "q.QID4.options", "q.QID4.row.2", "q.QID4.row.3"]);
    expect(second.interviewer.state.outcome).toBe("complete");
    expect(second.interviewer.state.interview.answers).toEqual(RESPONSE_A);
  });

  it("a hang-up leaves a partial record", async () => {
    const c = await call(at("QID6", null, cooperative(SPOKEN_A)));
    expect(c.hungUp).toBe(true);
    expect(toRecord(c, "x", new Date(0), new Date(0))).toMatchObject({ finished: false, embedded: { vv_outcome: "breakoff" } });
  });
});

describe("probing", () => {
  const natural = "probably about once a month I'd say";

  it("a confident model reading is recorded, with the evidence in the audit log", async () => {
    const model = scriptedModel({ [natural]: { intent: "answer", answer: { kind: "choice", code: "3" }, confidence: 0.93, evidence: "about once a month" } });
    const c = await call(at("QID3", natural, cooperative(SPOKEN_A)), { model });
    expect(c.interviewer.state.interview.answers).toEqual(RESPONSE_A);
    const classified = c.interviewer.log.find((e) => e.type === "classified" && e.slot === "QID3");
    expect(classified).toMatchObject({ classification: { by: "model", model: "scripted-model", evidence: "about once a month", confidence: 0.93 } });
    expect(decisions(c).find((d) => d.slot === "QID3")!.detail).toBe("answer accepted (model, confidence 0.93)");
    expect(model.calls).toEqual([natural]);
  });

  it("an uncertain reading is probed with the options, not recorded", async () => {
    const model = scriptedModel({ "sort of monthly": { intent: "answer", answer: { kind: "choice", code: "3" }, confidence: 0.7, evidence: "monthly" } });
    const c = await call(firstSaying("sort of monthly", cooperative(SPOKEN_B)), { model, policy: { acceptAt: 0.85, maxProbes: 2, maxRepeats: 2 } });
    // Q2 is yes/no: "sort of monthly" is unclear there; the survey then follows the short path.
    expect(c.interviewer.state.outcome).toBe("complete");
    const c2 = await call(at("QID3", "sort of monthly", cooperative(SPOKEN_A)), { model });
    const ids = saidIds(c2);
    const i = ids.indexOf("p.probe_closest");
    expect(ids.slice(i, i + 2)).toEqual(["p.probe_closest", "q.QID3.options"]);
    // Still uncertain after two probes: best answer kept and flagged for a person to check.
    expect(c2.interviewer.state.interview.answers.QID3).toEqual({ kind: "choice", code: "3" });
    expect(c2.interviewer.state.review).toEqual(["QID3"]);
    expect(decisions(c2).filter((d) => d.slot === "QID3").map((d) => d.action)).toEqual(["probe", "probe", "record"]);
  });

  it("a made-up model reading is thrown away and the question asked again", async () => {
    const model = scriptedModel({ "oh you know": { intent: "answer", answer: { kind: "choice", code: "1" }, confidence: 0.99, evidence: "once a week or more" } });
    const c = await call(({ expecting, attempt }) => (expecting.kind === "answer" && expecting.slot === "QID3" && attempt === 1 ? "oh you know" : cooperative(SPOKEN_A)({ expecting, attempt, said: [] })), { model });
    const classified = c.interviewer.log.find((e) => e.type === "classified" && e.slot === "QID3")!;
    expect(classified).toMatchObject({ classification: { intent: "unclear", rejected: "evidence is not part of what the respondent said" } });
    expect(saidIds(c)).toContain("p.probe_unclear");
    expect(c.interviewer.state.interview.answers).toEqual(RESPONSE_A);
  });

  it("a question from the respondent gets a fixed reply and the question again, never an explanation", async () => {
    const q = "what counts as a public library?";
    const model = scriptedModel({ [q]: { intent: "question", confidence: 0.95, evidence: "what counts as a public library" } });
    const c = await call(({ expecting, attempt }) => (expecting.kind === "answer" && expecting.slot === "QID2" && attempt === 1 ? q : cooperative(SPOKEN_A)({ expecting, attempt, said: [] })), { model });
    const ids = saidIds(c);
    const i = ids.indexOf("p.cannot_help");
    expect(ids.slice(i, i + 2)).toEqual(["p.cannot_help", "q.QID2.ask"]);
    expect(c.interviewer.state.interview.answers).toEqual(RESPONSE_A);
  });

  it("a repeat request repeats the question and its options in full", async () => {
    const c = await call(({ expecting, attempt }) => (expecting.kind === "answer" && expecting.slot === "QID4#2" && attempt === 1 ? "can you repeat that?" : cooperative(SPOKEN_A)({ expecting, attempt, said: [] })));
    const ids = saidIds(c);
    const i = ids.indexOf("p.probe_repeat");
    expect(ids.slice(i, i + 4)).toEqual(["p.probe_repeat", "q.QID4.ask", "q.QID4.options", "q.QID4.row.2"]);
  });

  it("a number question asks for a number", async () => {
    const c = await call(({ expecting, attempt }) => (expecting.kind === "answer" && expecting.slot === "QID6" && attempt === 1 ? "a fair few" : cooperative(SPOKEN_A)({ expecting, attempt, said: [] })));
    const ids = saidIds(c);
    const i = ids.indexOf("p.probe_unclear");
    expect(ids.slice(i, i + 3)).toEqual(["p.probe_unclear", "p.probe_number", "q.QID6.ask"]);
  });

  it("someone who never gives a usable answer is not kept on the line: each question is coded and flagged", async () => {
    const c = await call(mumbler());
    expect(c.interviewer.state.outcome).toBe("complete");
    const answers = c.interviewer.state.interview.answers;
    // Noises are not an answer to anything, including the open question.
    expect(Object.entries(answers).filter(([, a]) => a.kind === "nonresponse").map(([k]) => k)).toEqual(["QID2", "QID5", "QID6", "QID7", "QID8", "QID9"]);
    expect(c.interviewer.state.review).toEqual(["QID2", "QID5", "QID6", "QID7", "QID8", "QID9"]);
    expect(saidIds(c).filter((id) => id === "p.probe_unclear")).toHaveLength(12);
  });
});

describe("audit log", () => {
  it("every recorded answer can be traced: what was asked, heard, how it was read, and why it was kept", async () => {
    const c = await call(cooperative(SPOKEN_A));
    const log = c.interviewer.log;
    for (const d of decisions(c).filter((x) => x.action === "record")) {
      const i = log.indexOf(d);
      const classified = log[i - 1]!;
      const heard = log[i - 2]!;
      expect(classified).toMatchObject({ type: "classified", slot: d.slot });
      expect(heard.type).toBe("heard");
      const asked = log.slice(0, i - 2).reverse().find((e) => e.type === "say")!;
      expect((asked as Extract<AuditEvent, { type: "say" }>).lineId.startsWith(`q.${d.slot!.split("#")[0]}`)).toBe(true);
    }
    expect(decisions(c).filter((x) => x.action === "record")).toHaveLength(10);
    expect(JSON.parse(JSON.stringify(log))).toEqual(log);
  });
});
