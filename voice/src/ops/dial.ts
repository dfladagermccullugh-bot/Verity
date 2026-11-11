/** Placing real calls: the safety rail on which numbers may be dialled, and the loop that keeps a campaign going. */

import type { ModelClassifier } from "../interviewer/classify.js";
import type { Store } from "../dialer/store.js";
import { runCampaign, type Connect, type RunSummary } from "../dialer/worker.js";
import type { TelephonyProvider } from "../telephony/types.js";

export type Allowlist = { kind: "numbers"; numbers: string[] } | { kind: "campaign" };

/**
 * Which numbers this server may dial. There is no default: with nothing set, nothing is dialled.
 * A list of numbers limits calls to those numbers (for example your own phone while testing).
 * The word "campaign" lifts the limit so that everyone in the campaign with consent may be called;
 * that is a deliberate step, to be taken only after the consent wording has had legal review.
 */
export function parseAllowlist(value: string | undefined): Allowlist | null {
  const v = (value ?? "").trim();
  if (v === "") return null;
  if (v.toLowerCase() === "campaign") return { kind: "campaign" };
  const numbers = v.split(",").map((n) => n.trim()).filter(Boolean);
  if (numbers.some((n) => !/^\+1\d{10}$/.test(n))) throw new Error("DIAL_ALLOWLIST must be the word campaign, or US numbers like +12025550143 separated by commas.");
  return { kind: "numbers", numbers };
}

/** Wrap a carrier so that it refuses any number not on the allowlist, before any request is made. */
export function allowlisted(provider: TelephonyProvider, allow: Allowlist): TelephonyProvider {
  return {
    name: provider.name,
    startCall: async (e164, opts) => {
      if (allow.kind === "numbers" && !allow.numbers.includes(e164)) throw new Error("Refusing to dial: this number is not on the server's allowlist.");
      return provider.startCall(e164, opts);
    },
  };
}

export interface DialLoopOptions {
  connect: Connect;
  model?: ModelClassifier;
  now?: () => Date;
  /** Pause between passes over the campaign. */
  intervalMs?: number;
  signal: AbortSignal;
  onPass?: (summary: RunSummary) => void;
}

/** Keep calling whoever is due until the campaign is no longer running or the signal fires. */
export async function dialLoop(store: Store, campaignId: string, opts: DialLoopOptions): Promise<void> {
  const now = opts.now ?? (() => new Date());
  while (!opts.signal.aborted) {
    if ((await store.getCampaign(campaignId)).status !== "running") return;
    // A call left open by a crash is closed after 30 minutes, and its case becomes callable again.
    await store.recoverStale(30, now());
    const run: Parameters<typeof runCampaign>[2] = { transport: "telephone", connect: opts.connect, now };
    if (opts.model) run.model = opts.model;
    opts.onPass?.(await runCampaign(store, campaignId, run));
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, opts.intervalMs ?? 60_000);
      opts.signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
    });
  }
}
