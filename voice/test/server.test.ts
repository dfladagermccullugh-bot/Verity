import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { buildApp } from "../src/server/app.js";
import { BrowserChannel, MIC_SAMPLE_RATE, type Socket } from "../src/server/browser-channel.js";
import { scriptedStt, type SttEventMap, type SttStream } from "../src/telephony/stt.js";
import { humVoice } from "../src/voice/tts.js";
import { EventEmitter } from "node:events";
import { library } from "./helpers.js";

const REPLIES: Record<string, string> = { "p.consent_ask": "yes", "q.QID2.ask": "Yes", "q.QID3.options": "About once a month", "q.QID4.row.1": "Somewhat agree", "q.QID4.row.2": "the third one", "q.QID4.row.3": "Strongly agree", "q.QID5.options": "eight", "q.QID6.ask": "12", "q.QID7.ask": "no" };

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function start(opts: Partial<Parameters<typeof buildApp>[0]> = {}): Promise<string> {
  app = await buildApp({ demoInstrument: library(), ...opts });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return `127.0.0.1:${addr.port}`;
}

/** A page stand-in: plays every line "in full", answers from a table keyed by the last line heard. */
function visitor(host: string, replies: Record<string, string | { keys: string } | "hangup" | null>, opts: { cutAt?: string } = {}): Promise<{ ended: any; spoken: string[]; refused?: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}/demo/ws`);
    const spoken: string[] = [];
    let clock = 0;
    let last = "";
    let ended: any = null;
    let refused: string | undefined;
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "speak") {
        const played = [];
        for (const line of msg.lines) {
          spoken.push(line.id);
          const completed = line.id !== opts.cutAt;
          played.push({ lineId: line.id, startedMs: clock, endedMs: (clock += 1000), completed });
          last = line.id;
          if (!completed) break;
        }
        ws.send(JSON.stringify({ type: "played", played }));
      } else if (msg.type === "listen") {
        const r = replies[last];
        clock += 800;
        if (r === null) return ws.close();
        if (r === "hangup") return ws.send(JSON.stringify({ type: "hangup" }));
        if (r === undefined) ws.send(JSON.stringify({ type: "turn", kind: "silence", startedMs: clock, endedMs: clock }));
        else if (typeof r === "string") ws.send(JSON.stringify({ type: "turn", kind: "speech", text: r, startedMs: clock, endedMs: (clock += 500) }));
        else ws.send(JSON.stringify({ type: "turn", kind: "keys", digits: r.keys, startedMs: clock, endedMs: clock }));
      } else if (msg.type === "ended") ended = msg;
      else if (msg.type === "refused") refused = msg.reason;
    });
    ws.on("close", () => resolve({ ended, spoken, ...(refused ? { refused } : {}) }));
    ws.on("error", reject);
  });
}

describe("the demo server", () => {
  it("serves the page, which states that the interviewer is AI before anything starts", async () => {
    const host = await start();
    const page = await (await fetch(`http://${host}/`)).text();
    expect(page).toContain("automated AI interviewer, not a person");
    expect(page).toContain("This demo stores nothing you say");
    // The page asks no other site for anything: its typeface comes from this server.
    expect(page).not.toMatch(/(src|href)="https?:/);
    const font = await fetch(`http://${host}/assets/newsreader.woff2`);
    expect(font.headers.get("content-type")).toBe("font/woff2");
    expect(Buffer.from(await font.arrayBuffer()).subarray(0, 4).toString()).toBe("wOF2");
    expect(await (await fetch(`http://${host}/health`)).json()).toEqual({ ok: true, demoSessions: 0, model: null, carrier: null });
    expect(await (await fetch(`http://${host}/demo/info`)).json()).toMatchObject({ survey: "Library test", model: null });
  });

  it("runs a whole interview over the page's connection and returns how each answer was read", async () => {
    const host = await start();
    const { ended, spoken } = await visitor(host, REPLIES);
    expect(spoken.slice(0, 5)).toEqual(["p.intro", "p.purpose", "p.transcribed", "p.how_to_stop", "p.consent_ask"]);
    expect(spoken.at(-1)).toBe("p.closing");
    expect(ended).toMatchObject({ type: "ended", outcome: "complete", answered: 8, review: [] });
    expect(ended.trail.map((t: any) => [t.said, t.readAs, t.by])).toEqual([
      ["Yes", "Yes", "rule"],
      ["About once a month", "About once a month", "rule"],
      ["Somewhat agree", "Somewhat agree", "rule"],
      ["the third one", "Neither agree nor disagree", "rule"],
      ["Strongly agree", "Strongly agree", "rule"],
      ["eight", "8", "rule"],
      ["12", "12", "rule"],
      ["no", "No", "rule"],
    ]);
    expect(ended.trail[3].question).toBe("The opening hours suit me.");
    expect(Object.keys(ended.latencyMs)).toHaveLength(8);
  });

  it("keypad answers, an opt-out, and a visitor who closes the page", async () => {
    const host = await start();
    const keyed = await visitor(host, { ...REPLIES, "q.QID3.options": { keys: "3" }, "q.QID5.options": { keys: "8#" } });
    expect(keyed.ended.outcome).toBe("complete");
    const optOut = await visitor(host, { ...REPLIES, "q.QID3.options": "please remove me from your list" });
    expect(optOut.ended).toMatchObject({ outcome: "opt_out", answered: 1 });
    expect(optOut.spoken.at(-1)).toBe("p.opt_out_done");
    const left = await visitor(host, { ...REPLIES, "q.QID5.options": null });
    expect(left.ended).toBeNull();
    expect(await (await fetch(`http://${host}/health`)).json()).toMatchObject({ demoSessions: 0 });
  });

  it("the page's hang-up button ends the interview and still returns how the answers so far were read", async () => {
    const host = await start();
    const partWay = await visitor(host, { ...REPLIES, "q.QID4.row.1": "hangup" });
    expect(partWay.ended).toMatchObject({ type: "ended", outcome: "breakoff", answered: 2 });
    expect(partWay.ended.trail.map((t: any) => t.readAs)).toEqual(["Yes", "About once a month"]);
    expect(partWay.spoken.at(-1)).toBe("q.QID4.row.1");
    const beforeConsent = await visitor(host, { "p.consent_ask": "hangup" });
    expect(beforeConsent.ended).toMatchObject({ outcome: "consent_declined", answered: 0, trail: [] });
    expect(await (await fetch(`http://${host}/health`)).json()).toMatchObject({ demoSessions: 0 });
  });

  it("limits how many demo interviews one visitor can start", async () => {
    const host = await start({ demoPerHour: 2 });
    await visitor(host, { "p.consent_ask": "no" });
    await visitor(host, { "p.consent_ask": "no" });
    const third = await visitor(host, { "p.consent_ask": "no" });
    expect(third.refused).toMatch(/Too many demo interviews/);
    expect(third.spoken).toEqual([]);
  });
});

describe("messages from the page are not trusted", () => {
  function fakeSocket() {
    const handlers: Record<string, ((d: any) => void)[]> = { message: [], close: [] };
    const sent: any[] = [];
    const socket: Socket = { send: (d) => sent.push(JSON.parse(d)), close: () => {}, on: (e: string, cb: any) => void handlers[e]!.push(cb) } as Socket;
    const reply = (obj: unknown) => handlers.message!.forEach((h) => h({ toString: () => (typeof obj === "string" ? obj : JSON.stringify(obj)) }));
    return { socket, sent, reply, close: () => handlers.close!.forEach((h) => h(undefined)) };
  }
  const lines = [{ id: "p.intro", text: "Hello." }, { id: "p.purpose", text: "Purpose." }] as never[];

  it("ignores played reports for lines it did not send, out of order, or with impossible times", async () => {
    const f = fakeSocket();
    const ch = new BrowserChannel(f.socket);
    let p = ch.speak(lines);
    f.reply({ type: "played", played: [{ lineId: "p.intro", startedMs: 0, endedMs: 900, completed: true }, { lineId: "p.great_answer", startedMs: 900, endedMs: 1800, completed: true }] });
    expect(await p).toEqual([{ lineId: "p.intro", startedMs: 0, endedMs: 900, completed: true }]);
    p = ch.speak(lines);
    f.reply("not json");
    f.reply({ type: "turn", kind: "speech", text: "wrong kind of message" });
    f.reply({ type: "played", played: [{ lineId: "p.intro", startedMs: 100, endedMs: 50, completed: true }] });
    expect(await p).toEqual([]);
    p = ch.speak(lines);
    f.reply({ type: "played", played: [{ lineId: "p.intro", startedMs: 1000, endedMs: 1500, completed: false }, { lineId: "p.purpose", startedMs: 1500, endedMs: 2000, completed: true }] });
    expect(await p).toEqual([{ lineId: "p.intro", startedMs: 1000, endedMs: 1500, completed: false }]);
  });

  it("caps reply length, rejects odd key strings, and treats anything else as silence", async () => {
    const f = fakeSocket();
    const ch = new BrowserChannel(f.socket);
    let t = ch.listen(1000);
    f.reply({ type: "turn", kind: "speech", text: "x".repeat(5000), startedMs: 10, endedMs: 20 });
    expect(await t).toMatchObject({ kind: "speech", startedMs: 10, endedMs: 20 });
    t = ch.listen(1000);
    f.reply({ type: "turn", kind: "speech", text: "y".repeat(5000) });
    expect(((await t) as { text: string }).text).toHaveLength(500);
    t = ch.listen(1000);
    f.reply({ type: "turn", kind: "keys", digits: "12; drop table" });
    expect((await t).kind).toBe("silence");
    t = ch.listen(1000);
    f.reply({ type: "turn", kind: "speech", text: "   ", startedMs: "soon" });
    expect((await t).kind).toBe("silence");
    t = ch.listen(1000);
    f.close();
    expect((await t).kind).toBe("hangup");
    expect(await ch.speak(lines)).toEqual([]);
  });
});

/** One piece of microphone sound as the page sends it: its clock, then `ms` of 16-bit samples. */
function sound(pageMs: number, ms: number): Buffer {
  const frame = Buffer.alloc(4 + Math.round((ms / 1000) * MIC_SAMPLE_RATE) * 2);
  frame.writeUInt32LE(pageMs, 0);
  return frame;
}

/**
 * A page stand-in that uses the server's voice and hearing: it fetches each line's recording,
 * and while a reply is awaited it sends microphone sound until the server says what it heard.
 */
function speaker(host: string, opts: { duringLines?: boolean; type?: Record<string, string>; hangUpAfter?: number } = {}): Promise<{ ended: any; heard: string[]; deaf?: string; fetched: number[]; stops: number }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}/demo/ws`);
    const heard: string[] = [];
    const fetched: number[] = [];
    let clock = 0;
    let ended: any = null;
    let deaf: string | undefined;
    let stops = 0;
    let mic: NodeJS.Timeout | null = null;
    const quiet = () => { if (mic) clearInterval(mic); mic = null; };
    ws.on("message", async (raw, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(raw.toString());
      if (msg.type === "speak") {
        const played = [];
        for (const line of msg.lines) {
          fetched.push((await fetch(`http://${host}/demo/audio/${line.id}`)).status);
          if (opts.duringLines) ws.send(sound(clock, 1100));
          played.push({ lineId: line.id, startedMs: clock, endedMs: (clock += 1000), completed: true });
        }
        ws.send(JSON.stringify({ type: "played", played }));
      } else if (msg.type === "listen") {
        if (opts.hangUpAfter !== undefined && heard.length >= opts.hangUpAfter) return ws.send(JSON.stringify({ type: "hangup" }));
        const typed = opts.type?.[String(fetched.length)];
        if (typed) return ws.send(JSON.stringify({ type: "turn", kind: "speech", text: typed, startedMs: clock, endedMs: clock }));
        quiet();
        mic = setInterval(() => ws.send(sound((clock += 100), 100)), 2);
      } else if (msg.type === "heard" && msg.final) {
        quiet();
        heard.push(msg.text);
      } else if (msg.type === "stop") stops += 1;
      else if (msg.type === "deaf") {
        quiet();
        deaf = msg.reason;
        ws.send(JSON.stringify({ type: "hangup" }));
      } else if (msg.type === "ended") ended = msg;
    });
    ws.on("close", () => (quiet(), resolve({ ended, heard, fetched, stops, ...(deaf ? { deaf } : {}) })));
    ws.on("error", reject);
  });
}

describe("the demo with the server's own voice and hearing", () => {
  const SAID = ["yes", "Yes", "about once a month", "Somewhat agree", "the third one", "Strongly agree", "eight", "12", "no"];

  it("says what it offers, and serves a recording for each line of the script and for nothing else", async () => {
    const host = await start({ demoVoice: humVoice(200), demoStt: { id: "stand-in/scripted", open: scriptedStt([]) } });
    expect(await (await fetch(`http://${host}/demo/info`)).json()).toMatchObject({ voice: "hum/200cps/page", hearing: "stand-in/scripted", bargeIn: false });
    const res = await fetch(`http://${host}/demo/audio/p.consent_ask`);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(Buffer.from(await res.arrayBuffer()).toString("ascii", 0, 4)).toBe("RIFF");
    expect((await fetch(`http://${host}/demo/audio/${encodeURIComponent("Say anything I like")}`)).status).toBe(404);
    const plain = await start();
    expect(await (await fetch(`http://${plain}/demo/info`)).json()).toMatchObject({ voice: null, hearing: null });
    expect((await fetch(`http://${plain}/demo/audio/p.consent_ask`)).status).toBe(404);
  });

  it("a failing voice vendor is an error for that line, not a crash", async () => {
    const host = await start({ demoVoice: { id: "down/page", synthesize: async () => { throw new Error("vendor down"); } } });
    expect((await fetch(`http://${host}/demo/audio/p.intro`)).status).toBe(502);
    expect(await (await fetch(`http://${host}/health`)).json()).toMatchObject({ ok: true });
  });

  it("runs a whole interview from microphone sound: the server hears each reply and takes the turn", async () => {
    const host = await start({ demoVoice: humVoice(200), demoStt: { id: "stand-in/scripted", open: scriptedStt(SAID, 300) } });
    const { ended, heard, fetched, stops } = await speaker(host);
    expect(heard).toEqual(SAID);
    expect(fetched.every((s) => s === 200)).toBe(true);
    expect(stops).toBe(0);
    expect(ended).toMatchObject({ outcome: "complete", answered: 8, review: [] });
    expect(ended.trail.map((t: any) => t.readAs)).toEqual(["Yes", "About once a month", "Somewhat agree", "Neither agree nor disagree", "Strongly agree", "8", "12", "No"]);
    // Reply times are on the page's clock: each reply began after its question ended.
    expect(Object.values(ended.latencyMs as Record<string, number>).every((ms) => ms >= 0 && ms < 2000)).toBe(true);
    expect(Object.keys(ended.latencyMs)).toHaveLength(8);
  });

  it("without cutting in, sound sent while a line plays is never taken as the answer", async () => {
    const host = await start({ demoStt: { id: "stand-in/scripted", open: scriptedStt(["no", "no", "no", "no", "no", "yes"], 300) } });
    // "no" is "heard" during each of the five opening lines; were any kept, consent would be refused.
    const { ended, heard, stops } = await speaker(host, { duringLines: true, hangUpAfter: 1 });
    expect(stops).toBe(0);
    expect(heard).toEqual(["yes"]);
    expect(ended).toMatchObject({ outcome: "breakoff", answered: 0 });
  });

  it("with cutting in allowed, words heard while a line plays stop it and count as the reply", async () => {
    const host = await start({ demoStt: { id: "stand-in/scripted", open: scriptedStt(["no"], 300) }, demoBargeIn: true });
    const { ended, heard, stops } = await speaker(host, { duringLines: true });
    expect(stops).toBeGreaterThan(0);
    expect(heard).toEqual(["no"]);
    expect(ended).toMatchObject({ outcome: "consent_declined", answered: 0 });
  });

  it("a typed reply still works beside the microphone, and replaces anything half heard", async () => {
    const host = await start({ demoStt: { id: "stand-in/scripted", open: scriptedStt(SAID.slice(1), 300) } });
    // The first reply (to the five opening lines) is typed; the rest are spoken.
    const { ended, heard } = await speaker(host, { type: { "5": "yes" } });
    expect(heard).toEqual(SAID.slice(1));
    expect(ended).toMatchObject({ outcome: "complete", answered: 8 });
  });

  it("a recogniser that fails tells the page, which can carry on by typing", async () => {
    class Broken extends EventEmitter<SttEventMap> implements SttStream {
      write(): void { queueMicrotask(() => this.emit("error", new Error("recogniser unreachable"))); }
      close(): void {}
    }
    const host = await start({ demoStt: { id: "broken", open: () => new Broken() } });
    const { deaf, ended } = await speaker(host);
    expect(deaf).toBe("recogniser unreachable");
    expect(ended).toMatchObject({ outcome: "consent_declined" });
  });

  it("ignores malformed sound and stops listening past the allowance", async () => {
    const sent: any[] = [];
    const handlers: Record<string, (...a: any[]) => void> = {};
    const socket: Socket = { send: (d) => void sent.push(JSON.parse(d)), close: () => {}, on: (e: string, cb: any) => void (handlers[e] = cb) };
    let written = 0;
    const channel = new BrowserChannel(socket, { stt: () => Object.assign(new EventEmitter<SttEventMap>(), { write: (b: Buffer) => void (written += b.length), close: () => {} }) as SttStream, maxAudioMs: 250 });
    handlers.message!(Buffer.from([1, 2, 3]), true); // too short
    handlers.message!(Buffer.alloc(4 + 3), true); // half a sample
    expect(written).toBe(0);
    for (let i = 0; i < 5; i++) handlers.message!(sound(i * 100, 100), true);
    expect(written).toBe(3 * 3200);
    expect(sent.at(-1)).toMatchObject({ type: "deaf" });
    expect(channel.hears).toBe(false);
  });
});
