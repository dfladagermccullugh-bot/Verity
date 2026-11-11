import { describe, expect, it } from "vitest";
import { Interviewer, type AuditEvent } from "../src/interviewer/interviewer.js";
import { buildProtocol, buildSpeechTable, type SpeechTable } from "../src/interviewer/protocol.js";
import { DEFAULT_WORDING } from "../src/interviewer/simulate.js";
import { buildScript } from "../src/script/script.js";
import { runVoiceCall } from "../src/voice/call.js";
import { ScriptedVoice, spokenPersona, type SpokenReply } from "../src/voice/scripted.js";
import { RESPONSE_A, library, rng } from "./helpers.js";

const inst = library();
const A: Record<string, SpokenReply> = {
  QID2: { say: "Yes" }, QID3: { say: "About once a month" }, "QID4#1": { say: "Somewhat agree" }, "QID4#2": { say: "Neither agree nor disagree" }, "QID4#3": { say: "Strongly agree" },
  QID5: { say: "8" }, QID6: { say: "12" }, QID7: { say: "yes" }, QID8: { say: "Longer weekend hours" }, QID9: { say: "Good" },
};

async function spokenCall(replies: Record<string, SpokenReply>, fallback?: SpokenReply): Promise<{ iv: Interviewer; voice: ScriptedVoice; table: SpeechTable; dropped: boolean }> {
  const script = buildScript(inst);
  const table = buildSpeechTable(script, buildProtocol(DEFAULT_WORDING));
  const iv = new Interviewer({ instrument: inst, script, table });
  const voice = new ScriptedVoice(spokenPersona(() => iv.expecting(), replies, fallback));
  const { dropped } = await runVoiceCall(iv, voice, { replyWaitMs: 8000, maxSilences: 3 });
  return { iv, voice, table, dropped };
}
const events = <T extends AuditEvent["type"]>(iv: Interviewer, type: T) => iv.log.filter((e): e is Extract<AuditEvent, { type: T }> => e.type === type);

describe("a spoken call", () => {
  it("runs to the end, plays every line in full, and hangs up", async () => {
    const { iv, voice, dropped } = await spokenCall(A);
    expect(dropped).toBe(false);
    expect(voice.hungUp).toBe(true);
    expect(iv.state.outcome).toBe("complete");
    expect(iv.state.interview.answers).toEqual(RESPONSE_A);
    const played = events(iv, "played");
    expect(played.every((p) => p.completed)).toBe(true);
    expect(played.map((p) => p.lineId)).toEqual(events(iv, "say").map((s) => s.lineId));
    // Lines play one after another, never overlapping.
    played.forEach((p, i) => i > 0 && expect(p.startedMs).toBeGreaterThanOrEqual(played[i - 1]!.endedMs));
  });

  it("measures response time from the end of the question audio to the start of the reply", async () => {
    const { iv } = await spokenCall({ ...A, QID5: { say: "8", afterMs: 2400 }, QID6: { say: "12", afterMs: 350 } });
    expect(iv.state.latencyMs).toMatchObject({ QID2: 900, QID5: 2400, QID6: 350, "QID4#2": 900 });
    expect(Object.keys(iv.state.latencyMs)).toHaveLength(10);
    const turn = events(iv, "turn").find((t) => t.slot === "QID5")!;
    const lastAudio = events(iv, "played").filter((p) => p.lineId.startsWith("q.QID5")).at(-1)!;
    expect(turn.startedMs - lastAudio.endedMs).toBe(2400);
  });
});

describe("interruptions", () => {
  it("stops playing when the respondent starts talking, keeps the answer and flags it", async () => {
    const { iv } = await spokenCall({ ...A, QID3: { say: "About once a month", interruptAt: 0.6 } });
    const q3 = events(iv, "played").filter((p) => p.lineId.startsWith("q.QID3"));
    expect(q3.map((p) => [p.lineId, p.completed])).toEqual([["q.QID3.ask", true], ["q.QID3.options", false]]);
    expect(iv.state.interview.answers.QID3).toEqual({ kind: "choice", code: "3" });
    expect(iv.state.review).toEqual(["QID3"]);
    expect(events(iv, "flag")).toEqual([expect.objectContaining({ slot: "QID3", reason: "answered before the question and options were heard in full" })]);
    // No response time is claimed for a reply that began before the question ended.
    expect(iv.state.latencyMs.QID3).toBeUndefined();
    expect(iv.state.outcome).toBe("complete");
  });

  it("an opt-out spoken over the introduction is honoured at once", async () => {
    const { iv, voice } = await spokenCall({ consent: { say: "take me off your list", interruptAt: 0.2 } });
    expect(iv.state.outcome).toBe("opt_out");
    // Playback stopped part-way through the introduction; the consent question was never reached.
    const intro = voice.heard.slice(0, -1);
    expect(intro[0]!.lineId).toBe("p.intro");
    expect(intro.filter((h) => !h.completed)).toHaveLength(1);
    expect(intro.at(-1)!.completed).toBe(false);
    expect(voice.heard.some((h) => h.lineId === "p.consent_ask")).toBe(false);
    expect(voice.heard.at(-1)).toEqual({ lineId: "p.opt_out_done", completed: true });
    expect(events(iv, "say").some((s) => s.lineId.startsWith("q."))).toBe(false);
  });

  it("a question interrupted by a request to repeat is read again in full, and not flagged", async () => {
    let asked = 0;
    const script = buildScript(inst);
    const table = buildSpeechTable(script, buildProtocol(DEFAULT_WORDING));
    const iv = new Interviewer({ instrument: inst, script, table });
    const base = spokenPersona(() => iv.expecting(), A);
    const voice = new ScriptedVoice((ctx) => {
      const e = iv.expecting();
      if (e.kind === "answer" && e.slot === "QID3" && asked++ === 0) return { say: "sorry, what?", interruptAt: 0.3 };
      return base(ctx);
    });
    await runVoiceCall(iv, voice);
    expect(iv.state.interview.answers).toEqual(RESPONSE_A);
    expect(iv.state.review).toEqual([]);
    expect(voice.heard.filter((h) => h.lineId === "q.QID3.options")).toEqual([{ lineId: "q.QID3.options", completed: true }]);
  });
});

describe("silence and hang-ups", () => {
  it("one silence gets a neutral re-ask; three in a row end the call and keep the answers", async () => {
    const once = await spokenCall({ ...A, QID5: { silence: true } }, { silence: true });
    // After the silence the persona keeps answering QID5 with silence: three in a row.
    expect(once.dropped).toBe(true);
    expect(once.iv.state.outcome).toBe("breakoff");
    expect(Object.keys(once.iv.state.interview.answers)).toEqual(["QID2", "QID3", "QID4#1", "QID4#2", "QID4#3"]);
    expect(events(once.iv, "turn").filter((t) => t.via === "silence")).toHaveLength(3);
    expect(events(once.iv, "say").filter((s) => s.lineId === "p.probe_unclear")).toHaveLength(2);
    expect(events(once.iv, "decision").at(-1)!.detail).toBe("breakoff: no reply 3 times in a row");
    expect(once.voice.hungUp).toBe(true);
  });

  it("silence before consent is never consent", async () => {
    const { iv } = await spokenCall({ consent: { silence: true } });
    expect(iv.state.outcome).toBe("consent_declined");
    expect(iv.state.consent.participate).not.toBe(true);
    expect(events(iv, "say").some((s) => s.lineId.startsWith("q."))).toBe(false);
  });

  it("a hang-up ends the call as a break-off with the answers so far", async () => {
    const { iv, dropped } = await spokenCall({ ...A, QID6: { hangup: true } });
    expect(dropped).toBe(true);
    expect(iv.state.outcome).toBe("breakoff");
    expect(Object.keys(iv.state.interview.answers)).toHaveLength(6);
    expect(events(iv, "decision").at(-1)!.detail).toBe("breakoff: the respondent hung up");
  });
});

describe("keypad", () => {
  it("keys answer by option position, scale point or number; star repeats", async () => {
    let starred = false;
    const script = buildScript(inst);
    const table = buildSpeechTable(script, buildProtocol(DEFAULT_WORDING));
    const iv = new Interviewer({ instrument: inst, script, table });
    const keyed: Record<string, SpokenReply> = { ...A, QID3: { keys: "3" }, "QID4#1": { keys: "4" }, QID5: { keys: "8#" }, QID6: { keys: "12#" }, QID9: { keys: "2" } };
    const base = spokenPersona(() => iv.expecting(), keyed);
    const voice = new ScriptedVoice((ctx) => {
      const e = iv.expecting();
      if (e.kind === "answer" && e.slot === "QID9" && !starred) return (starred = true), { keys: "*" };
      return base(ctx);
    });
    await runVoiceCall(iv, voice);
    expect(iv.state.interview.answers).toEqual(RESPONSE_A);
    const c = iv.log.find((e) => e.type === "classified" && e.slot === "QID5")!;
    expect(c).toMatchObject({ classification: { by: "rule", confidence: 1, evidence: "keypad 8#" } });
    expect(events(iv, "say").filter((s) => s.lineId === "p.probe_repeat")).toHaveLength(1);
  });

  it("a key that matches no option is not an answer, and keys are never consent", async () => {
    const { iv } = await spokenCall({ ...A, QID3: { keys: "9" } });
    expect(iv.state.interview.answers.QID3).toEqual({ kind: "nonresponse", reason: "no_answer" });
    const consentByKey = await spokenCall({ consent: { keys: "1" } });
    expect(consentByKey.iv.state.outcome).toBe("consent_declined");
  });
});

describe("any spoken call", () => {
  it("300 random callers: only table lines are played, in order, and the log stays whole", async () => {
    const says = ["Yes", "No", "8", "12", "Good", "Only once", "Strongly agree", "I don't know", "sorry?", "mmm", "remove me", "stop", "what do you mean?", "call me back later"];
    for (let seed = 1; seed <= 300; seed++) {
      const rand = rng(seed);
      const script = buildScript(inst);
      const table = buildSpeechTable(script, buildProtocol({ ...DEFAULT_WORDING, askRecording: seed % 3 === 0 }));
      const iv = new Interviewer({ instrument: inst, script, table });
      const voice = new ScriptedVoice((): SpokenReply => {
        const r = rand();
        if (r < 0.03) return { hangup: true };
        if (r < 0.1) return { silence: true };
        if (r < 0.2) return { keys: String(Math.floor(rand() * 12)) };
        const reply: SpokenReply = { say: says[Math.floor(rand() * says.length)]!, afterMs: Math.floor(rand() * 3000) };
        return rand() < 0.2 ? { ...reply, interruptAt: rand() } : reply;
      });
      await runVoiceCall(iv, voice);
      expect(iv.ended).toBe(true);
      expect(iv.log.map((e) => e.seq)).toEqual(iv.log.map((_, i) => i + 1));
      const played = events(iv, "played");
      for (const p of played) expect(table.lines.has(p.lineId as never)).toBe(true);
      played.forEach((p, i) => i > 0 && expect(p.startedMs).toBeGreaterThanOrEqual(played[i - 1]!.endedMs));
      // Everything played was first chosen by the interviewer, in the same order.
      const chosen = events(iv, "say").map((s) => s.lineId);
      let at = 0;
      for (const p of played) {
        at = chosen.indexOf(p.lineId, at);
        expect(at).toBeGreaterThanOrEqual(0);
        at += 1;
      }
      for (const [slot, ms] of Object.entries(iv.state.latencyMs)) {
        expect(ms).toBeGreaterThanOrEqual(0);
        expect(iv.state.interview.answers[slot] !== undefined || iv.state.outcome !== "complete").toBe(true);
      }
    }
  });
});
