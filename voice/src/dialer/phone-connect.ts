/**
 * Places a real phone call for a claimed case and runs the interviewer over it.
 * Everything that can go wrong before a person is on the line becomes an attempt outcome.
 */

import type { CallSession, MachineResult, TelephonyProvider } from "../telephony/types.js";
import { sleepCall } from "../telephony/types.js";
import { DEFAULT_VOICE_OPTIONS, runVoiceCall, type VoiceOptions } from "../voice/call.js";
import { DEFAULT_PHONE_OPTIONS, PhoneChannel, type PhoneOptions } from "../voice/phone.js";
import type { SpeechStore } from "../voice/tts.js";
import type { CallResult, Connect } from "./worker.js";

export interface PhoneConnectOptions {
  provider: TelephonyProvider;
  speech: SpeechStore;
  /** Give up if nobody picks up within this long. */
  ringTimeoutMs?: number;
  /** Ask the carrier whether a person or a machine answered. No message is ever left on a machine. */
  detectMachine?: boolean;
  /** Longest wait after pickup before the interviewer speaks, whatever has or has not been heard. */
  machineWaitMs?: number;
  /** Quiet after the person's "hello" that shows they have finished saying it. */
  greetingQuietMs?: number;
  /** If nothing at all is heard for this long after pickup, the interviewer speaks first. */
  noGreetingMs?: number;
  maxCallSeconds?: number;
  voice?: VoiceOptions;
  phone?: Partial<Omit<PhoneOptions, "audio">>;
}

/** Telnyx hang-up causes that mean the number itself is bad. */
const BAD_NUMBER = /unallocated|invalid_number|number_changed|no_route|incompatible_destination/i;

function waitForAnswer(session: CallSession, timeoutMs: number): Promise<"answered" | "ended" | "timeout"> {
  if (session.answered) return Promise.resolve("answered");
  if (session.ended) return Promise.resolve("ended");
  return new Promise((resolve) => {
    const done = (r: "answered" | "ended" | "timeout") => {
      session.off("answered", onAnswer);
      session.off("ended", onEnd);
      resolve(r);
    };
    const onAnswer = () => done("answered");
    const onEnd = () => done("ended");
    session.once("answered", onAnswer);
    session.once("ended", onEnd);
    void sleepCall(session, timeoutMs).then(() => done("timeout"));
  });
}

/**
 * Listens for the carrier's person-or-machine verdict from the moment the call is placed, since
 * it can arrive at the same instant as the pickup or seconds after it.
 */
function machineVerdict(session: CallSession, onMachine: () => void): { now(): MachineResult | null } {
  let verdict: MachineResult | null = null;
  session.once("machine", (r) => {
    verdict = r;
    if (r === "machine") onMachine();
  });
  return { now: () => verdict };
}

/**
 * After pickup, wait for the moment to speak: when the person has said their "hello" and gone
 * quiet, or said nothing for a moment, or the carrier has given its verdict. Never longer than
 * `maxWaitMs`.
 */
async function afterGreeting(session: CallSession, verdict: () => MachineResult | null, t: { maxWaitMs: number; quietMs: number; noGreetingMs: number }): Promise<void> {
  const began = session.now();
  let heardAt: number | null = null;
  let finished = false;
  const onSound = () => void (heardAt = session.now());
  const onEnd = () => void (finished = heardAt !== null);
  session.on("speechStart", onSound);
  session.on("transcript", onSound);
  session.on("utteranceEnd", onEnd);
  try {
    for (;;) {
      const now = session.now();
      if (session.ended || verdict() !== null || now - began >= t.maxWaitMs) return;
      if (heardAt === null ? now - began >= t.noGreetingMs : finished || now - heardAt >= t.quietMs) return;
      await sleepCall(session, 50);
    }
  } finally {
    session.off("speechStart", onSound);
    session.off("transcript", onSound);
    session.off("utteranceEnd", onEnd);
  }
}

export function phoneConnect(opts: PhoneConnectOptions): Connect {
  const detectMachine = opts.detectMachine ?? true;
  return async (claim, interviewer): Promise<CallResult> => {
    let session: CallSession;
    try {
      session = await opts.provider.startCall(claim.case.phone, { maxDurationSeconds: opts.maxCallSeconds ?? 900, amd: detectMachine });
    } catch (err) {
      const refused = err instanceof Error && err.message.startsWith("Refusing to dial");
      return { connected: false, outcome: refused ? "invalid_number" : "carrier_error" };
    }
    // The carrier's verdict takes about four seconds on a real call, far too long to leave a person
    // in silence. So the interviewer starts after the greeting, and a "machine" verdict that
    // arrives later ends the call there: voicemail records nothing before its own greeting ends.
    let started = false;
    let machineLate = false;
    const verdict = machineVerdict(session, () => {
      if (!detectMachine || !started || session.ended) return;
      machineLate = true;
      void session.hangup();
    });
    const answer = await waitForAnswer(session, opts.ringTimeoutMs ?? 35_000);
    if (answer !== "answered") {
      const reason = session.endReason ?? "";
      if (answer === "timeout") await session.hangup();
      if (/busy/i.test(reason)) return { connected: false, outcome: "busy" };
      if (BAD_NUMBER.test(reason)) return { connected: false, outcome: "invalid_number" };
      return { connected: false, outcome: "no_answer" };
    }
    await afterGreeting(session, () => (detectMachine ? verdict.now() : "human"), { maxWaitMs: opts.machineWaitMs ?? 4000, quietMs: opts.greetingQuietMs ?? 500, noGreetingMs: opts.noGreetingMs ?? 1500 });
    if (detectMachine && verdict.now() === "machine") {
      await session.hangup();
      return { connected: false, outcome: "answering_machine" };
    }
    if (session.ended) return { connected: false, outcome: "no_answer" };
    started = true;
    const channel = new PhoneChannel(session, { ...DEFAULT_PHONE_OPTIONS, ...opts.phone, audio: (line) => opts.speech.get(line) });
    await runVoiceCall(interviewer, channel, opts.voice ?? DEFAULT_VOICE_OPTIONS);
    // A machine cannot agree to anything; whatever it "said" is not an interview.
    if (machineLate && interviewer.state.consent.participate !== true) return { connected: false, outcome: "answering_machine" };
    return { connected: true };
  };
}
