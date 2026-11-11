/**
 * Campaigns, cases, call attempts and the audit log, in Postgres.
 *
 * A worker "claims" a case inside one short transaction (row lock, re-check every rule, mark it
 * in-call, open the attempt), then runs the call with no transaction open, then "finishes" the
 * attempt in a second short transaction. The same pattern as the legacy Verity engine: state is
 * always in the database, so a crashed worker loses a call, never an answer already saved.
 */

import { randomUUID } from "node:crypto";
import type { Instrument } from "../instrument/types.js";
import type { InterviewState } from "../engine/flow.js";
import { DEFAULT_POLICY, type AuditEvent, type Policy } from "../interviewer/interviewer.js";
import { buildProtocol, buildSpeechTable, type CampaignWording } from "../interviewer/protocol.js";
import type { InterviewRecord } from "../qualtrics/csv.js";
import { buildScript } from "../script/script.js";
import type { Sql } from "../db/sql.js";
import { normalizeUsPhone } from "./contacts.js";
import { DEFAULT_SETTINGS, afterAttempt, canDial, type AttemptOutcome, type CampaignSettings, type ConsentRecord, type DialBlock } from "./rules.js";

export interface Campaign {
  id: string;
  name: string;
  status: "draft" | "running" | "paused" | "closed";
  instrument: Instrument;
  wording: CampaignWording;
  policy: Policy;
  settings: CampaignSettings;
  speechHash: string;
}

export interface Case {
  id: string;
  campaignId: string;
  phone: string;
  externalRef: string | null;
  timezone: string | null;
  stateCode: string | null;
  consent: ConsentRecord | null;
  status: "pending" | "in_call" | "final";
  attempts: number;
  nextAttemptAt: Date | null;
  interview: InterviewState;
  review: string[];
  /** Response latency by slot, from spoken calls. */
  latencyMs: Record<string, number>;
  finalOutcome: AttemptOutcome | null;
}

export interface Attempt {
  id: string;
  caseId: string;
  number: number;
  transport: string;
  startedAt: Date;
  endedAt: Date | null;
  outcome: AttemptOutcome | null;
  recordingConsent: boolean | null;
}

export interface NewContact {
  phone: string;
  externalRef?: string | null;
  timezone?: string | null;
  stateCode?: string | null;
  consent?: ConsentRecord | null;
}

export interface Claim {
  campaign: Campaign;
  case: Case;
  attempt: Attempt;
}

type Row = Record<string, any>;

const asDate = (v: unknown): Date | null => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));
// JSON is always written as text cast to jsonb ($n::text::jsonb), so both database drivers store
// a real JSON value rather than a JSON-encoded string. Reads then arrive already parsed.
const asJson = <T>(v: unknown): T => (typeof v === "string" ? (JSON.parse(v) as T) : (v as T));

function toCampaign(r: Row): Campaign {
  return { id: r.id, name: r.name, status: r.status, instrument: asJson(r.instrument), wording: asJson(r.wording), policy: asJson(r.policy), settings: asJson(r.settings), speechHash: r.speech_hash };
}

function toCase(r: Row): Case {
  return {
    id: r.id,
    campaignId: r.campaign_id,
    phone: r.phone,
    externalRef: r.external_ref,
    timezone: r.timezone,
    stateCode: r.state_code,
    consent: r.consent === null ? null : asJson<ConsentRecord>(r.consent),
    status: r.status,
    attempts: Number(r.attempts),
    nextAttemptAt: asDate(r.next_attempt_at),
    interview: asJson(r.interview),
    review: asJson(r.review),
    latencyMs: asJson(r.latency_ms ?? {}),
    finalOutcome: r.final_outcome,
  };
}

function toAttempt(r: Row): Attempt {
  return { id: r.id, caseId: r.case_id, number: Number(r.number), transport: r.transport, startedAt: asDate(r.started_at)!, endedAt: asDate(r.ended_at), outcome: r.outcome, recordingConsent: r.recording_consent };
}

export class Store {
  constructor(private readonly sql: Sql) {}

  async createCampaign(input: { name: string; instrument: Instrument; wording: CampaignWording; policy?: Policy; settings?: Partial<CampaignSettings> }): Promise<Campaign> {
    // Building the speech table validates the wording and locks in the AI disclosure.
    const table = buildSpeechTable(buildScript(input.instrument), buildProtocol(input.wording));
    const campaign: Campaign = {
      id: randomUUID(),
      name: input.name,
      status: "draft",
      instrument: input.instrument,
      wording: input.wording,
      policy: input.policy ?? DEFAULT_POLICY,
      settings: { ...DEFAULT_SETTINGS, ...input.settings },
      speechHash: table.hash,
    };
    await this.sql.query("insert into campaigns (id, name, status, instrument, wording, policy, settings, speech_hash) values ($1,$2,$3,$4::text::jsonb,$5::text::jsonb,$6::text::jsonb,$7::text::jsonb,$8)", [
      campaign.id,
      campaign.name,
      campaign.status,
      JSON.stringify(campaign.instrument),
      JSON.stringify(campaign.wording),
      JSON.stringify(campaign.policy),
      JSON.stringify(campaign.settings),
      campaign.speechHash,
    ]);
    return campaign;
  }

  async getCampaign(id: string): Promise<Campaign> {
    const [r] = await this.sql.query("select * from campaigns where id = $1", [id]);
    if (!r) throw new Error(`No campaign ${id}`);
    return toCampaign(r);
  }

  async setCampaignStatus(id: string, status: Campaign["status"]): Promise<void> {
    await this.sql.query("update campaigns set status = $2 where id = $1", [id, status]);
  }

  /** Add people to a campaign. Bad numbers, duplicates and do-not-call numbers are skipped and reported. */
  async addCases(campaignId: string, contacts: NewContact[]): Promise<{ added: number; skipped: { phone: string; reason: string }[] }> {
    let added = 0;
    const skipped: { phone: string; reason: string }[] = [];
    for (const c of contacts) {
      const phone = normalizeUsPhone(c.phone);
      if (!phone.ok) {
        skipped.push({ phone: c.phone, reason: phone.reason });
        continue;
      }
      if (await this.isOnDnc(phone.e164)) {
        skipped.push({ phone: c.phone, reason: "on the do-not-call list" });
        continue;
      }
      const rows = await this.sql.query(
        "insert into cases (id, campaign_id, phone, external_ref, timezone, state_code, consent) values ($1,$2,$3,$4,$5,$6,$7::text::jsonb) on conflict (campaign_id, phone) do nothing returning id",
        [randomUUID(), campaignId, phone.e164, c.externalRef ?? null, c.timezone ?? null, c.stateCode ?? null, c.consent ? JSON.stringify(c.consent) : null],
      );
      if (rows.length === 0) skipped.push({ phone: c.phone, reason: "already in this campaign" });
      else added += 1;
    }
    return { added, skipped };
  }

  async isOnDnc(phone: string): Promise<boolean> {
    return (await this.sql.query("select 1 from do_not_call where phone = $1", [phone])).length > 0;
  }

  async addToDnc(phone: string, reason: string, source: string, now: Date): Promise<void> {
    await this.sql.query("insert into do_not_call (phone, reason, source, added_at) values ($1,$2,$3,$4) on conflict (phone) do nothing", [phone, reason, source, now.toISOString()]);
  }

  async minutesUsed(campaignId: string, sql: Sql = this.sql): Promise<number> {
    const [r] = await sql.query<{ minutes: string | number | null }>(
      "select coalesce(sum(extract(epoch from (a.ended_at - a.started_at))), 0) / 60.0 as minutes from attempts a join cases c on c.id = a.case_id where c.campaign_id = $1 and a.ended_at is not null",
      [campaignId],
    );
    return Number(r?.minutes ?? 0);
  }

  /**
   * Claim the next case that may be called right now, or null when there is none.
   * Every rule is re-checked under the row lock, so two workers can never take the same person.
   */
  async claimNext(campaignId: string, transport: string, now: Date): Promise<Claim | null> {
    return this.sql.tx(async (tx) => {
      const [campaignRow] = await tx.query("select * from campaigns where id = $1", [campaignId]);
      if (!campaignRow) throw new Error(`No campaign ${campaignId}`);
      const campaign = toCampaign(campaignRow);
      const minutesUsed = await this.minutesUsed(campaignId, tx);
      let after = "";
      for (;;) {
        const rows = await tx.query(
          `select * from cases where campaign_id = $1 and status = 'pending' and consent is not null
             and (next_attempt_at is null or next_attempt_at <= $2) and phone > $3
           order by phone limit 50 for update skip locked`,
          [campaignId, now.toISOString(), after],
        );
        if (rows.length === 0) return null;
        for (const row of rows) {
          const c = toCase(row);
          const onDnc = (await tx.query("select 1 from do_not_call where phone = $1", [c.phone])).length > 0;
          const decision = canDial({ candidate: c, campaignStatus: campaign.status, settings: campaign.settings, onDnc, minutesUsed, now });
          if (!decision.ok) continue;
          const number = c.attempts + 1;
          await tx.query("update cases set status = 'in_call', attempts = $2, updated_at = $3 where id = $1", [c.id, number, now.toISOString()]);
          const attempt: Attempt = { id: randomUUID(), caseId: c.id, number, transport, startedAt: now, endedAt: null, outcome: null, recordingConsent: null };
          await tx.query("insert into attempts (id, case_id, number, transport, started_at) values ($1,$2,$3,$4,$5)", [attempt.id, c.id, number, transport, now.toISOString()]);
          return { campaign, case: { ...c, status: "in_call", attempts: number }, attempt };
        }
        after = rows[rows.length - 1]!.phone as string;
      }
    });
  }

  /** Close an attempt: save the answers, the audit log and the outcome, and schedule or close the case. */
  async finishAttempt(input: { claim: Claim; outcome: AttemptOutcome; interview: InterviewState; review: string[]; recordingConsent: boolean | null; events: AuditEvent[]; now: Date; latencyMs?: Record<string, number> }): Promise<{ final: boolean; nextAttemptAt: Date | null }> {
    const { claim, outcome, now } = input;
    const next = afterAttempt({ outcome, attemptsMade: claim.attempt.number, candidate: claim.case, settings: claim.campaign.settings, now });
    await this.sql.tx(async (tx) => {
      const closed = await tx.query("update attempts set ended_at = $2, outcome = $3, recording_consent = $4 where id = $1 and ended_at is null returning id", [claim.attempt.id, now.toISOString(), outcome, input.recordingConsent]);
      if (closed.length === 0) throw new Error(`Attempt ${claim.attempt.id} is already closed.`);
      for (const e of input.events) {
        await tx.query("insert into audit_events (attempt_id, seq, at, body) values ($1,$2,$3,$4::text::jsonb)", [claim.attempt.id, e.seq, now.toISOString(), JSON.stringify(e)]);
      }
      await tx.query(
        "update cases set status = $2, next_attempt_at = $3, interview = $4::text::jsonb, review = $5::text::jsonb, final_outcome = $6, updated_at = $7, latency_ms = latency_ms || $8::text::jsonb where id = $1",
        [
          claim.case.id,
          next.final ? "final" : "pending",
          next.nextAttemptAt ? next.nextAttemptAt.toISOString() : null,
          JSON.stringify(input.interview),
          JSON.stringify(input.review),
          next.final ? outcome : null,
          now.toISOString(),
          JSON.stringify(input.latencyMs ?? {}),
        ],
      );
      if (next.addToDnc) {
        await tx.query("insert into do_not_call (phone, reason, source, added_at) values ($1,$2,$3,$4) on conflict (phone) do nothing", [claim.case.phone, "asked to be removed during a call", `attempt ${claim.attempt.id}`, now.toISOString()]);
      }
    });
    return { final: next.final, nextAttemptAt: next.nextAttemptAt };
  }

  /** Close attempts left open by a crashed worker, keeping whatever answers were saved before. */
  async recoverStale(olderThanMinutes: number, now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - olderThanMinutes * 60_000).toISOString();
    return this.sql.tx(async (tx) => {
      const stale = await tx.query("select a.id, a.case_id from attempts a where a.ended_at is null and a.started_at < $1 for update skip locked", [cutoff]);
      for (const a of stale) {
        await tx.query("update attempts set ended_at = $2, outcome = 'carrier_error' where id = $1", [a.id, now.toISOString()]);
        await tx.query("update cases set status = 'pending', next_attempt_at = $2, updated_at = $2 where id = $1 and status = 'in_call'", [a.case_id, now.toISOString()]);
      }
      return stale.length;
    });
  }

  async getCase(id: string): Promise<Case> {
    const [r] = await this.sql.query("select * from cases where id = $1", [id]);
    if (!r) throw new Error(`No case ${id}`);
    return toCase(r);
  }

  async listCases(campaignId: string): Promise<Case[]> {
    return (await this.sql.query("select * from cases where campaign_id = $1 order by phone", [campaignId])).map(toCase);
  }

  async listAttempts(campaignId: string): Promise<Attempt[]> {
    return (await this.sql.query("select a.* from attempts a join cases c on c.id = a.case_id where c.campaign_id = $1 order by a.started_at, a.case_id, a.number", [campaignId])).map(toAttempt);
  }

  async auditFor(attemptId: string): Promise<AuditEvent[]> {
    return (await this.sql.query("select body from audit_events where attempt_id = $1 order by seq", [attemptId])).map((r) => asJson<AuditEvent>(r.body));
  }

  /** Why each case that is not finished cannot be called right now. For the operator's dashboard. */
  async blocked(campaignId: string, now: Date): Promise<{ caseId: string; reason: DialBlock }[]> {
    const campaign = await this.getCampaign(campaignId);
    const minutesUsed = await this.minutesUsed(campaignId);
    const out: { caseId: string; reason: DialBlock }[] = [];
    for (const c of await this.listCases(campaignId)) {
      if (c.status === "final") continue;
      const d = canDial({ candidate: c, campaignStatus: campaign.status, settings: campaign.settings, onDnc: await this.isOnDnc(c.phone), minutesUsed, now });
      if (!d.ok) out.push({ caseId: c.id, reason: d.reason });
    }
    return out;
  }

  /** One response row per case that gave at least one answer, ready for the Qualtrics import file. */
  async responseRecords(campaignId: string): Promise<InterviewRecord[]> {
    const campaign = await this.getCampaign(campaignId);
    const attempts = await this.listAttempts(campaignId);
    const records: InterviewRecord[] = [];
    for (const c of await this.listCases(campaignId)) {
      const mine = attempts.filter((a) => a.caseId === c.id && a.endedAt);
      if (Object.keys(c.interview.answers).length === 0 || mine.length === 0) continue;
      const last = mine[mine.length - 1]!;
      records.push({
        caseId: c.externalRef ?? c.id,
        startedAt: mine[0]!.startedAt,
        endedAt: last.endedAt!,
        finished: last.outcome === "complete",
        state: c.interview,
        embedded: { vv_mode: "ai_voice", vv_case_id: c.externalRef ?? c.id, vv_outcome: c.finalOutcome ?? last.outcome ?? "", vv_script: campaign.speechHash.slice(0, 12) },
      });
    }
    return records;
  }

  /**
   * Retention: remove respondents' own words from calls that ended before the cutoff. What was
   * asked, how each reply was coded and all timings stay; transcripts, the evidence quoted from
   * them and open-ended answers are replaced by a marker. Coded answers are untouched. Run it
   * only after the responses have been imported into the survey platform, which keeps the record.
   */
  async removeOldWords(campaignId: string, cutoff: Date, now: Date): Promise<{ cases: number; events: number }> {
    const marker = "[removed after the retention period]";
    return this.sql.tx(async (tx) => {
      const due = await tx.query<{ id: string; interview: unknown }>(
        `select c.id, c.interview from cases c where c.campaign_id = $1 and c.status = 'final' and c.words_removed_at is null
           and not exists (select 1 from attempts a where a.case_id = c.id and (a.ended_at is null or a.ended_at >= $2))
           and exists (select 1 from attempts a where a.case_id = c.id) for update`,
        [campaignId, cutoff.toISOString()],
      );
      if (due.length === 0) return { cases: 0, events: 0 };
      await tx.query("select set_config('verity.retention', 'on', true)");
      let events = 0;
      for (const c of due) {
        const heard = await tx.query(
          `update audit_events e set body = jsonb_set(e.body, '{text}', to_jsonb($2::text))
             from attempts a where a.id = e.attempt_id and a.case_id = $1 and e.body->>'type' = 'heard' returning e.seq`,
          [c.id, marker],
        );
        const classified = await tx.query(
          `update audit_events e set body = jsonb_set(e.body, '{classification,evidence}', to_jsonb($2::text))
             from attempts a where a.id = e.attempt_id and a.case_id = $1 and e.body->>'type' = 'classified' returning e.seq`,
          [c.id, marker],
        );
        events += heard.length + classified.length;
        // Open-ended answers are also the respondent's words.
        const interview = asJson<InterviewState>(c.interview);
        for (const [slot, a] of Object.entries(interview.answers)) if (a.kind === "text") interview.answers[slot] = { kind: "text", value: marker };
        await tx.query("update cases set interview = $2::text::jsonb, words_removed_at = $3, updated_at = $3 where id = $1", [c.id, JSON.stringify(interview), now.toISOString()]);
      }
      await tx.query("select set_config('verity.retention', '', true)");
      return { cases: due.length, events };
    });
  }

  async doNotCallList(): Promise<{ phone: string; reason: string; source: string; addedAt: Date }[]> {
    return (await this.sql.query("select * from do_not_call order by added_at, phone")).map((r: Row) => ({ phone: r.phone, reason: r.reason, source: r.source, addedAt: asDate(r.added_at)! }));
  }
}
