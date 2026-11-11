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
  /** Longest wait for the carrier's person-or-machine verdict before going ahead. */
  machineWaitMs?: number;
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
 * it can arrive at the same instant as the pickup.
 */
function machineVerdict(session: CallSession): (timeoutMs: number) => Promise<MachineResult> {
  let verdict: MachineResult | null = null;
  let waiting: ((r: MachineResult) => void) | null = null;
  session.once("machine", (r) => {
    verdict = r;
    waiting?.(r);
  });
  return (timeoutMs) =>
    new Promise((resolve) => {
      if (verdict) return resolve(verdict);
      waiting = resolve;
      void sleepCall(session, timeoutMs).then(() => resolve(verdict ?? "unknown"));
    });
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
    const verdict = machineVerdict(session);
    const answer = await waitForAnswer(session, opts.ringTimeoutMs ?? 35_000);
    if (answer !== "answered") {
      const reason = session.endReason ?? "";
      if (answer === "timeout") await session.hangup();
      if (/busy/i.test(reason)) return { connected: false, outcome: "busy" };
      if (BAD_NUMBER.test(reason)) return { connected: false, outcome: "invalid_number" };
      return { connected: false, outcome: "no_answer" };
    }
    if (detectMachine && (await verdict(opts.machineWaitMs ?? 4000)) === "machine") {
      await session.hangup();
      return { connected: false, outcome: "answering_machine" };
    }
    if (session.ended) return { connected: false, outcome: "no_answer" };
    const channel = new PhoneChannel(session, { ...DEFAULT_PHONE_OPTIONS, ...opts.phone, audio: (line) => opts.speech.get(line) });
    await runVoiceCall(interviewer, channel, opts.voice ?? DEFAULT_VOICE_OPTIONS);
    return { connected: true };
  };
}
