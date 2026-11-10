/**
 * The rules that decide whether a case may be called, and what happens after each attempt.
 * Pure functions. These are compliance rules, so they are code with tests, not settings a
 * campaign can switch off: no consent on file means no call, with no override.
 */

import type { Outcome } from "../interviewer/interviewer.js";
import { DEFAULT_WINDOW, nextPermitted, withinWindow, zonesFor, type CallWindow } from "./hours.js";

/** How one call attempt ended. The interviewer's outcomes plus the ways a call can fail to connect. */
export type AttemptOutcome = Outcome | "no_answer" | "busy" | "answering_machine" | "invalid_number" | "carrier_error" | "not_dialed";

export const CONSENT_METHODS = ["web_form", "written", "oral_recorded"] as const;

/** Proof that this person agreed to be called for this study. */
export interface ConsentRecord {
  /** Where the proof lives, e.g. a Qualtrics response id. */
  source: string;
  /** When consent was given, ISO 8601. */
  obtainedAt: string;
  method: (typeof CONSENT_METHODS)[number];
  /** What was agreed to, in the words shown to the person. */
  scope: string;
}

export interface CampaignSettings {
  window: CallWindow;
  /** Calls placed to one person, in total. */
  maxAttempts: number;
  /** Consent older than this many days is not relied on. */
  consentValidDays: number;
  /** Stop placing calls once the campaign has used this many call minutes. */
  maxCallMinutes: number;
  /** Calls in progress at once. */
  concurrency: number;
  /** Hours to wait before trying again, by attempt outcome. */
  retryHours: { noContact: number; callback: number; breakoff: number };
}

export const DEFAULT_SETTINGS: CampaignSettings = {
  window: DEFAULT_WINDOW,
  maxAttempts: 4,
  consentValidDays: 90,
  maxCallMinutes: 600,
  concurrency: 10,
  retryHours: { noContact: 26, callback: 24, breakoff: 24 },
};

export interface DialCandidate {
  phone: string;
  status: "pending" | "in_call" | "final";
  consent: ConsentRecord | null;
  attempts: number;
  nextAttemptAt: Date | null;
  timezone: string | null;
  stateCode: string | null;
}

export type DialBlock =
  | "no_consent"
  | "consent_invalid"
  | "consent_expired"
  | "on_do_not_call_list"
  | "campaign_not_running"
  | "case_closed"
  | "call_in_progress"
  | "max_attempts"
  | "not_due"
  | "outside_hours"
  | "minutes_cap_reached";

export type DialDecision = { ok: true } | { ok: false; reason: DialBlock };

export function consentProblem(consent: ConsentRecord | null, now: Date, validDays: number): DialBlock | null {
  if (!consent) return "no_consent";
  const at = Date.parse(consent.obtainedAt);
  const complete = consent.source.trim() !== "" && consent.scope.trim() !== "" && (CONSENT_METHODS as readonly string[]).includes(consent.method);
  if (!complete || !Number.isFinite(at) || at > now.getTime()) return "consent_invalid";
  if (now.getTime() - at > validDays * 86_400_000) return "consent_expired";
  return null;
}

export function canDial(input: { candidate: DialCandidate; campaignStatus: string; settings: CampaignSettings; onDnc: boolean; minutesUsed: number; now: Date }): DialDecision {
  const { candidate: c, settings, now } = input;
  const no = (reason: DialBlock): DialDecision => ({ ok: false, reason });
  // Consent and the do-not-call list come first: nothing else can make up for them.
  const consent = consentProblem(c.consent, now, settings.consentValidDays);
  if (consent) return no(consent);
  if (input.onDnc) return no("on_do_not_call_list");
  if (input.campaignStatus !== "running") return no("campaign_not_running");
  if (c.status === "final") return no("case_closed");
  if (c.status === "in_call") return no("call_in_progress");
  if (c.attempts >= settings.maxAttempts) return no("max_attempts");
  if (input.minutesUsed >= settings.maxCallMinutes) return no("minutes_cap_reached");
  if (c.nextAttemptAt && c.nextAttemptAt.getTime() > now.getTime()) return no("not_due");
  if (!withinWindow(now, zonesFor(c), settings.window)) return no("outside_hours");
  return { ok: true };
}

/** Outcomes after which the person is never called again for this campaign. */
export const FINAL_OUTCOMES: ReadonlySet<AttemptOutcome> = new Set<AttemptOutcome>(["complete", "consent_declined", "opt_out", "invalid_number"]);

export interface AfterAttempt {
  final: boolean;
  /** When to try again; null when final. Always inside calling hours. */
  nextAttemptAt: Date | null;
  /** Add the number to the do-not-call list. */
  addToDnc: boolean;
}

export function afterAttempt(input: { outcome: AttemptOutcome; attemptsMade: number; candidate: Pick<DialCandidate, "timezone" | "stateCode">; settings: CampaignSettings; now: Date }): AfterAttempt {
  const { outcome, settings, now } = input;
  const addToDnc = outcome === "opt_out";
  if (FINAL_OUTCOMES.has(outcome) || input.attemptsMade >= settings.maxAttempts) return { final: true, nextAttemptAt: null, addToDnc };
  const hours = outcome === "callback" ? settings.retryHours.callback : outcome === "breakoff" ? settings.retryHours.breakoff : outcome === "carrier_error" || outcome === "not_dialed" ? 1 : settings.retryHours.noContact;
  const earliest = new Date(now.getTime() + hours * 3_600_000);
  return { final: false, nextAttemptAt: nextPermitted(earliest, zonesFor(input.candidate), settings.window) ?? earliest, addToDnc };
}
