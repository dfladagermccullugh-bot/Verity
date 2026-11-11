/** The operator's jobs around a campaign: set it up from files, see where it stands, get the outputs. */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readContactsCsv } from "../dialer/contacts.js";
import type { CampaignSettings, DialBlock } from "../dialer/rules.js";
import type { Campaign, Store } from "../dialer/store.js";
import type { CampaignWording } from "../interviewer/protocol.js";
import { writeResponsesCsv } from "../qualtrics/csv.js";
import { readQsf } from "../qualtrics/qsf.js";
import { campaignReport, type ReportContext } from "../report/campaign-report.js";
import { renderReadinessReport } from "../report/readiness.js";
import { trail, type TrailRow } from "../report/trail.js";
import { writeCsv } from "../util/csv.js";

export interface SetupResult {
  /** Null when the survey cannot be run by voice; `readiness` says why. */
  campaign: Campaign | null;
  readiness: string;
  contacts: { rows: number; added: number; withoutConsent: number; skipped: { phone: string; reason: string }[]; problems: { line: number; problems: string[] }[] };
}

/** Create a campaign (as a draft: nothing is called until it is started) from a survey file and a contact list. */
export async function setUpCampaign(store: Store, input: { name: string; qsf: string; contactsCsv: string; wording: CampaignWording; settings?: Partial<CampaignSettings> }): Promise<SetupResult> {
  const read = readQsf(input.qsf);
  const readiness = renderReadinessReport(read, input.name);
  const rows = readContactsCsv(input.contactsCsv);
  const problems = rows.filter((r) => r.problems.length > 0).map((r) => ({ line: r.line, problems: r.problems }));
  if (!read.instrument) return { campaign: null, readiness, contacts: { rows: rows.length, added: 0, withoutConsent: 0, skipped: [], problems } };
  const campaign = await store.createCampaign({ name: input.name, instrument: read.instrument, wording: input.wording, ...(input.settings ? { settings: input.settings } : {}) });
  const added = await store.addCases(campaign.id, rows);
  return { campaign, readiness, contacts: { rows: rows.length, added: added.added, withoutConsent: rows.filter((r) => r.consent === null).length, skipped: added.skipped, problems } };
}

export interface Status {
  name: string;
  status: Campaign["status"];
  cases: { total: number; pending: number; inCall: number; closed: number };
  outcomes: Record<string, number>;
  /** Why open cases cannot be called right now. */
  blocked: Partial<Record<DialBlock, number>>;
  callableNow: number;
  minutesUsed: number;
}

export async function campaignStatus(store: Store, campaignId: string, now: Date): Promise<Status> {
  const campaign = await store.getCampaign(campaignId);
  const cases = await store.listCases(campaignId);
  const blockedList = await store.blocked(campaignId, now);
  const blocked: Partial<Record<DialBlock, number>> = {};
  for (const b of blockedList) blocked[b.reason] = (blocked[b.reason] ?? 0) + 1;
  const outcomes: Record<string, number> = {};
  for (const c of cases) if (c.finalOutcome) outcomes[c.finalOutcome] = (outcomes[c.finalOutcome] ?? 0) + 1;
  const open = cases.filter((c) => c.status !== "final").length;
  return {
    name: campaign.name,
    status: campaign.status,
    cases: { total: cases.length, pending: cases.filter((c) => c.status === "pending").length, inCall: cases.filter((c) => c.status === "in_call").length, closed: cases.length - open },
    outcomes,
    blocked,
    callableNow: open - blockedList.length,
    minutesUsed: Math.round(await store.minutesUsed(campaignId)),
  };
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ");

function trailTable(rows: TrailRow[]): string[] {
  return ["| Question | Respondent said | Read as | Decided by | Confidence | Decision |", "|---|---|---|---|---|---|", ...rows.map((r) => `| ${cell(r.question)} | ${cell(r.said)} | ${cell(r.readAs)} | ${r.by} | ${r.confidence.toFixed(2)} | ${cell(r.decision)} |`)];
}

/** Everything recorded about one person's calls, in order: for answering "how did we get this answer?". */
export async function caseAudit(store: Store, campaignId: string, ref: string): Promise<string> {
  const campaign = await store.getCampaign(campaignId);
  const found = (await store.listCases(campaignId)).find((c) => c.externalRef === ref || c.id === ref);
  if (!found) throw new Error(`No case ${ref} in this campaign.`);
  const attempts = (await store.listAttempts(campaignId)).filter((a) => a.caseId === found.id);
  const out = [`# Audit trail: ${found.externalRef ?? found.id}`, "", `Campaign: ${campaign.name}. Script version \`${campaign.speechHash.slice(0, 12)}\`. Final outcome: ${found.finalOutcome ?? "open"}. Flagged for review: ${found.review.length === 0 ? "none" : found.review.join(", ")}.`, ""];
  for (const a of attempts) {
    const log = await store.auditFor(a.id);
    out.push(`## Call ${a.number} (${a.startedAt.toISOString()}, ${a.transport}): ${a.outcome ?? "in progress"}`, "");
    out.push("### What was said", "");
    for (const e of log) {
      if (e.type === "say") out.push(`- **Interviewer** (\`${e.lineId}\`): ${e.text}`);
      else if (e.type === "heard") out.push(`- **Respondent:** ${e.text}`);
      else if (e.type === "played" && !e.completed) out.push(`  - *(playback of \`${e.lineId}\` was cut off when the respondent began to speak)*`);
      else if (e.type === "flag") out.push(`  - *(flagged ${e.slot}: ${e.reason})*`);
    }
    const rows = trail(campaign.instrument, log);
    if (rows.length > 0) out.push("", "### How each reply was read", "", ...trailTable(rows));
    out.push("");
  }
  return out.join("\n");
}

/** The answers a person should check, each with what was said and how it was read. */
export async function reviewSheet(store: Store, campaignId: string): Promise<string> {
  const campaign = await store.getCampaign(campaignId);
  const cases = (await store.listCases(campaignId)).filter((c) => c.review.length > 0);
  const attempts = await store.listAttempts(campaignId);
  const out = [`# Answers to check: ${campaign.name}`, "", cases.length === 0 ? "Nothing was flagged." : `${cases.reduce((n, c) => n + c.review.length, 0)} answers in ${cases.length} interviews. For each: every reply the respondent gave to that question, and what was recorded.`, ""];
  for (const c of cases) {
    const rows: TrailRow[] = [];
    for (const a of attempts.filter((x) => x.caseId === c.id)) rows.push(...trail(campaign.instrument, await store.auditFor(a.id)).filter((r) => c.review.includes(r.slot)));
    out.push(`## ${c.externalRef ?? c.id}`, "", ...trailTable(rows), "");
  }
  return out.join("\n");
}

/** Write the campaign's outputs to a folder. The response file is the one to import into Qualtrics. */
export async function writeCampaignOutputs(store: Store, campaignId: string, ctx: ReportContext, dir: string): Promise<string[]> {
  mkdirSync(dir, { recursive: true });
  const campaign = await store.getCampaign(campaignId);
  const records = (await store.responseRecords(campaignId)).sort((a, b) => a.caseId.localeCompare(b.caseId));
  const dnc = await store.doNotCallList();
  const files: [string, string][] = [
    ["report.md", await campaignReport(store, campaignId, ctx)],
    ["qualtrics-responses.csv", writeResponsesCsv(campaign.instrument, records)],
    // Phone and reason, to mark these people as unsubscribed wherever the contact list is kept.
    ["do-not-call.csv", writeCsv([["phone", "reason", "added_at"], ...dnc.map((d) => [d.phone, d.reason, d.addedAt.toISOString()])])],
    ["answers-to-check.md", await reviewSheet(store, campaignId)],
  ];
  return files.map(([name, content]) => {
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
  });
}
