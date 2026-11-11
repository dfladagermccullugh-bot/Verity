/**
 * The web server: a health check, the browser demo (an interview by voice with no phone line),
 * and, when a carrier is configured, the endpoints the carrier calls.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { Instrument } from "../instrument/types.js";
import type { ModelClassifier } from "../interviewer/classify.js";
import { Interviewer } from "../interviewer/interviewer.js";
import { trail } from "../report/trail.js";
import { buildProtocol, buildSpeechTable, type CampaignWording } from "../interviewer/protocol.js";
import { buildScript } from "../script/script.js";
import { registerTelnyxRoutes } from "../telephony/telnyx-routes.js";
import type { TelnyxProvider } from "../telephony/telnyx.js";
import { RateLimiter, Semaphore } from "../util/infra.js";
import type { SttFactory } from "../telephony/stt.js";
import { runVoiceCall } from "../voice/call.js";
import { SpeechStore, type TtsVoice } from "../voice/tts.js";
import { BrowserChannel, type Socket } from "./browser-channel.js";

export interface AppOptions {
  /** The survey the browser demo runs. */
  demoInstrument: Instrument;
  demoWording?: CampaignWording;
  /** Reads replies the rules cannot. Without it the demo understands exact answers only. */
  model?: ModelClassifier;
  /**
   * A voice for the demo page, made with `output: "page"`. With it the page plays these
   * recordings; without it the page uses the browser's built-in voice.
   */
  demoVoice?: TtsVoice;
  /** A recogniser for the page's microphone. Without it the page uses the browser's own. */
  demoStt?: { id: string; open: SttFactory };
  /** Let the visitor's words stop a line that is playing (see HearingOptions.bargeIn). */
  demoBargeIn?: boolean;
  /**
   * A passcode for the demo page. When set, the page, its recordings and its interviews are
   * closed to anyone who has not entered it. The carrier's endpoints and the health check stay
   * open: they are not part of the demo.
   */
  demoPasscode?: string;
  /** Render every demo line when the server starts, not on first request. */
  warmDemoVoice?: boolean;
  telnyx?: TelnyxProvider;
  /** Demo interviews at once, and per visitor per hour. */
  maxDemoSessions?: number;
  demoPerHour?: number;
}

const PAGE = readFileSync(new URL("./demo.html", import.meta.url), "utf8");

/** The page shown in place of the demo until the passcode has been entered. */
const gatePage = (wrong: boolean) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Verity Voice</title>
<style>
  :root { color-scheme: light dark; --paper: #faf6f1; --ink: #24211e; --soft: #6b645c; --rule: #ddd5ca; --warn: #8a4b00; }
  @media (prefers-color-scheme: dark) { :root { --paper: #181614; --ink: #ede8e0; --soft: #a79f94; --rule: #3a342e; --warn: #e6a955; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--paper); color: var(--ink); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width: min(100% - 40px, 22rem); }
  h1 { font: 400 1.7rem/1.1 Georgia, serif; margin: 0 0 .4em; }
  p { color: var(--soft); margin: 0 0 1.2em; }
  label { display: block; font-size: .85rem; margin-bottom: 6px; }
  input { width: 100%; box-sizing: border-box; font: inherit; color: inherit; padding: 12px 16px; border: 1px solid var(--rule); border-radius: 999px; background: transparent; }
  button { margin-top: 12px; width: 100%; font: inherit; font-weight: 500; padding: 12px 16px; border: 0; border-radius: 999px; background: var(--ink); color: var(--paper); cursor: pointer; }
  :focus-visible { outline: 2px solid #1f6f8b; outline-offset: 3px; }
  .wrong { color: var(--warn); font-weight: 600; }
</style></head>
<body><main>
  <h1>verity / voice</h1>
  <p>This demonstration is private. Enter the passcode you were given.</p>
  ${wrong ? '<p class="wrong" role="alert">That passcode is not right.</p>' : ""}
  <form method="post" action="/demo/enter">
    <label for="passcode">Passcode</label>
    <input id="passcode" name="passcode" type="password" autocomplete="off" required autofocus>
    <button type="submit">Continue</button>
  </form>
</main></body></html>`;
// The page's serif typeface (Newsreader, SIL Open Font License), served from here so the page asks no other site for anything.
const FONT = readFileSync(new URL("./assets/newsreader-latin.woff2", import.meta.url));

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true });
  await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });

  const wording: CampaignWording = opts.demoWording ?? { sponsor: "the Verity Voice demonstration", topic: "your local public library", minutes: 3, askRecording: false };
  const script = buildScript(opts.demoInstrument);
  const table = buildSpeechTable(script, buildProtocol(wording));
  const slots = new Semaphore(opts.maxDemoSessions ?? 20);
  const perVisitor = new RateLimiter(opts.demoPerHour ?? 12, 3_600_000);
  const speech = opts.demoVoice ? new SpeechStore(opts.demoVoice) : null;
  let active = 0;

  // The passcode gate. Entering the passcode sets a cookie that is a keyed hash of it, so nothing
  // is stored on the server and changing the passcode shuts everyone out again.
  const pass = opts.demoPasscode?.trim() ?? "";
  const ticket = pass === "" ? "" : createHmac("sha256", pass).update("verity-voice-demo").digest("hex");
  const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const allowed = (req: FastifyRequest): boolean => {
    if (ticket === "") return true;
    const cookie = (req.headers.cookie ?? "").split(";").map((c) => c.trim().split("=")).find(([k]) => k === "vv_demo")?.[1] ?? "";
    return same(cookie, ticket);
  };
  const tries = new RateLimiter(10, 10 * 60_000);
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 2048 }, (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))));
  app.post("/demo/enter", async (req, reply) => {
    const html = (code: number, wrong: boolean) => reply.code(code).type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(gatePage(wrong));
    if (ticket === "") return reply.redirect("/", 303);
    if (!tries.take(req.ip)) return reply.code(429).type("text/plain; charset=utf-8").send("Too many tries. Please wait ten minutes.");
    const given = String((req.body as Record<string, unknown> | null)?.passcode ?? "").trim();
    // Compare hashes, so the comparison takes the same time whatever was typed.
    if (!same(createHmac("sha256", given).update("verity-voice-demo").digest("hex"), ticket)) return html(401, true);
    return reply.header("Set-Cookie", `vv_demo=${ticket}; Path=/; Max-Age=${30 * 86_400}; HttpOnly; SameSite=Lax${req.protocol === "https" ? "; Secure" : ""}`).redirect("/", 303);
  });

  app.get("/health", async () => ({ ok: true, demoSessions: active, model: opts.model?.id ?? null, carrier: opts.telnyx ? "telnyx" : null }));
  app.get("/", async (req, reply) => reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(allowed(req) ? PAGE : gatePage(false)));
  app.get("/assets/newsreader.woff2", async (_req, reply) => reply.type("font/woff2").header("Cache-Control", "public, max-age=604800").send(FONT));
  app.get("/demo/info", async (req, reply) => {
    if (!allowed(req)) return reply.code(401).send({ error: "passcode needed" });
    return info;
  });
  const info = {
    survey: opts.demoInstrument.name,
    script: table.hash.slice(0, 12),
    model: opts.model?.id ?? null,
    voice: opts.demoVoice?.id ?? null,
    hearing: opts.demoStt?.id ?? null,
    bargeIn: Boolean(opts.demoStt && opts.demoBargeIn),
  };
  // The recording of one line of the script. Only the script's own lines can be asked for, so
  // this cannot be used to make the voice say anything else, and each line is rendered once.
  app.get<{ Params: { line: string } }>("/demo/audio/:line", async (req, reply) => {
    if (!allowed(req)) return reply.code(401).send({ error: "passcode needed" });
    const line = table.lines.get(req.params.line as Parameters<typeof table.lines.get>[0]);
    if (!speech || !line) return reply.code(404).send({ error: "no such recording" });
    try {
      const audio = await speech.get(line);
      return reply.type("audio/wav").header("Cache-Control", "private, max-age=3600").send(audio);
    } catch (err) {
      app.log.error(err);
      console.error(`Voice failed for line ${line.id}: ${err instanceof Error ? err.message : String(err)}`);
      return reply.code(502).send({ error: "the voice is not available" });
    }
  });

  app.get("/demo/ws", { websocket: true }, (socket, req) => {
    const ws = socket as unknown as Socket;
    if (!allowed(req)) {
      ws.send(JSON.stringify({ type: "refused", reason: "This demonstration needs its passcode. Reload the page and enter it." }));
      return ws.close();
    }
    if (!perVisitor.take(req.ip)) {
      ws.send(JSON.stringify({ type: "refused", reason: "Too many demo interviews from this address in the last hour. Please try again later." }));
      return ws.close();
    }
    void (async () => {
      await slots.acquire();
      active += 1;
      try {
        // Nothing from a demo interview is stored: the interviewer and its log live only for this connection.
        const init: ConstructorParameters<typeof Interviewer>[0] = { instrument: opts.demoInstrument, script, table };
        if (opts.model) init.model = opts.model;
        const interviewer = new Interviewer(init);
        const channel = new BrowserChannel(ws, opts.demoStt ? { stt: opts.demoStt.open, bargeIn: Boolean(opts.demoBargeIn) } : undefined);
        try {
          await runVoiceCall(interviewer, channel, { replyWaitMs: 12_000, maxSilences: 3 });
        } finally {
          channel.end();
        }
        const s = interviewer.state;
        channel.tell({ type: "ended", outcome: s.outcome, answered: Object.keys(s.interview.answers).length, review: s.review, latencyMs: s.latencyMs, trail: trail(opts.demoInstrument, interviewer.log) });
      } finally {
        active -= 1;
        slots.release();
        ws.close();
      }
    })();
  });

  if (opts.telnyx) await registerTelnyxRoutes(app, opts.telnyx);
  // Render the demo's lines in the background so the first visitor does not wait on the voice vendor.
  if (speech && opts.warmDemoVoice) void speech.prerender(table).then((r) => console.log(`Demo voice ready: ${r.lines} lines with ${opts.demoVoice!.id}.`), (err) => console.error(`Demo voice could not be prepared: ${err instanceof Error ? err.message : String(err)}`));
  return app;
}
