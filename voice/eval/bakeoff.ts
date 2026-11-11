/**
 * Voice comparison (plan decision D11). For every voice that has a key in the environment:
 * renders each line of the Library test script, saves it as a WAV file to listen to, and, when a
 * Deepgram key is present, has the recogniser transcribe it back and scores the match.
 *
 *   CARTESIA_API_KEY + CARTESIA_VOICE_ID, DEEPGRAM_API_KEY   then:   npm run bakeoff -- --out bakeoff
 *
 * NOT YET RUN: no vendor key existed in the build environment. Listening tests by a person and
 * the comparison of recognisers on real phone audio are still to do; only one recogniser adapter
 * (Deepgram) exists so far.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { buildProtocol, buildSpeechTable } from "../src/interviewer/protocol.js";
import { readQsf } from "../src/qualtrics/qsf.js";
import { buildScript } from "../src/script/script.js";
import { SAMPLE_RATE } from "../src/telephony/audio.js";
import { mulawWav, wordErrorRate } from "../src/voice/compare.js";
import { cartesiaVoice, deepgramVoice, type TtsVoice } from "../src/voice/tts.js";

const { values } = parseArgs({ options: { out: { type: "string" } } });
const out = values.out ?? "bakeoff";
const env = process.env;
const voices: TtsVoice[] = [];
if (env.CARTESIA_API_KEY && env.CARTESIA_VOICE_ID) voices.push(cartesiaVoice({ apiKey: env.CARTESIA_API_KEY, voiceId: env.CARTESIA_VOICE_ID }));
if (env.DEEPGRAM_API_KEY) voices.push(deepgramVoice({ apiKey: env.DEEPGRAM_API_KEY }));
if (voices.length === 0) {
  console.error("No voice is configured. Set CARTESIA_API_KEY and CARTESIA_VOICE_ID, and/or DEEPGRAM_API_KEY.");
  process.exit(2);
}

/** Deepgram's pre-recorded transcription, used only to hear the rendered lines back. */
async function transcribe(mulaw: Buffer): Promise<string> {
  const res = await fetch(`https://api.deepgram.com/v1/listen?model=nova-3&encoding=mulaw&sample_rate=${SAMPLE_RATE}`, { method: "POST", headers: { Authorization: `Token ${env.DEEPGRAM_API_KEY}`, "Content-Type": "audio/basic" }, body: new Uint8Array(mulaw) });
  if (!res.ok) throw new Error(`Deepgram transcription failed with HTTP ${res.status}`);
  const body = (await res.json()) as { results?: { channels?: { alternatives?: { transcript?: string }[] }[] } };
  return body.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
}

const instrument = readQsf(readFileSync(new URL("../fixtures/qualtrics/library-test.qsf", import.meta.url), "utf8")).instrument!;
const table = buildSpeechTable(buildScript(instrument), buildProtocol({ sponsor: "the Library Study", topic: "your local public library", minutes: 3, askRecording: true }));
const rows = ["| Voice | Lines | Audio | Render time | Heard back correctly (1 − word error rate) |", "|---|---|---|---|---|"];
for (const voice of voices) {
  const dir = join(out, voice.id.replace(/[^a-z0-9.-]+/gi, "_"));
  mkdirSync(dir, { recursive: true });
  let samples = 0;
  let wer = 0;
  let scored = 0;
  const started = Date.now();
  for (const line of table.lines.values()) {
    const audio = await voice.synthesize(line.text);
    samples += audio.length;
    writeFileSync(join(dir, `${line.id}.wav`), mulawWav(audio));
    if (env.DEEPGRAM_API_KEY) {
      wer += wordErrorRate(line.text, await transcribe(audio));
      scored += 1;
    }
  }
  rows.push(`| ${voice.id} | ${table.lines.size} | ${(samples / SAMPLE_RATE).toFixed(0)} s | ${((Date.now() - started) / 1000).toFixed(1)} s | ${scored === 0 ? "not scored" : `${(100 * (1 - wer / scored)).toFixed(1)}%`} |`);
}
writeFileSync(join(out, "results.md"), rows.join("\n") + "\n");
console.log(rows.join("\n"));
console.log(`\nAudio saved under ${out}/ for listening.`);
