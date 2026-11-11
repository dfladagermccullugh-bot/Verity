/**
 * Starts the web server.
 *
 * With no settings it serves the browser demo, reading answers by rule only. Environment
 * variables switch on more. Secrets belong in the host's secret store, never in a file.
 *
 *   PORT, HOST            where to listen (default 3000, 0.0.0.0)
 *   DEMO_QSF              survey file the demo runs (default: the Library test)
 *   ANTHROPIC_API_KEY     read natural replies with Claude (demo and calls)
 *   DEEPGRAM_API_KEY      the demo hears through Deepgram, and speaks with Deepgram's voice
 *   CARTESIA_API_KEY + CARTESIA_VOICE_ID   the demo speaks with Cartesia's voice instead
 *                         (TTS_VENDOR=deepgram keeps Deepgram's voice when both are set)
 *   DEMO_BARGE_IN=1       let the visitor's voice stop a line that is playing (try with headphones first)
 *
 * Which voice the demo uses when both are set is a placeholder, not a judgement: the voice is to
 * be chosen by the comparison (`npm run bakeoff`) and by listening.
 *
 * Real phone calls need ALL of the following; if any is missing the server places no calls:
 *
 *   DATABASE_URL          the Verity Voice database
 *   DIAL_CAMPAIGN_ID      the campaign to call (it must also be started)
 *   DIAL_ALLOWLIST        numbers that may be dialled, e.g. "+12025550143"; or the word
 *                         "campaign" to allow everyone in the campaign with consent on file
 *   PUBLIC_BASE_URL       this server's public https address (the carrier calls back to it)
 *   TELNYX_API_KEY, TELNYX_CONNECTION_ID, TELNYX_FROM_NUMBER, TELNYX_PUBLIC_KEY
 *   DEEPGRAM_API_KEY      speech recognition
 *   CARTESIA_API_KEY + CARTESIA_VOICE_ID   the voice (or TTS_VENDOR=deepgram to use Deepgram's)
 *
 * The phone path has been run only against the simulated carrier, never a live one.
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";
import { migrate } from "../db/migrate.js";
import { postgresSql } from "../db/sql.js";
import { phoneConnect } from "../dialer/phone-connect.js";
import { Store } from "../dialer/store.js";
import { claudeClassifier } from "../interviewer/claude-classifier.js";
import { buildProtocol, buildSpeechTable } from "../interviewer/protocol.js";
import { allowlisted, dialLoop, parseAllowlist } from "../ops/dial.js";
import { readQsf } from "../qualtrics/qsf.js";
import { buildScript } from "../script/script.js";
import { deepgramStt } from "../telephony/stt.js";
import { TelnyxProvider } from "../telephony/telnyx.js";
import { SpeechStore, cartesiaVoice, deepgramVoice } from "../voice/tts.js";
import { buildApp, type AppOptions } from "./app.js";

const env = process.env;
const qsfPath = env.DEMO_QSF ?? new URL("../../fixtures/qualtrics/library-test.qsf", import.meta.url);
const read = readQsf(readFileSync(qsfPath, "utf8"));
if (!read.instrument) {
  console.error("The demo survey cannot be run by voice:", read.findings.map((f) => f.message).join("; "));
  process.exit(1);
}
const options: AppOptions = { demoInstrument: read.instrument };
if (env.ANTHROPIC_API_KEY) options.model = claudeClassifier();
if (env.CARTESIA_API_KEY && env.CARTESIA_VOICE_ID && env.TTS_VENDOR !== "deepgram") options.demoVoice = cartesiaVoice({ apiKey: env.CARTESIA_API_KEY, voiceId: env.CARTESIA_VOICE_ID, output: "page" });
else if (env.DEEPGRAM_API_KEY) options.demoVoice = deepgramVoice({ apiKey: env.DEEPGRAM_API_KEY, output: "page" });
if (env.DEEPGRAM_API_KEY) options.demoStt = { id: "deepgram/nova-3", open: deepgramStt({ apiKey: env.DEEPGRAM_API_KEY, optOut: true }) };
options.demoBargeIn = env.DEMO_BARGE_IN === "1";
options.warmDemoVoice = true;

const NEEDED = ["DATABASE_URL", "DIAL_CAMPAIGN_ID", "DIAL_ALLOWLIST", "PUBLIC_BASE_URL", "TELNYX_API_KEY", "TELNYX_CONNECTION_ID", "TELNYX_FROM_NUMBER", "TELNYX_PUBLIC_KEY", "DEEPGRAM_API_KEY"];
const missing = NEEDED.filter((k) => !env[k]);
const voiceReady = env.TTS_VENDOR === "deepgram" || (env.CARTESIA_API_KEY && env.CARTESIA_VOICE_ID);
const dialing = missing.length === 0 && Boolean(voiceReady);

let telnyx: TelnyxProvider | undefined;
if (dialing) {
  telnyx = new TelnyxProvider({
    apiKey: env.TELNYX_API_KEY!,
    connectionId: env.TELNYX_CONNECTION_ID!,
    fromNumber: env.TELNYX_FROM_NUMBER!,
    publicKey: env.TELNYX_PUBLIC_KEY!,
    publicBaseUrl: env.PUBLIC_BASE_URL!,
    allowedCountries: ["US"],
    stt: deepgramStt({ apiKey: env.DEEPGRAM_API_KEY! }),
    log: (m) => console.log(m),
  });
  options.telnyx = telnyx;
}

const app = await buildApp(options);
const port = Number(env.PORT ?? 3000);
await app.listen({ port, host: env.HOST ?? "0.0.0.0" });
console.log(`Verity Voice on port ${port}. Answer reading: ${options.model ? options.model.id : "rules only"}. Demo voice: ${options.demoVoice?.id ?? "the browser's own"}. Demo hearing: ${options.demoStt?.id ?? "the browser's own"}.`);

if (!dialing) {
  console.log(`Phone calls are off (${missing.length > 0 ? `not set: ${missing.join(", ")}` : "no voice configured"}). Serving the browser demo only.`);
} else {
  const allow = parseAllowlist(env.DIAL_ALLOWLIST)!;
  const sql = postgresSql(postgres(env.DATABASE_URL!, { max: 10, onnotice: () => {} }) as never);
  await migrate(sql);
  const store = new Store(sql);
  const campaign = await store.getCampaign(env.DIAL_CAMPAIGN_ID!);
  const voice = env.TTS_VENDOR === "deepgram" ? deepgramVoice({ apiKey: env.DEEPGRAM_API_KEY! }) : cartesiaVoice({ apiKey: env.CARTESIA_API_KEY!, voiceId: env.CARTESIA_VOICE_ID! });
  const speech = new SpeechStore(voice, env.SPEECH_CACHE_DIR);
  // Render every line before the first call, so no respondent waits on the voice vendor.
  const rendered = await speech.prerender(buildSpeechTable(buildScript(campaign.instrument), buildProtocol(campaign.wording)));
  console.log(`Rendered ${rendered.lines} lines (${rendered.seconds} s of audio) with ${voice.id}.`);
  console.log(`Calling for campaign "${campaign.name}". May dial: ${allow.kind === "campaign" ? "everyone in the campaign with consent on file" : allow.numbers.map((n) => `the number ending ${n.slice(-4)}`).join(", ")}.`);
  const controller = new AbortController();
  process.on("SIGTERM", () => controller.abort());
  process.on("SIGINT", () => controller.abort());
  const loop: Parameters<typeof dialLoop>[2] = {
    connect: phoneConnect({ provider: allowlisted(telnyx!, allow), speech }),
    signal: controller.signal,
    onPass: (s) => s.attempts > 0 && console.log(`Pass finished: ${s.attempts} calls, ${JSON.stringify(s.byOutcome)}.`),
  };
  if (options.model) loop.model = options.model;
  await dialLoop(store, campaign.id, loop);
  console.log("Calling has stopped (the campaign is not running, or the server was asked to stop).");
}
