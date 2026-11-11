import type { IncomingMessage } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { deepgramStt, type SttStream } from "../src/telephony/stt.js";
import type { TranscriptEvent } from "../src/telephony/types.js";

/**
 * The Deepgram adapter against a local stand-in for Deepgram's listen endpoint: a real WebSocket
 * that records what the adapter sends and replies with the message shapes Deepgram documents.
 */
describe("Deepgram listener", () => {
  let server: WebSocketServer;
  let url: string;
  let request: IncomingMessage | null;
  let socket: WebSocket | null;
  const audio: Buffer[] = [];
  const control: string[] = [];
  let connected: Promise<void>;
  let stt: SttStream | null;

  beforeEach(async () => {
    audio.length = 0;
    control.length = 0;
    request = null;
    socket = null;
    stt = null;
    server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise((r) => server.once("listening", r));
    url = `ws://127.0.0.1:${(server.address() as { port: number }).port}/v1/listen`;
    connected = new Promise((resolve) => {
      server.on("connection", (ws, req) => {
        socket = ws;
        request = req;
        ws.on("message", (data, isBinary) => {
          if (isBinary) audio.push(data as Buffer);
          else control.push(data.toString());
        });
        resolve();
      });
    });
  });

  afterEach(async () => {
    stt?.close();
    for (const c of server.clients) c.terminate();
    await new Promise((r) => server.close(r));
  });

  function open(model?: string): SttStream {
    const cfg = model ? { apiKey: "test-key", url, model } : { apiKey: "test-key", url };
    stt = deepgramStt(cfg)({ encoding: "mulaw", sampleRate: 8000 });
    return stt;
  }

  const until = async (cond: () => boolean) => {
    for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
    expect(cond()).toBe(true);
  };

  it("asks for phone audio, nova-3 and speech events, and authenticates with the key", async () => {
    open();
    await connected;
    const q = new URL(request!.url!, "ws://x").searchParams;
    expect(new URL(request!.url!, "ws://x").pathname).toBe("/v1/listen");
    expect(Object.fromEntries(q)).toMatchObject({
      encoding: "mulaw",
      sample_rate: "8000",
      channels: "1",
      model: "nova-3",
      interim_results: "true",
      vad_events: "true",
      utterance_end_ms: "1200",
      endpointing: "400",
    });
    expect(request!.headers.authorization).toBe("Token test-key");
  });

  it("for a web page's microphone, asks for 16-bit sound and that the audio is not kept for training", async () => {
    stt = deepgramStt({ apiKey: "test-key", url, optOut: true })({ encoding: "linear16", sampleRate: 16000 });
    await connected;
    expect(Object.fromEntries(new URL(request!.url!, "ws://x").searchParams)).toMatchObject({ encoding: "linear16", sample_rate: "16000", mip_opt_out: "true" });
  });

  it("uses the model it is configured with", async () => {
    open("nova-2-phonecall");
    await connected;
    expect(new URL(request!.url!, "ws://x").searchParams.get("model")).toBe("nova-2-phonecall");
  });

  it("sends audio written before the connection opened, then live audio, in order", async () => {
    const s = open();
    s.write(Buffer.from([1, 1, 1]));
    s.write(Buffer.from([2, 2]));
    await connected;
    await until(() => audio.length === 2);
    s.write(Buffer.from([3]));
    await until(() => audio.length === 3);
    expect(Buffer.concat(audio)).toEqual(Buffer.from([1, 1, 1, 2, 2, 3]));
  });

  it("reports interim and final transcripts with word timings in ms", async () => {
    const s = open();
    const heard: TranscriptEvent[] = [];
    s.on("transcript", (e) => heard.push(e));
    await connected;
    const results = (transcript: string, is_final: boolean, words: { start: number; end: number }[], extra = {}) =>
      socket!.send(JSON.stringify({ type: "Results", is_final, start: 1, duration: 2, channel: { alternatives: [{ transcript, words }] }, ...extra }));
    results("yes", false, [{ start: 1.2, end: 1.5 }]);
    results("  yes I do ", true, [{ start: 1.2, end: 1.5 }, { start: 1.6, end: 1.7 }, { start: 1.75, end: 2.1 }]);
    results("", true, []);
    results("four", true, []);
    socket!.send("not json");
    socket!.send(JSON.stringify({ type: "Metadata" }));
    await until(() => heard.length === 3);

    expect(heard[0]).toEqual({ text: "yes", isFinal: false, startMs: 1200, endMs: 1500 });
    expect(heard[1]).toEqual({ text: "yes I do", isFinal: true, startMs: 1200, endMs: 2100 });
    // No word timings: fall back to the result's own start and duration.
    expect(heard[2]).toEqual({ text: "four", isFinal: true, startMs: 1000, endMs: 3000 });
  });

  it("reports when speech starts and when an utterance ends", async () => {
    const s = open();
    const events: string[] = [];
    s.on("speechStart", (ms) => events.push(`start ${ms}`));
    s.on("utteranceEnd", (ms) => events.push(`end ${ms}`));
    await connected;
    socket!.send(JSON.stringify({ type: "SpeechStarted", channel: [0, 1], timestamp: 9.54 }));
    // -1 means a final result already closed the utterance; Deepgram says to ignore it.
    socket!.send(JSON.stringify({ type: "UtteranceEnd", channel: [0, 1], last_word_end: -1 }));
    socket!.send(JSON.stringify({ type: "UtteranceEnd", channel: [0, 1], last_word_end: 2.395 }));
    await until(() => events.length === 2);
    expect(events).toEqual(["start 9540", "end 2395"]);
  });

  it("tells Deepgram to finish when closed, and stays quiet about its own close", async () => {
    const s = open();
    const errors: Error[] = [];
    s.on("error", (e) => errors.push(e));
    await connected;
    await until(() => socket!.readyState === socket!.OPEN);
    s.write(Buffer.from([9]));
    await until(() => audio.length === 1);
    s.close();
    stt = null;
    await until(() => control.includes(JSON.stringify({ type: "CloseStream" })));
    socket!.close();
    await new Promise((r) => setTimeout(r, 30));
    expect(errors).toEqual([]);
    // Audio written after close is dropped, not thrown on.
    s.write(Buffer.from([9]));
  });

  it("reports a stream that dies mid-call", async () => {
    const s = open();
    const errors: Error[] = [];
    s.on("error", (e) => errors.push(e));
    s.write(Buffer.from([1]));
    await connected;
    await until(() => audio.length === 1);
    socket!.terminate();
    await until(() => errors.length > 0);
    expect(errors[0]!.message).toMatch(/closed unexpectedly/);
    s.write(Buffer.from([2]));
  });
});
