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
import { MULAW_SILENCE, SAMPLE_RATE, mulawFrames } from "../src/telephony/audio.js";
import { deepgramStt } from "../src/telephony/stt.js";
import { mulawWav, wordErrorRate } from "../src/voice/compare.js";
import { cartesiaVoice, deepgramVoice, type TtsVoice } from "../src/voice/tts.js";

const { values } = parseArgs({ options: { out: { type: "string" } } });
const out = values.out ?? "bakeoff";
const env = process.env;
const voices: TtsVoice[] = [];
const pageVoices: TtsVoice[] = [];
if (env.CARTESIA_API_KEY && env.CARTESIA_VOICE_ID) {
  voices.push(cartesiaVoice({ apiKey: env.CARTESIA_API_KEY, voiceId: env.CARTESIA_VOICE_ID }));
  pageVoices.push(cartesiaVoice({ apiKey: env.CARTESIA_API_KEY, voiceId: env.CARTESIA_VOICE_ID, output: "page" }));
}
if (env.DEEPGRAM_API_KEY) {
  voices.push(deepgramVoice({ apiKey: env.DEEPGRAM_API_KEY }));
  pageVoices.push(deepgramVoice({ apiKey: env.DEEPGRAM_API_KEY, output: "page" }));
}
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
let sample: Buffer | null = null;
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
    if (line.id === "p.consent_ask") sample = audio;
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

// Two checks of what the browser demo relies on, which the table above does not exercise.
const ASK = "Do you agree to take part?";
for (const voice of pageVoices) {
  const wav = await voice.synthesize(ASK);
  const file = join(out, `${voice.id.replace(/[^a-z0-9.-]+/gi, "_")}.wav`);
  writeFileSync(file, wav);
  console.log(`Page voice ${voice.id}: a WAV file of ${wav.length} bytes at ${wav.readUInt32LE(24)} Hz, saved as ${file}.`);
}
if (env.DEEPGRAM_API_KEY && sample) {
  // The streaming recogniser (the one that listens during an interview): play it one line at the pace of speech.
  const stream = deepgramStt({ apiKey: env.DEEPGRAM_API_KEY, optOut: true })({ encoding: "mulaw", sampleRate: SAMPLE_RATE });
  const seen = { finals: [] as string[], speechStart: false, utteranceEnd: false, error: "" };
  stream.on("transcript", (e) => void (e.isFinal && seen.finals.push(e.text)));
  stream.on("speechStart", () => void (seen.speechStart = true));
  stream.on("utteranceEnd", () => void (seen.utteranceEnd = true));
  stream.on("error", (err) => void (seen.error = err.message));
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (const frame of [...mulawFrames(sample), ...mulawFrames(Buffer.alloc(SAMPLE_RATE * 2, MULAW_SILENCE))]) {
    stream.write(frame);
    await pause(20);
  }
  for (let i = 0; i < 40 && !(seen.finals.length > 0 && seen.utteranceEnd) && !seen.error; i++) await pause(100);
  stream.close();
  const heard = seen.finals.join(" ");
  console.log(`Streaming recogniser: said "${ASK}", heard "${heard}" (word error rate ${wordErrorRate(ASK, heard).toFixed(2)}); speech start ${seen.speechStart ? "reported" : "NOT reported"}; end of utterance ${seen.utteranceEnd ? "reported" : "NOT reported"}${seen.error ? `; ERROR: ${seen.error}` : ""}.`);
  if (seen.error || heard === "") process.exitCode = 1;
}

