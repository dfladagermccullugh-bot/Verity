import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { buildApp } from "../src/server/app.js";
import { BrowserChannel, type Socket } from "../src/server/browser-channel.js";
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
