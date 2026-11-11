/**
 * The two HTTP endpoints Telnyx calls: signed webhooks for call progress, and the media-stream
 * WebSocket that carries audio, marks and key presses.
 *
 * Origin: phone_map `server/app.ts` (the Telnyx webhook and media routes). Changed here: they
 * are a function to register on any Fastify app, not part of one fixed app. The raw-body parser
 * is scoped to these routes. Signatures are always checked, on the webhook and, new here, on
 * the stream connection, which Telnyx's media-streaming page says it signs with the same key.
 */

import fastifyWebsocket from "@fastify/websocket";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { TELNYX_MEDIA_PATH, TELNYX_WEBHOOK_PATH, type TelnyxProvider, type TelnyxWebhook } from "./telnyx.js";

type WithRawBody = FastifyRequest & { rawBody?: string };

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return typeof v === "string" ? v : undefined;
}

/**
 * Register the Telnyx webhook and media-stream routes. Adds `@fastify/websocket` to the app
 * unless it is already there. The app must be served at the provider's `publicBaseUrl`.
 */
export async function registerTelnyxRoutes(app: FastifyInstance, telnyx: TelnyxProvider): Promise<void> {
  if (!app.hasDecorator("websocketServer")) await app.register(fastifyWebsocket);

  await app.register(async (scope) => {
    // Keep the raw JSON body: Telnyx signs the exact bytes it sent.
    scope.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
      (req as WithRawBody).rawBody = body as string;
      if (!body) return done(null, {});
      try {
        done(null, JSON.parse(body as string));
      } catch {
        done(Object.assign(new Error("Invalid JSON"), { statusCode: 400 }), undefined);
      }
    });

    scope.post(TELNYX_WEBHOOK_PATH, { bodyLimit: 256 * 1024 }, async (req, reply) => {
      const raw = (req as WithRawBody).rawBody ?? "";
      if (!telnyx.verify(raw, header(req, "telnyx-timestamp"), header(req, "telnyx-signature-ed25519"))) {
        return reply.status(403).send({ error: "Invalid signature" });
      }
      telnyx.handleWebhook((req.body ?? {}) as TelnyxWebhook);
      return reply.status(200).send({ ok: true });
    });

    scope.get<{ Params: { token: string } }>(`${TELNYX_MEDIA_PATH}/:token`, { websocket: true }, (socket, req) => {
      // The unguessable per-call token in the URL names the call; the signature shows the caller is Telnyx.
      const session = telnyx.get(req.params.token);
      if (!session) {
        socket.close(1008, "unknown call");
        return;
      }
      if (!telnyx.verify(session.streamUrl, header(req, "telnyx-timestamp"), header(req, "telnyx-signature-ed25519"))) {
        socket.close(1008, "bad signature");
        return;
      }
      session.attachSocket(socket);
    });
  });
}
