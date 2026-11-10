/**
 * The call protocol: everything the interviewer may say that is not survey wording.
 * Introduction, AI disclosure, consent, neutral probes and closings. Fixed text, set once per
 * campaign; together with the survey script it is the complete list of what can be spoken.
 */

import { createHash } from "node:crypto";
import type { Script, ScriptId, ScriptLine } from "../script/script.js";

export const PROTOCOL_VERSION = "1";

/** Always the first sentence after the greeting. A campaign cannot remove or reword it. */
export const AI_DISCLOSURE = "I am an automated AI interviewer, not a person.";

export interface CampaignWording {
  /** Who the call is from, e.g. "the Riverside Library Study". */
  sponsor: string;
  /** What the survey is about, e.g. "your local public library". */
  topic: string;
  /** Honest estimate of the length in minutes. */
  minutes: number;
  /** Ask whether an audio recording may be kept. Without a yes, no audio is kept. */
  askRecording: boolean;
}

export type ProtocolKey =
  | "intro"
  | "purpose"
  | "transcribed"
  | "how_to_stop"
  | "consent_ask"
  | "consent_unclear"
  | "consent_declined"
  | "recording_ask"
  | "begin"
  | "resume"
  | "probe_repeat"
  | "probe_unclear"
  | "probe_closest"
  | "probe_number"
  | "probe_dont_know"
  | "cannot_help"
  | "moving_on"
  | "opt_out_done"
  | "stopped"
  | "callback"
  | "closing";

export interface ProtocolLine {
  id: ScriptId;
  role: "protocol";
  source: "protocol";
  key: ProtocolKey;
  text: string;
}

export type SpokenLine = ScriptLine | ProtocolLine;

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function buildProtocol(w: CampaignWording): ProtocolLine[] {
  const sponsor = clean(w.sponsor);
  const topic = clean(w.topic);
  if (sponsor === "" || topic === "") throw new Error("A campaign needs a sponsor name and a topic.");
  if (!Number.isInteger(w.minutes) || w.minutes < 1 || w.minutes > 60) throw new Error("Survey length must be a whole number of minutes between 1 and 60.");
  const text: Record<ProtocolKey, string> = {
    intro: `Hello. This is a call from ${sponsor}. ${AI_DISCLOSURE}`,
    purpose: `I am calling with a short survey about ${topic}. It takes about ${w.minutes} ${w.minutes === 1 ? "minute" : "minutes"}.`,
    transcribed: "Taking part is voluntary. This call is transcribed by automated services so that your answers can be recorded.",
    how_to_stop: "You can stop at any time by saying stop. To be removed from our call list, say remove me.",
    consent_ask: "Do you agree to take part?",
    consent_unclear: "Sorry, I did not catch that. Do you agree to take part? Please say yes or no.",
    consent_declined: "That is fine. Thank you for your time. Goodbye.",
    recording_ask: "May we keep an audio recording of this call for quality checks? Please say yes or no.",
    begin: "Thank you. Here is the first question.",
    resume: "Thank you. We will continue where we stopped.",
    probe_repeat: "Let me repeat the question.",
    probe_unclear: "Sorry, I did not catch that.",
    probe_closest: "Which of the answer options comes closest?",
    probe_number: "Please answer with a number.",
    probe_dont_know: "There are no right or wrong answers. Which answer comes closest?",
    cannot_help: "I am not able to answer questions or explain further. Let me repeat the question.",
    moving_on: "Let us move on.",
    opt_out_done: "You have been removed from our call list and will not be called again. Goodbye.",
    stopped: "We will stop here. Thank you for your time. Goodbye.",
    callback: "We will try you again at another time. Goodbye.",
    closing: "Those are all the questions. Thank you for your time. Goodbye.",
  };
  return (Object.keys(text) as ProtocolKey[])
    .filter((key) => key !== "recording_ask" || w.askRecording)
    .map((key) => ({ id: `p.${key}` as ScriptId, role: "protocol", source: "protocol", key, text: text[key] }));
}

/** The complete, closed set of lines for one campaign. Nothing outside it can be spoken. */
export interface SpeechTable {
  lines: Map<ScriptId, SpokenLine>;
  /** Identifies the exact wording of every line: survey script, protocol and campaign wording. */
  hash: string;
}

export function buildSpeechTable(script: Script, protocol: ProtocolLine[]): SpeechTable {
  const lines = new Map<ScriptId, SpokenLine>();
  for (const l of [...protocol, ...script.lines]) {
    if (lines.has(l.id)) throw new Error(`Duplicate line id ${l.id}`);
    lines.set(l.id, l);
  }
  const intro = lines.get("p.intro" as ScriptId);
  if (!intro || !intro.text.includes(AI_DISCLOSURE)) throw new Error("The introduction must contain the AI disclosure.");
  const hash = createHash("sha256")
    .update(JSON.stringify({ script: script.hash, protocol: PROTOCOL_VERSION, lines: protocol.map((l) => [l.id, l.text]) }))
    .digest("hex");
  return { lines, hash };
}
