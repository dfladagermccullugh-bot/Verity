/**
 * Runs a campaign: several workers, each claiming one person at a time, running the call and
 * saving the result. How a call is actually carried (simulator, browser, phone line) is the
 * `connect` function's business; the worker only knows the interviewer and the outcome.
 */

import type { ModelClassifier } from "../interviewer/classify.js";
import { Interviewer } from "../interviewer/interviewer.js";
import { buildProtocol, buildSpeechTable } from "../interviewer/protocol.js";
import { buildScript } from "../script/script.js";
import type { AttemptOutcome } from "./rules.js";
import type { Claim, Store } from "./store.js";

/** What happened when the call was placed. */
export type CallResult =
  /** Nobody to interview: the reason is the attempt's outcome. */
  | { connected: false; outcome: Extract<AttemptOutcome, "no_answer" | "busy" | "answering_machine" | "invalid_number" | "carrier_error"> }
  /** The interviewer ran. If the line dropped before it finished, the attempt is a break-off. */
  | { connected: true };

/** Place the call for a claimed case and run the interviewer over it. */
export type Connect = (claim: Claim, interviewer: Interviewer) => Promise<CallResult>;

export interface RunOptions {
  transport: string;
  connect: Connect;
  now: () => Date;
  model?: ModelClassifier;
  /** Overrides the campaign's own concurrency setting. */
  concurrency?: number;
  /** Stop after this many attempts in total (a safety net for tests and dry runs). */
  maxAttempts?: number;
}

export interface RunSummary {
  attempts: number;
  byOutcome: Partial<Record<AttemptOutcome, number>>;
  /** Highest number of calls in progress at once. */
  peakConcurrency: number;
}

export function interviewerFor(claim: Claim, model?: ModelClassifier): Interviewer {
  const script = buildScript(claim.campaign.instrument);
  const table = buildSpeechTable(script, buildProtocol(claim.campaign.wording));
  if (table.hash !== claim.campaign.speechHash) throw new Error("The campaign's wording no longer matches the approved speech table.");
  const init: ConstructorParameters<typeof Interviewer>[0] = { instrument: claim.campaign.instrument, script, table, policy: claim.campaign.policy, resumeFrom: claim.case.interview };
  if (model) init.model = model;
  return new Interviewer(init);
}

/** Run one claimed call to completion and save it. Never throws for a failed call: that is an outcome. */
export async function runClaim(store: Store, claim: Claim, opts: Pick<RunOptions, "connect" | "now" | "model">): Promise<AttemptOutcome> {
  const interviewer = interviewerFor(claim, opts.model);
  let outcome: AttemptOutcome;
  try {
    const result = await opts.connect(claim, interviewer);
    outcome = result.connected ? (interviewer.state.outcome ?? "breakoff") : result.outcome;
  } catch {
    outcome = "carrier_error";
  }
  await store.finishAttempt({ claim, outcome, interview: interviewer.state.interview, review: interviewer.state.review, recordingConsent: interviewer.state.consent.recording, events: interviewer.log, now: opts.now(), latencyMs: interviewer.state.latencyMs });
  return outcome;
}

/** Work through everyone who can be called right now, then return. */
export async function runCampaign(store: Store, campaignId: string, opts: RunOptions): Promise<RunSummary> {
  const campaign = await store.getCampaign(campaignId);
  const workers = Math.max(1, opts.concurrency ?? campaign.settings.concurrency);
  const summary: RunSummary = { attempts: 0, byOutcome: {}, peakConcurrency: 0 };
  let inCall = 0;
  let started = 0;
  const work = async () => {
    for (;;) {
      if (opts.maxAttempts !== undefined && started >= opts.maxAttempts) return;
      started += 1;
      const claim = await store.claimNext(campaignId, opts.transport, opts.now());
      if (!claim) {
        started -= 1;
        return;
      }
      inCall += 1;
      summary.peakConcurrency = Math.max(summary.peakConcurrency, inCall);
      try {
        const outcome = await runClaim(store, claim, opts);
        summary.attempts += 1;
        summary.byOutcome[outcome] = (summary.byOutcome[outcome] ?? 0) + 1;
      } finally {
        inCall -= 1;
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, work));
  return summary;
}
