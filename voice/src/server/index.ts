/**
 * Starts the web server. With no settings it serves the browser demo, reading answers by rule
 * only. Optional environment variables switch on more:
 *
 *   PORT, HOST                 where to listen (default 3000, 0.0.0.0)
 *   ANTHROPIC_API_KEY          the demo also reads natural replies with Claude
 *   DEMO_QSF                   path to the survey file the demo runs (default: the Library test)
 */

import { readFileSync } from "node:fs";
import { claudeClassifier } from "../interviewer/claude-classifier.js";
import { readQsf } from "../qualtrics/qsf.js";
import { buildApp, type AppOptions } from "./app.js";

const qsfPath = process.env.DEMO_QSF ?? new URL("../../fixtures/qualtrics/library-test.qsf", import.meta.url);
const read = readQsf(readFileSync(qsfPath, "utf8"));
if (!read.instrument) {
  console.error("The demo survey cannot be run by voice:", read.findings.map((f) => f.message).join("; "));
  process.exit(1);
}
const options: AppOptions = { demoInstrument: read.instrument };
if (process.env.ANTHROPIC_API_KEY) options.model = claudeClassifier();

const app = await buildApp(options);
const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: process.env.HOST ?? "0.0.0.0" });
console.log(`Verity Voice demo on port ${port}. Answer reading: ${options.model ? options.model.id : "rules only (set ANTHROPIC_API_KEY to add the language model)"}.`);
