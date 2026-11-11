/**
 * Tools for comparing voices (plan decision D11): render a campaign's lines with each voice,
 * save them as files a person can listen to, and check how well a recogniser hears them back.
 */

import { SAMPLE_RATE } from "../telephony/audio.js";

function words(text: string): string[] {
  return text.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
}

/**
 * Word error rate: the fewest word substitutions, insertions and deletions that turn `heard` into
 * `said`, divided by the number of words said. 0 is a perfect match. Case and punctuation are ignored.
 */
export function wordErrorRate(said: string, heard: string): number {
  const a = words(said);
  const b = words(heard);
  if (a.length === 0) return b.length === 0 ? 0 : 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length]! / a.length;
}

/** Wrap 8 kHz mu-law audio in a WAV header so any audio player can open it. */
export function mulawWav(mulaw: Buffer): Buffer {
  const header = Buffer.alloc(58);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(50 + mulaw.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(18, 16); // fmt chunk size
  header.writeUInt16LE(7, 20); // format 7 = mu-law
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE, 28); // bytes per second
  header.writeUInt16LE(1, 32); // block align
  header.writeUInt16LE(8, 34); // bits per sample
  header.writeUInt16LE(0, 36); // no extra format bytes
  header.write("fact", 38, "ascii");
  header.writeUInt32LE(4, 42);
  header.writeUInt32LE(mulaw.length, 46);
  header.write("data", 50, "ascii");
  header.writeUInt32LE(mulaw.length, 54);
  return Buffer.concat([header, mulaw]);
}
