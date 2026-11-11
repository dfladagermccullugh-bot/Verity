import { describe, expect, it } from "vitest";
import { phoneConnect } from "../src/dialer/phone-connect.js";
import type { Claim } from "../src/dialer/store.js";
import { Interviewer } from "../src/interviewer/interviewer.js";
import { buildProtocol, buildSpeechTable } from "../src/interviewer/protocol.js";
import { DEFAULT_WORDING } from "../src/interviewer/simulate.js";
import { buildScript } from "../src/script/script.js";
import { FakeCallSession } from "../src/telephony/fake.js";
import type { TelephonyProvider } from "../src/telephony/types.js";
import { PAGE_SAMPLE_RATE, SpeechStore, cartesiaVoice, deepgramVoice, humVoice, pcmWav, silentVoice, wavData } from "../src/voice/tts.js";
import { RESPONSE_A, library } from "./helpers.js";

const inst = library();
const SCALE = 0.002; // run calls 500 times faster than real time
const SPOKEN: Record<string, string> = { "p.consent_ask": "yes", "q.QID2.ask": "Yes", "q.QID3.options": "About once a month", "q.QID4.row.1": "Somewhat agree", "q.QID4.row.2": "Neither agree nor disagree", "q.QID4.row.3": "Strongly agree", "q.QID5.options": "8", "q.QID6.ask": "12", "q.QID7.ask": "yes", "q.QID8.ask": "Longer weekend hours", "q.QID9.options": "Good" };

type Behaviour = (session: FakeCallSession, lineId: string) => void;

/** A respondent on a fake call: reacts when a given line has finished playing. */
function respondent(session: FakeCallSession, replies: Record<string, string | Behaviour>): void {
  session.on("mark", (lineId) => {
    const r = replies[lineId];
    if (r === undefined) return;
    setTimeout(() => {
      if (session.ended) return;
      if (typeof r === "function") return r(session, lineId);
      const now = session.now();
      session.speechStart(now);
      session.say(r, { startMs: now, endMs: now + 600 });
      session.utteranceEnd();
    }, 900 * SCALE);
  });
}

function setup(replies: Record<string, string | Behaviour>, onStart?: (s: FakeCallSession) => void) {
  const script = buildScript(inst);
  const table = buildSpeechTable(script, buildProtocol(DEFAULT_WORDING));
  const interviewer = new Interviewer({ instrument: inst, script, table });
  const session = new FakeCallSession({ timeScale: SCALE });
  respondent(session, replies);
  const dialled: { to: string; amd?: boolean }[] = [];
  const provider: TelephonyProvider = {
    name: "fake",
    startCall: async (to, o) => {
      dialled.push({ to, ...(o.amd === undefined ? {} : { amd: o.amd }) });
      (onStart ?? ((s) => setTimeout(() => s.answer(), 5)))(session);
      return session;
    },
  };
  const speech = new SpeechStore(silentVoice(60));
  const claim = { case: { phone: "+12025550143" } } as Claim;
  return { interviewer, session, provider, speech, claim, dialled, table };
}

describe("a phone call", () => {
  it("plays each line into the call, hears the replies, and completes the survey", async () => {
    const t = setup(SPOKEN);
    const result = await phoneConnect({ provider: t.provider, speech: t.speech, detectMachine: false })(t.claim, t.interviewer);
    expect(result).toEqual({ connected: true });
    expect(t.dialled).toEqual([{ to: "+12025550143", amd: false }]);
    expect(t.interviewer.state.outcome).toBe("complete");
    expect(t.interviewer.state.interview.answers).toEqual(RESPONSE_A);
    expect(t.session.ended).toBe(true);
    // Each clip played is the rendered audio of the line the interviewer chose, in order.
    const said = t.interviewer.log.filter((e) => e.type === "say").map((e) => (e as { lineId: string }).lineId);
    expect(t.session.played.map((p) => p.markName)).toEqual(said);
    for (const p of t.session.played) expect(p.mulaw).toEqual(await t.speech.get(t.table.lines.get(p.markName as never)!));
    expect(Object.keys(t.interviewer.state.latencyMs)).toHaveLength(10);
  }, 20_000);

  it("stops playing when the respondent speaks over the options, and flags the answer", async () => {
    const t = setup({ ...SPOKEN, "q.QID3.options": "unused" });
    t.session.on("mark", (lineId) => {
      if (lineId !== "q.QID3.ask") return;
      setTimeout(() => {
        const now = t.session.now();
        t.session.say("About once a month", { startMs: now, endMs: now + 500 });
        t.session.utteranceEnd();
      }, 300 * SCALE);
    });
    await phoneConnect({ provider: t.provider, speech: t.speech, detectMachine: false })(t.claim, t.interviewer);
    const options = t.session.played.find((p) => p.markName === "q.QID3.options")!;
    expect(options.completed).toBe(false);
    expect(t.interviewer.state.interview.answers).toEqual(RESPONSE_A);
    expect(t.interviewer.state.review).toEqual(["QID3"]);
  }, 20_000);

  it("takes keypad answers, ending a number with the pound key", async () => {
    const keys = (digits: string): Behaviour => (s) => [...digits].forEach((d) => s.pressKey(d));
    const t = setup({ ...SPOKEN, "q.QID3.options": keys("3"), "q.QID5.options": keys("8#"), "q.QID6.ask": keys("12#") });
    await phoneConnect({ provider: t.provider, speech: t.speech, detectMachine: false, phone: { keyGapMs: 400 } })(t.claim, t.interviewer);
    expect(t.interviewer.state.interview.answers).toEqual(RESPONSE_A);
  }, 20_000);

  it("a hang-up mid-call keeps the answers given", async () => {
    const t = setup({ ...SPOKEN, "q.QID5.options": (s) => s.remoteHangup() });
    const result = await phoneConnect({ provider: t.provider, speech: t.speech, detectMachine: false })(t.claim, t.interviewer);
    expect(result).toEqual({ connected: true });
    expect(t.interviewer.state.outcome).toBe("breakoff");
    expect(Object.keys(t.interviewer.state.interview.answers)).toHaveLength(5);
  }, 20_000);
});

describe("calls that never reach a person", () => {
  const run = async (onStart: (s: FakeCallSession) => void, extra = {}) => {
    const t = setup(SPOKEN, onStart);
    const result = await phoneConnect({ provider: t.provider, speech: t.speech, ringTimeoutMs: 20_000, machineWaitMs: 1000, ...extra })(t.claim, t.interviewer);
    return { result, ...t };
  };

  it("no answer, busy and a dead number are outcomes, and the interviewer never speaks", async () => {
    const noAnswer = await run(() => {}, { ringTimeoutMs: 2000 });
    expect(noAnswer.result).toEqual({ connected: false, outcome: "no_answer" });
    expect(noAnswer.session.ended).toBe(true);
    expect(noAnswer.session.played).toEqual([]);
    expect((await run((s) => s.remoteHangup("call-user_busy"))).result).toEqual({ connected: false, outcome: "busy" });
    expect((await run((s) => s.remoteHangup("call-unallocated_number"))).result).toEqual({ connected: false, outcome: "invalid_number" });
    expect((await run((s) => s.remoteHangup("call-not-answered"))).result).toEqual({ connected: false, outcome: "no_answer" });
  });

  it("an answering machine is hung up on, with no message left", async () => {
    const t = await run((s) => setTimeout(() => (s.answer(), s.machineDetected("machine")), 5));
    expect(t.result).toEqual({ connected: false, outcome: "answering_machine" });
    expect(t.session.played).toEqual([]);
    expect(t.interviewer.log).toEqual([]);
  });

  it("a person, or no verdict in time, gets the interview", async () => {
    const t = await run((s) => setTimeout(() => (s.answer(), s.machineDetected("human")), 5));
    expect(t.result).toEqual({ connected: true });
    expect(t.interviewer.state.outcome).toBe("complete");
  }, 20_000);

  it("a refused or failed dial is an outcome, not a crash", async () => {
    const t = setup(SPOKEN);
    const failing = (message: string): TelephonyProvider => ({ name: "x", startCall: async () => Promise.reject(new Error(message)) });
    expect(await phoneConnect({ provider: failing("Refusing to dial: premium-rate"), speech: t.speech })(t.claim, t.interviewer)).toEqual({ connected: false, outcome: "invalid_number" });
    expect(await phoneConnect({ provider: failing("HTTP 503"), speech: t.speech })(t.claim, t.interviewer)).toEqual({ connected: false, outcome: "carrier_error" });
  });
});

describe("rendered speech", () => {
  it("renders each line once and reuses it", async () => {
    let calls = 0;
    const voice = { id: "counting", synthesize: async (text: string) => (calls++, Buffer.alloc(text.length * 10, 0xff)) };
    const store = new SpeechStore(voice);
    const table = buildSpeechTable(buildScript(inst), buildProtocol(DEFAULT_WORDING));
    const first = await store.prerender(table);
    expect(first.lines).toBe(table.lines.size);
    expect(calls).toBe(new Set([...table.lines.values()].map((l) => l.text)).size);
    await store.prerender(table);
    expect(calls).toBe(new Set([...table.lines.values()].map((l) => l.text)).size);
    await expect(new SpeechStore({ id: "empty", synthesize: async () => Buffer.alloc(0) }).get({ text: "Hello" })).rejects.toThrow(/no audio/);
  });

  it("asks Cartesia for raw 8 kHz mu-law, as its API reference specifies", async () => {
    const seen: { url: string; init: any }[] = [];
    const fetch = async (url: string, init: any) => (seen.push({ url, init }), { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, text: async () => "" });
    const voice = cartesiaVoice({ apiKey: "k", voiceId: "v-1", fetch });
    expect(voice.id).toBe("cartesia/sonic-3.6/v-1");
    expect(await voice.synthesize("Hello.")).toEqual(Buffer.from([1, 2, 3]));
    expect(seen[0]!.url).toBe("https://api.cartesia.ai/tts/bytes");
    expect(seen[0]!.init.headers).toMatchObject({ Authorization: "Bearer k", "Cartesia-Version": "2026-08-14" });
    expect(JSON.parse(seen[0]!.init.body)).toEqual({ model_id: "sonic-3.6", transcript: "Hello.", voice: { id: "v-1" }, output_format: { container: "raw", encoding: "pcm_mulaw", sample_rate: 8000 }, language: "en" });
  });

  it("for a web page, asks each vendor for a 24 kHz WAV file and refuses anything else", async () => {
    const wav = pcmWav(new Int16Array(480), PAGE_SAMPLE_RATE);
    const seen: { url: string; init: any }[] = [];
    let body: Buffer = wav;
    const fetch = async (url: string, init: any) => (seen.push({ url, init }), { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) as ArrayBuffer, text: async () => "" });
    const cartesia = cartesiaVoice({ apiKey: "k", voiceId: "v-1", output: "page", fetch });
    expect(cartesia.id).toBe("cartesia/sonic-3.6/v-1/page");
    expect(await cartesia.synthesize("Hello.")).toEqual(wav);
    expect(JSON.parse(seen[0]!.init.body).output_format).toEqual({ container: "wav", encoding: "pcm_s16le", sample_rate: 24000 });
    const deepgram = deepgramVoice({ apiKey: "k", output: "page", fetch });
    expect(deepgram.id).toBe("deepgram/aura-2-thalia-en/page");
    expect(await deepgram.synthesize("Hello.")).toEqual(wav);
    expect(Object.fromEntries(new URL(seen[1]!.url).searchParams)).toEqual({ model: "aura-2-thalia-en", encoding: "linear16", sample_rate: "24000", container: "wav" });
    body = Buffer.from('{"err_msg":"nope"}');
    await expect(deepgram.synthesize("Hello.")).rejects.toThrow(/did not return a WAV file/);
    await expect(cartesia.synthesize("Hello.")).rejects.toThrow(/did not return a WAV file/);
  });

  it("the stand-in page voice is a WAV file of about the length the words take to say", async () => {
    const audio = await humVoice(15).synthesize("x".repeat(30));
    expect(audio.toString("ascii", 0, 4) + audio.toString("ascii", 8, 12)).toBe("RIFFWAVE");
    expect(audio.readUInt32LE(24)).toBe(PAGE_SAMPLE_RATE);
    expect((audio.length - 44) / 2 / PAGE_SAMPLE_RATE).toBeCloseTo(2, 1);
  });

  it("two requests for the same line share one rendering", async () => {
    let calls = 0;
    const store = new SpeechStore({ id: "slow", synthesize: async () => (calls++, await new Promise((r) => setTimeout(r, 10)), Buffer.from([1])) });
    const [a, b] = await Promise.all([store.get({ text: "Hello." }), store.get({ text: "Hello." })]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
    const failing = new SpeechStore({ id: "down", synthesize: async () => { throw new Error("vendor down"); } });
    await expect(failing.get({ text: "Hello." })).rejects.toThrow("vendor down");
    await expect(failing.get({ text: "Hello." })).rejects.toThrow("vendor down");
  });

  it("asks Deepgram for 8 kHz mu-law and removes the WAV wrapper", async () => {
    const data = Buffer.from([9, 8, 7, 6]);
    const header = Buffer.alloc(12);
    header.write("RIFF", 0, "ascii");
    header.write("WAVE", 8, "ascii");
    const chunk = (id: string, body: Buffer) => Buffer.concat([Buffer.from(id, "ascii"), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(body.length); return b; })(), body, Buffer.alloc(body.length % 2)]);
    const wav = Buffer.concat([header, chunk("fmt ", Buffer.alloc(18)), chunk("fact", Buffer.alloc(4)), chunk("data", data)]);
    const seen: string[] = [];
    const fetch = async (url: string) => (seen.push(url), { ok: true, status: 200, arrayBuffer: async () => wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.length) as ArrayBuffer, text: async () => "" });
    expect(await deepgramVoice({ apiKey: "k", fetch }).synthesize("Hello.")).toEqual(data);
    expect(seen[0]).toBe("https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=mulaw&sample_rate=8000&container=wav");
    expect(wavData(data)).toEqual(data);
    const failing = async () => ({ ok: false, status: 401, arrayBuffer: async () => new ArrayBuffer(0), text: async () => "bad key" });
    await expect(deepgramVoice({ apiKey: "k", fetch: failing }).synthesize("x")).rejects.toThrow(/HTTP 401/);
  });
});
