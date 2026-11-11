/**
 * The web server: a health check, the browser demo (an interview by voice with no phone line),
 * and, when a carrier is configured, the endpoints the carrier calls.
 */

import { readFileSync } from "node:fs";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type { Instrument } from "../instrument/types.js";
import type { ModelClassifier } from "../interviewer/classify.js";
import { Interviewer, type AuditEvent } from "../interviewer/interviewer.js";
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

/** A readable account of how each answer was reached, for the page to show after the call. */
export function trail(instrument: Instrument, log: AuditEvent[]): { question: string; said: string; readAs: string; by: string; confidence: number; decision: string }[] {
  const out = [];
  for (let i = 0; i < log.length; i++) {
    const e = log[i]!;
    if (e.type !== "classified" || e.expecting !== "answer") continue;
    const heard = log.slice(0, i).reverse().find((x) => x.type === "heard");
    const decision = log.slice(i + 1).find((x) => x.type === "decision");
    const item = instrument.items.find((it) => it.id === e.slot?.split("#")[0]);
    const row = e.slot?.includes("#") ? item?.rows?.find((r) => r.code === e.slot!.split("#")[1])?.label : undefined;
    const a = e.classification.answer;
    const readAs = e.classification.intent !== "answer" || !a ? e.classification.intent.replace("_", " ") : a.kind === "choice" ? (item?.choices?.find((c) => c.code === a.code)?.label ?? a.code) : a.kind === "number" ? String(a.value) : a.kind === "text" ? "their own words" : a.reason.replace("_", " ");
    out.push({ question: row ?? item?.text ?? e.slot ?? "", said: heard?.type === "heard" ? heard.text : "", readAs, by: e.classification.by, confidence: e.classification.confidence, decision: decision?.type === "decision" ? decision.detail : "" });
  }
  return out;
}

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
