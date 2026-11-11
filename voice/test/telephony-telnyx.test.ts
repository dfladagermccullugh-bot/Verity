// Origin: phone_map `test/telnyx.test.ts`. The pattern is kept (stubbed Telnyx REST API, a real
// local WebSocket to the app, signed webhooks); the scripted phone menu is replaced by checks on
// two-way audio, marks, key presses and answering-machine detection.

import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { MULAW_SILENCE, encodeMulaw } from "../src/telephony/audio.js";
import type { SttEventMap, SttOptions, SttStream } from "../src/telephony/stt.js";
import { registerTelnyxRoutes } from "../src/telephony/telnyx-routes.js";
import { TelnyxProvider, verifyTelnyxSignature, type TelnyxCallSession, type TelnyxConfig } from "../src/telephony/telnyx.js";
import type { StartCallOptions, TranscriptEvent } from "../src/telephony/types.js";

// A real Ed25519 key pair standing in for Telnyx's signing key.
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const SPKI = publicKey.export({ format: "der", type: "spki" }) as Buffer;
const PUBLIC_B64 = SPKI.subarray(12).toString("base64");

function sign(signed: string, ts = Math.floor(Date.now() / 1000)) {
  const sig = crypto.sign(null, Buffer.from(`${ts}|${signed}`), privateKey).toString("base64");
  return { "telnyx-timestamp": String(ts), "telnyx-signature-ed25519": sig };
}

function tone(ms: number, freq = 440): Buffer {
  const n = Math.round((ms / 1000) * 8000);
  return encodeMulaw(Array.from({ length: n }, (_, i) => 6000 * Math.sin((2 * Math.PI * freq * i) / 8000)));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400 && !cond(); i++) await sleep(5);
  if (!cond()) throw new Error(`Timed out waiting for ${what}`);
}

describe("Telnyx signatures", () => {
  it("accepts genuine and rejects tampered, stale, or unsigned payloads", () => {
    const body = JSON.stringify({ data: { event_type: "call.answered" } });
    const h = sign(body);
    expect(verifyTelnyxSignature(PUBLIC_B64, body, h["telnyx-timestamp"], h["telnyx-signature-ed25519"])).toBe(true);
    expect(verifyTelnyxSignature(PUBLIC_B64, body.replace("answered", "hangup"), h["telnyx-timestamp"], h["telnyx-signature-ed25519"])).toBe(false);
    const old = sign(body, Math.floor(Date.now() / 1000) - 3600);
    expect(verifyTelnyxSignature(PUBLIC_B64, body, old["telnyx-timestamp"], old["telnyx-signature-ed25519"])).toBe(false);
    expect(verifyTelnyxSignature(PUBLIC_B64, body, undefined, undefined)).toBe(false);
    expect(verifyTelnyxSignature(PUBLIC_B64, body, h["telnyx-timestamp"], "not a signature")).toBe(false);
    expect(verifyTelnyxSignature("", body, h["telnyx-timestamp"], h["telnyx-signature-ed25519"])).toBe(false);
  });

  it("takes the public key raw or DER-wrapped, and rejects a signature made with another key", () => {
    const body = "{}";
    const h = sign(body);
    expect(verifyTelnyxSignature(SPKI.toString("base64"), body, h["telnyx-timestamp"], h["telnyx-signature-ed25519"])).toBe(true);
    const other = crypto.generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }) as Buffer;
    expect(verifyTelnyxSignature(other.subarray(12).toString("base64"), body, h["telnyx-timestamp"], h["telnyx-signature-ed25519"])).toBe(false);
  });
});

/** A listener the test scripts: it records the audio it is given and says what the test tells it to. */
class ScriptedStt extends EventEmitter<SttEventMap> implements SttStream {
  readonly written: Buffer[] = [];
  closed = false;
  constructor(readonly opts: SttOptions) {
    super();
  }
  write(audio: Buffer): void {
    this.written.push(audio);
  }
  close(): void {
    this.closed = true;
  }
}

/** One call as the stand-in carrier sees it. */
interface Leg {
  id: string;
  dial: Record<string, unknown>;
  ws: WebSocket | null;
  /** Audio frames we sent to the carrier, decoded. */
  frames: Buffer[];
  /** Mark names we sent, as they went over the wire. */
  marks: string[];
  clears: number;
  actions: { action: string; body: Record<string, unknown> }[];
  /** Real time at which the audio the carrier holds will have played out. */
  queueEnd: number;
  pendingMarks: { name: string; timer: NodeJS.Timeout }[];
}

/**
 * Drives the real Telnyx code path against a stand-in carrier: Call Control dial and commands
 * (stubbed fetch), signed webhooks, and the media-stream WebSocket, which here behaves as
 * Telnyx's media-streaming page describes: queued audio plays at real speed, a mark comes back
 * when the audio before it has played, and `clear` drops the queue and returns its marks at once.
 */
describe("Telnyx calls", () => {
  const TARGET = "+12025550143";
  const BASE: Omit<TelnyxConfig, "stt" | "log"> = {
    apiKey: "KEY123",
    connectionId: "conn-1",
    fromNumber: "+12025550100",
    publicBaseUrl: "https://voice.test",
    publicKey: PUBLIC_B64,
    allowedCountries: ["US"],
  };
  const realFetch = globalThis.fetch;
  let app: FastifyInstance;
  let port: number;
  let provider: TelnyxProvider;
  const legs: Leg[] = [];
  const sessions: TelnyxCallSession[] = [];
  const listeners: ScriptedStt[] = [];
  const logged: string[] = [];
  let telnyxRequests = 0;
  let failNextDial = false;

  function post(body: string, headers: Record<string, string>) {
    return realFetch(`http://127.0.0.1:${port}/telnyx/webhook`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body });
  }

  async function webhook(eventType: string, leg: Leg, extra: Record<string, unknown> = {}): Promise<number> {
    const body = JSON.stringify({ data: { event_type: eventType, payload: { call_control_id: leg.id, client_state: leg.dial.client_state, ...extra } } });
    return (await post(body, sign(body))).status;
  }

  function toCarrier(leg: Leg, raw: string): void {
    const msg = JSON.parse(raw) as { event: string; media?: { payload: string }; mark?: { name: string } };
    const now = Date.now();
    const echo = (name: string) => leg.ws?.send(JSON.stringify({ event: "mark", stream_id: "s1", sequence_number: "9", mark: { name } }));
    if (msg.event === "media") {
      leg.frames.push(Buffer.from(msg.media!.payload, "base64"));
      leg.queueEnd = Math.max(now, leg.queueEnd) + 20;
    } else if (msg.event === "mark") {
      const name = msg.mark!.name;
      leg.marks.push(name);
      const timer = setTimeout(() => {
        leg.pendingMarks = leg.pendingMarks.filter((m) => m.name !== name);
        echo(name);
      }, Math.max(0, leg.queueEnd - now));
      leg.pendingMarks.push({ name, timer });
    } else if (msg.event === "clear") {
      leg.clears++;
      leg.queueEnd = 0;
      for (const m of leg.pendingMarks) {
        clearTimeout(m.timer);
        echo(m.name);
      }
      leg.pendingMarks = [];
    }
  }

  /** Open the media stream as Telnyx would: signed, then `connected` and `start`. */
  async function connect(leg: Leg, headers: Record<string, string> = sign(String(leg.dial.stream_url))): Promise<WebSocket> {
    const ws = new WebSocket(String(leg.dial.stream_url).replace("wss://voice.test", `ws://127.0.0.1:${port}`), { headers });
    leg.ws = ws;
    ws.on("message", (data) => toCarrier(leg, data.toString()));
    ws.on("error", () => undefined);
    await new Promise((r) => ws.once("open", r));
    ws.send(JSON.stringify({ event: "connected", version: "1.0.0" }));
    ws.send(JSON.stringify({ event: "start", sequence_number: "1", stream_id: "s1", start: { call_control_id: leg.id, media_format: { encoding: "PCMU", sample_rate: 8000, channels: 1 } } }));
    return ws;
  }

  function inbound(leg: Leg, payload: Buffer, track = "inbound"): void {
    leg.ws!.send(JSON.stringify({ event: "media", stream_id: "s1", media: { track, chunk: "1", timestamp: "1", payload: payload.toString("base64") } }));
  }

  async function dial(opts: Partial<StartCallOptions> = {}): Promise<{ session: TelnyxCallSession; leg: Leg }> {
    const session = (await provider.startCall(TARGET, { maxDurationSeconds: 120, ...opts })) as TelnyxCallSession;
    sessions.push(session);
    return { session, leg: legs[legs.length - 1]! };
  }

  /** A call that has been picked up and whose stream is open. */
  async function answeredCall(opts: Partial<StartCallOptions> = {}) {
    const { session, leg } = await dial(opts);
    await connect(leg);
    expect(await webhook("call.answered", leg)).toBe(200);
    expect(session.answered).toBe(true);
    return { session, leg, stt: listeners[listeners.length - 1]! };
  }

  beforeAll(async () => {
    provider = new TelnyxProvider({
      ...BASE,
      stt: (opts) => {
        const s = new ScriptedStt(opts);
        listeners.push(s);
        return s;
      },
      log: (m) => logged.push(m),
    });
    app = Fastify({ logger: false });
    await registerTelnyxRoutes(app, provider);
    await app.listen({ port: 0, host: "127.0.0.1" });
    port = (app.server.address() as { port: number }).port;

    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith("https://api.telnyx.com/")) return realFetch(input, init);
      telnyxRequests++;
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer KEY123");
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      if (url === "https://api.telnyx.com/v2/calls") {
        if (failNextDial) {
          failNextDial = false;
          return new Response(JSON.stringify({ errors: [{ title: "Unverified account" }] }), { status: 403 });
        }
        const leg: Leg = { id: `v3:call-${legs.length + 1}`, dial: body, ws: null, frames: [], marks: [], clears: 0, actions: [], queueEnd: 0, pendingMarks: [] };
        legs.push(leg);
        return new Response(JSON.stringify({ data: { call_control_id: leg.id, call_leg_id: "leg", call_session_id: "sess", is_alive: false } }), { status: 200 });
      }
      const m = /\/v2\/calls\/([^/]+)\/actions\/(\w+)$/.exec(url);
      const leg = m && legs.find((l) => l.id === decodeURIComponent(m[1]!));
      if (!m || !leg) return new Response("{}", { status: 404 });
      leg.actions.push({ action: m[2]!, body });
      if (m[2] === "hangup") {
        setTimeout(() => {
          void webhook("call.hangup", leg, { hangup_cause: "normal_clearing", hangup_source: "caller" }).catch(() => undefined);
          leg.ws?.close();
        }, 20);
      }
      return new Response(JSON.stringify({ data: { result: "ok" } }), { status: 200 });
    });
  });

  afterEach(async () => {
    for (const s of sessions.splice(0)) await s.hangup();
    for (const leg of legs) {
      for (const m of leg.pendingMarks) clearTimeout(m.timer);
      leg.ws?.close();
    }
    expect(logged).toEqual([]);
  });

  afterAll(async () => {
    await sleep(50); // let the stand-in carrier's last hangup webhooks land
    vi.unstubAllGlobals();
    await app?.close();
  });

  // ── dialling ───────────────────────────────────────────────────────────────

  it("dials with a two-way PCMU stream, our webhook address and a per-call stream address", async () => {
    const { session, leg } = await dial();
    expect(leg.dial).toMatchObject({
      connection_id: "conn-1",
      to: TARGET,
      from: "+12025550100",
      webhook_url: "https://voice.test/telnyx/webhook",
      stream_track: "inbound_track",
      stream_bidirectional_mode: "rtp",
      stream_bidirectional_codec: "PCMU",
      time_limit_secs: 120,
    });
    expect(leg.dial.stream_url).toBe(`wss://voice.test/telnyx/media/${session.token}`);
    expect(session.token).toMatch(/^[0-9a-f]{48}$/);
    expect(Buffer.from(String(leg.dial.client_state), "base64").toString()).toBe(session.token);
    expect(leg.dial).not.toHaveProperty("answering_machine_detection");
    expect(session.providerCallId).toBe(leg.id);
    expect(session.provider).toBe("telnyx");
    expect(session.answered).toBe(false);
  });

  it("gives every call its own stream token", async () => {
    const a = await dial();
    const b = await dial();
    expect(a.session.token).not.toBe(b.session.token);
  });

  it("refuses numbers that must never be dialled, before any request to the carrier", async () => {
    const before = telnyxRequests;
    await expect(provider.startCall("+19005551234", { maxDurationSeconds: 60 })).rejects.toThrow(/Refusing to dial: Premium-rate/);
    await expect(provider.startCall("911", { maxDurationSeconds: 60 })).rejects.toThrow(/Refusing to dial: Emergency/);
    await expect(provider.startCall("+442079460958", { maxDurationSeconds: 60 })).rejects.toThrow(/Refusing to dial: Calling numbers in GB/);
    expect(telnyxRequests).toBe(before);
  });

  it("reports a dial the carrier rejects and keeps no session for it", async () => {
    failNextDial = true;
    const before = legs.length;
    await expect(provider.startCall(TARGET, { maxDurationSeconds: 60 })).rejects.toThrow(/Telnyx call failed \(403\)/);
    expect(legs.length).toBe(before);
  });

  it("will not start without its configuration or on a non-public address", () => {
    const stt = () => new ScriptedStt({ encoding: "mulaw", sampleRate: 8000 });
    expect(() => new TelnyxProvider({ ...BASE, stt, publicBaseUrl: "http://localhost:3000" })).toThrow(/https/);
    expect(() => new TelnyxProvider({ ...BASE, stt, publicKey: "" })).toThrow(/publicKey/);
    expect(() => new TelnyxProvider({ ...BASE, stt, apiKey: "" })).toThrow(/apiKey/);
  });

  // ── signatures ─────────────────────────────────────────────────────────────

  it("rejects unsigned, tampered and stale webhooks, and they change nothing", async () => {
    const { session, leg } = await dial();
    await connect(leg);
    const body = JSON.stringify({ data: { event_type: "call.answered", payload: { call_control_id: leg.id, client_state: leg.dial.client_state } } });

    expect((await post(body, {})).status).toBe(403);
    expect((await post(body, sign(body.replace("answered", "initiated")))).status).toBe(403);
    expect((await post(body, sign(body, Math.floor(Date.now() / 1000) - 3600))).status).toBe(403);
    expect((await post(body, { ...sign(body), "telnyx-signature-ed25519": "AAAA" })).status).toBe(403);
    expect(session.answered).toBe(false);

    expect((await post(body, sign(body))).status).toBe(200);
    expect(session.answered).toBe(true);
  });

  it("answers 400 to a signed-looking webhook that is not JSON, and 200 to events for calls it does not know", async () => {
    expect((await post("{not json", sign("{not json"))).status).toBe(400);
    const stray = JSON.stringify({ data: { event_type: "call.hangup", payload: { call_control_id: "v3:someone-else" } } });
    expect((await post(stray, sign(stray))).status).toBe(200);
  });

  it("closes a media connection that is unsigned, wrongly signed, or for an unknown call", async () => {
    const { session, leg } = await dial();
    const closed = (ws: WebSocket) => new Promise<number>((r) => ws.once("close", (code) => r(code)));

    expect(await closed(await connect(leg, {}))).toBe(1008);
    // Signed, but for a different stream address.
    expect(await closed(await connect(leg, sign("wss://voice.test/telnyx/media/another-call")))).toBe(1008);
    const unknown = new WebSocket(`ws://127.0.0.1:${port}/telnyx/media/${"0".repeat(48)}`, { headers: sign(`wss://voice.test/telnyx/media/${"0".repeat(48)}`) });
    expect(await closed(unknown)).toBe(1008);

    // None of them was attached: the call still plays nothing and hears nothing.
    expect(await webhook("call.answered", leg)).toBe(200);
    void session.play(tone(100), "p.intro");
    await sleep(60);
    expect(leg.frames).toEqual([]);
  });

  // ── speaking ───────────────────────────────────────────────────────────────

  it("plays audio as 20 ms frames followed by a mark, and completes when the carrier returns the mark", async () => {
    const { session, leg } = await answeredCall();
    const marks: string[] = [];
    session.on("mark", (name) => marks.push(name));
    const audio = tone(250); // 2000 bytes: twelve full frames and half a frame
    const started = Date.now();

    const result = await session.play(audio, "q.Q1.ask");

    expect(result).toEqual({ completed: true });
    expect(marks).toEqual(["q.Q1.ask"]);
    expect(leg.frames).toHaveLength(13);
    expect(leg.frames.every((f) => f.length === 160)).toBe(true);
    const sent = Buffer.concat(leg.frames);
    expect(sent.subarray(0, audio.length).equals(audio)).toBe(true);
    expect([...sent.subarray(audio.length)].every((b) => b === MULAW_SILENCE)).toBe(true);
    // One mark, sent after the audio, and not resolved before the audio had time to play.
    expect(leg.marks).toHaveLength(1);
    expect(leg.marks[0]).toMatch(/:q\.Q1\.ask$/);
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
    expect(leg.clears).toBe(0);
  });

  it("plays queued clips in order, each with its own mark", async () => {
    const { session, leg } = await answeredCall();
    const marks: string[] = [];
    session.on("mark", (name) => marks.push(name));
    const a = tone(60, 440);
    const b = tone(60, 880);

    const results = await Promise.all([session.play(a, "p.intro"), session.play(b, "p.purpose"), session.play(Buffer.alloc(0), "empty")]);

    expect(results).toEqual([{ completed: true }, { completed: true }, { completed: true }]);
    expect(marks).toEqual(["p.intro", "p.purpose", "empty"]);
    expect(Buffer.concat(leg.frames).equals(Buffer.concat([a, b]))).toBe(true);
    expect(leg.marks).toHaveLength(3);
  });

  it("holds audio queued before the call is answered, then plays it", async () => {
    const { session, leg } = await dial();
    let done = false;
    const pending = session.play(tone(60), "p.intro").then((r) => {
      done = true;
      return r;
    });
    await connect(leg);
    await sleep(60);
    // The stream is up but nobody has picked up: nothing is sent into the ringing.
    expect(leg.frames).toEqual([]);
    expect(done).toBe(false);

    expect(await webhook("call.answered", leg)).toBe(200);
    expect(await pending).toEqual({ completed: true });
    expect(leg.frames).toHaveLength(3);
  });

  it("holds audio until the stream is up when the answer webhook arrives first", async () => {
    const { session, leg } = await dial();
    expect(await webhook("call.answered", leg)).toBe(200);
    const pending = session.play(tone(60), "p.intro");
    await sleep(40);
    await connect(leg);
    expect(await pending).toEqual({ completed: true });
    expect(leg.frames).toHaveLength(3);
  });

  it("sends audio at playback speed with a short lead, not in one burst", async () => {
    const { session, leg } = await answeredCall();
    void session.play(tone(5000), "q.Q1.ask");
    await sleep(200);
    // 5 s is 250 frames. After 0.2 s: the 0.3 s lead plus 0.2 s of playback, about 25.
    expect(leg.frames.length).toBeGreaterThanOrEqual(15);
    expect(leg.frames.length).toBeLessThan(60);
    expect(leg.marks).toEqual([]);
  });

  it("clearPlayback sends clear, and every pending play resolves as not completed", async () => {
    const { session, leg } = await answeredCall();
    const marks: string[] = [];
    session.on("mark", (name) => marks.push(name));
    const cut = session.play(tone(200), "q.Q1.ask"); // fully sent, mark queued at the carrier
    const queued = session.play(tone(5000), "q.Q1.options"); // partly sent
    const waiting = session.play(tone(100), "q.Q1.row.1"); // not sent at all
    await until(() => leg.marks.length === 1 && leg.frames.length > 10, "the first clip and some of the second to be sent");

    await session.clearPlayback();

    expect(await Promise.all([cut, queued, waiting])).toEqual([{ completed: false }, { completed: false }, { completed: false }]);
    await until(() => leg.clears === 1, "the clear to reach the carrier");
    const sentAtClear = leg.frames.length;
    expect(sentAtClear).toBeLessThan(100);
    await sleep(80);
    // Nothing more is sent, and the mark Telnyx returns for the dropped audio is not taken for playback.
    expect(leg.frames.length).toBe(sentAtClear);
    expect(leg.marks).toHaveLength(1);
    expect(marks).toEqual([]);
  });

  it("is not fooled by a returned mark when the same line is played again after a clear", async () => {
    const { session, leg } = await answeredCall();
    const marks: string[] = [];
    session.on("mark", (name) => marks.push(name));
    const first = session.play(tone(300), "q.Q1.ask");
    await until(() => leg.marks.length === 1, "the first clip to be sent");

    // Interrupted, then the question is repeated at once: the carrier now returns the old mark.
    await session.clearPlayback();
    const started = Date.now();
    const again = session.play(tone(300), "q.Q1.ask");

    expect(await first).toEqual({ completed: false });
    expect(await again).toEqual({ completed: true });
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(marks).toEqual(["q.Q1.ask"]);
    expect(leg.marks).toHaveLength(2);
    expect(leg.marks[0]).not.toBe(leg.marks[1]);
  });

  it("clearing with nothing playing sends nothing", async () => {
    const { session, leg } = await answeredCall();
    expect(await session.play(tone(40), "p.begin")).toEqual({ completed: true });
    await session.clearPlayback();
    await sleep(30);
    expect(leg.clears).toBe(0);
  });

  // ── listening ──────────────────────────────────────────────────────────────

  it("emits the keys the respondent presses", async () => {
    const { session, leg } = await answeredCall();
    const keys: [string, number][] = [];
    session.on("dtmf", (digit, atMs) => keys.push([digit, atMs]));
    await sleep(20);
    for (const digit of ["4", "#"]) {
      leg.ws!.send(JSON.stringify({ event: "dtmf", stream_id: "s1", occurred_at: new Date().toISOString(), sequence_number: "5", dtmf: { digit } }));
    }
    await until(() => keys.length === 2, "the key presses");
    expect(keys.map((k) => k[0])).toEqual(["4", "#"]);
    // Call-time ms: after answer, and nowhere near a wall-clock timestamp.
    expect(keys[0]![1]).toBeGreaterThan(0);
    expect(keys[0]![1]).toBeLessThan(5000);
  });

  it("opens the injected listener at answer and feeds it only the respondent's audio after answer", async () => {
    const { session, leg } = await dial();
    const before = listeners.length;
    await connect(leg);
    inbound(leg, Buffer.alloc(160, 0x11)); // ringing: before answer
    await sleep(30);
    expect(listeners.length).toBe(before);

    expect(await webhook("call.answered", leg)).toBe(200);
    expect(listeners.length).toBe(before + 1);
    const stt = listeners[before]!;
    expect(stt.opts).toEqual({ encoding: "mulaw", sampleRate: 8000 });

    inbound(leg, Buffer.alloc(160, 0x22));
    inbound(leg, Buffer.alloc(160, 0x33), "outbound"); // our own speech, if the carrier ever echoes it
    inbound(leg, Buffer.alloc(160, 0x44));
    await until(() => stt.written.length === 2, "the respondent's audio to reach the listener");
    expect(Buffer.concat(stt.written).equals(Buffer.concat([Buffer.alloc(160, 0x22), Buffer.alloc(160, 0x44)]))).toBe(true);

    // A redelivered answer webhook does not open a second listener.
    expect(await webhook("call.answered", leg)).toBe(200);
    expect(listeners.length).toBe(before + 1);
    expect(session.answered).toBe(true);
  });

  it("passes on what the listener hears: transcripts, speech start and utterance end", async () => {
    const { session, stt } = await answeredCall();
    const seen: unknown[] = [];
    session.on("speechStart", (ms) => seen.push(["speechStart", ms]));
    session.on("transcript", (e: TranscriptEvent) => seen.push(["transcript", e.text, e.isFinal]));
    session.on("utteranceEnd", (ms) => seen.push(["utteranceEnd", ms]));

    stt.emit("speechStart", 1200);
    stt.emit("transcript", { text: "yes", isFinal: false, startMs: 1200, endMs: 1500 });
    stt.emit("transcript", { text: "yes I do", isFinal: true, startMs: 1200, endMs: 2100 });
    stt.emit("utteranceEnd", 2100);

    expect(seen).toEqual([["speechStart", 1200], ["transcript", "yes", false], ["transcript", "yes I do", true], ["utteranceEnd", 2100]]);
  });

  it("classifies the respondent's audio", async () => {
    const { session, leg } = await answeredCall();
    const states: string[] = [];
    session.on("audio", (state) => states.push(state));
    const speech = tone(100, 300);
    for (let i = 0; i < speech.length; i += 160) inbound(leg, speech.subarray(i, i + 160));
    await until(() => states.includes("speech"), "speech to be detected");
  });

  it("logs a listener failure and a stream error without ending the call", async () => {
    const { session, leg, stt } = await answeredCall();
    stt.emit("error", new Error("socket hang up"));
    leg.ws!.send(JSON.stringify({ event: "error", stream_id: "s1", payload: { code: 100005, title: "rate_limit_reached", detail: "Too many requests" } }));
    leg.ws!.send("not json");
    await until(() => logged.length === 2, "both problems to be logged");
    expect(logged[0]).toMatch(/listener error: socket hang up/);
    expect(logged[1]).toMatch(/Telnyx stream error 100005 rate_limit_reached: Too many requests/);
    expect(session.ended).toBe(false);
    logged.length = 0;
  });

  // ── answering machines ─────────────────────────────────────────────────────

  it("asks for answering-machine detection only when told to, and reports the verdict once", async () => {
    const { session, leg } = await answeredCall({ amd: true });
    expect(leg.dial.answering_machine_detection).toBe("detect");
    const verdicts: string[] = [];
    session.on("machine", (r) => verdicts.push(r));

    expect(await webhook("call.machine.detection.ended", leg, { result: "machine" })).toBe(200);
    expect(await webhook("call.machine.detection.ended", leg, { result: "machine" })).toBe(200); // redelivered
    expect(verdicts).toEqual(["machine"]);
  });

  it("maps the carrier's verdicts to human, machine or unknown", async () => {
    for (const [result, expected] of [["human", "human"], ["not_sure", "unknown"], [undefined, "unknown"]] as const) {
      const { session, leg } = await answeredCall({ amd: true });
      const verdicts: string[] = [];
      session.on("machine", (r) => verdicts.push(r));
      await webhook("call.machine.detection.ended", leg, result ? { result } : {});
      expect(verdicts).toEqual([expected]);
    }
  });

  // ── ending and keys ────────────────────────────────────────────────────────

  it("hangs up through Call Control, ends once, and settles everything it was doing", async () => {
    const { session, leg, stt } = await answeredCall();
    const reasons: string[] = [];
    session.on("ended", (r) => reasons.push(r));
    const pending = session.play(tone(5000), "q.Q1.ask");
    const streamClosed = new Promise((r) => leg.ws!.once("close", r));

    await session.hangup();

    expect(await pending).toEqual({ completed: false });
    expect(session.ended).toBe(true);
    expect(session.endReason).toBe("agent-hangup");
    expect(leg.actions).toEqual([{ action: "hangup", body: {} }]);
    expect(stt.closed).toBe(true);
    await streamClosed;
    expect(provider.get(session.token)).toBeUndefined();
    expect(await session.play(tone(20), "late")).toEqual({ completed: false });
    await session.hangup();
    await sleep(60); // the carrier's own hangup webhook arrives and is not a second ending
    expect(reasons).toEqual(["agent-hangup"]);
    expect(leg.actions).toHaveLength(1);
  });

  it("ends the call when the respondent hangs up", async () => {
    const { session, leg, stt } = await answeredCall();
    const pending = session.play(tone(5000), "q.Q1.ask");
    expect(await webhook("call.hangup", leg, { hangup_cause: "normal_clearing" })).toBe(200);
    expect(session.endReason).toBe("remote-hangup");
    expect(await pending).toEqual({ completed: false });
    expect(stt.closed).toBe(true);
  });

  it("reports why an unanswered call ended", async () => {
    const { session, leg } = await dial();
    expect(await webhook("call.hangup", leg, { hangup_cause: "user_busy" })).toBe(200);
    expect(session.ended).toBe(true);
    expect(session.endReason).toBe("call-user_busy");
    expect(session.answered).toBe(false);
  });

  it("ends the call when the carrier stops the stream", async () => {
    const { session, leg } = await answeredCall();
    leg.ws!.send(JSON.stringify({ event: "stop", sequence_number: "7", stream_id: "s1", stop: { call_control_id: leg.id } }));
    await until(() => session.ended, "the call to end");
    expect(session.endReason).toBe("stream-stopped");
  });

  it("sends key presses out of band", async () => {
    const { session, leg } = await answeredCall();
    await session.sendDigits("1");
    expect(leg.actions).toEqual([{ action: "send_dtmf", body: { digits: "1", duration_millis: 250 } }]);
  });
});

describe("Telnyx routes on a host app", () => {
  it("coexist with the host's own websocket plugin and leave its JSON parsing alone", async () => {
    const provider = new TelnyxProvider({
      apiKey: "KEY123",
      connectionId: "conn-1",
      fromNumber: "+12025550100",
      publicBaseUrl: "https://voice.test",
      publicKey: PUBLIC_B64,
      allowedCountries: ["US"],
      stt: (opts) => new ScriptedStt(opts),
    });
    const app = Fastify({ logger: false });
    await app.register(fastifyWebsocket);
    app.post("/host", async (req) => ({ got: req.body, raw: "rawBody" in req }));
    await registerTelnyxRoutes(app, provider);

    const host = await app.inject({ method: "POST", url: "/host", payload: { a: 1 } });
    expect(host.json()).toEqual({ got: { a: 1 }, raw: false });

    const body = JSON.stringify({ data: { event_type: "call.initiated", payload: {} } });
    expect((await app.inject({ method: "POST", url: "/telnyx/webhook", headers: { "content-type": "application/json" }, payload: body })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/telnyx/webhook", headers: { "content-type": "application/json", ...sign(body) }, payload: body })).statusCode).toBe(200);
    await app.close();
  });
});
