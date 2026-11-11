/**
 * The demo server with stand-ins for the voice vendors, for checking the page's "server voice"
 * path with no vendor account: the voice is a hum of the right length, and the "recogniser"
 * hears the next reply from a fixed list each time it is sent about a second of sound.
 *
 *   npx tsx scripts/demo-standin-server.ts          (PORT, default 3312; DEMO_BARGE_IN=1)
 *   node scripts/demo-server-voice-check.cjs http://127.0.0.1:3312 <output-dir>
 */
import { readFileSync } from "node:fs";
import { readQsf } from "../src/qualtrics/qsf.js";
import { buildApp } from "../src/server/app.js";
import { scriptedStt } from "../src/telephony/stt.js";
import { humVoice } from "../src/voice/tts.js";

const instrument = readQsf(readFileSync(new URL("../fixtures/qualtrics/library-test.qsf", import.meta.url), "utf8")).instrument!;
const replies = ["yes", "Yes", "about once a month", "Somewhat agree", "Neither agree nor disagree", "Strongly agree", "eight", "12", "yes", "Longer weekend hours", "Good"];
const app = await buildApp({
  demoInstrument: instrument,
  demoVoice: humVoice(60),
  demoStt: { id: "stand-in/scripted", open: scriptedStt(replies, 1000) },
  demoBargeIn: process.env.DEMO_BARGE_IN === "1",
  demoPerHour: 1000,
});
const port = Number(process.env.PORT ?? 3312);
await app.listen({ port, host: "127.0.0.1" });
console.log(`Stand-in demo server on port ${port}. Not a real voice, not a real recogniser.`);
