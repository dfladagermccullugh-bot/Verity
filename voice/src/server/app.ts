/**
 * The web server: a health check, the browser demo (an interview by voice with no phone line),
 * and, when a carrier is configured, the endpoints the carrier calls.
 */

import { readFileSync } from "node:fs";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type { Instrument } from "../instrument/types.js";
import type { ModelClassifier } from "../interviewer/classify.js";
import { Interviewer } from "../interviewer/interviewer.js";
import { trail } from "../report/trail.js";
import { buildProtocol, buildSpeechTable, type CampaignWording } from "../interviewer/protocol.js";
import { buildScript } from "../script/script.js";
import { registerTelnyxRoutes } from "../telephony/telnyx-routes.js";
import type { TelnyxProvider } from "../telephony/telnyx.js";
import { RateLimiter, Semaphore } from "../util/infra.js";
import { runVoiceCall } from "../voice/call.js";
import { BrowserChannel, type Socket } from "./browser-channel.js";

export interface AppOptions {
  /** The survey the browser demo runs. */
  demoInstrument: Instrument;
  demoWording?: CampaignWording;
  /** Reads replies the rules cannot. Without it the demo understands exact answers only. */
  model?: ModelClassifier;
  telnyx?: TelnyxProvider;
  /** Demo interviews at once, and per visitor per hour. */
  maxDemoSessions?: number;
  demoPerHour?: number;
}

const PAGE = readFileSync(new URL("./demo.html", import.meta.url), "utf8");
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
  let active = 0;

  app.get("/health", async () => ({ ok: true, demoSessions: active, model: opts.model?.id ?? null, carrier: opts.telnyx ? "telnyx" : null }));
  app.get("/", async (_req, reply) => reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(PAGE));
  app.get("/assets/newsreader.woff2", async (_req, reply) => reply.type("font/woff2").header("Cache-Control", "public, max-age=604800").send(FONT));
  app.get("/demo/info", async () => ({ survey: opts.demoInstrument.name, script: table.hash.slice(0, 12), model: opts.model?.id ?? null }));

  app.get("/demo/ws", { websocket: true }, (socket, req) => {
    const ws = socket as unknown as Socket;
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
        const channel = new BrowserChannel(ws);
        await runVoiceCall(interviewer, channel, { replyWaitMs: 12_000, maxSilences: 3 });
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
  return app;
}
