import { describe, expect, it } from "vitest";
import { migrate, splitStatements } from "../src/db/migrate.js";
import type { Sql } from "../src/db/sql.js";
import type { ConsentRecord } from "../src/dialer/rules.js";
import { Store, type Campaign } from "../src/dialer/store.js";
import { runCampaign, runClaim, type Connect } from "../src/dialer/worker.js";
import { DEFAULT_WORDING, at, converse, cooperative, type Persona } from "../src/interviewer/simulate.js";
import { writeResponsesCsv } from "../src/qualtrics/csv.js";
import { parseCsv } from "../src/util/csv.js";
import { testDb } from "./db.js";
import { RESPONSE_A, library, rng } from "./helpers.js";

const NOON_ET = new Date("2026-11-10T17:00:00Z");
const CONSENT: ConsentRecord = { source: "Qualtrics R_1", obtainedAt: "2026-11-01T12:00:00.000Z", method: "web_form", scope: "Phone survey about your local library, by an AI interviewer." };
const SPOKEN_A: Record<string, string> = { QID2: "Yes", QID3: "About once a month", "QID4#1": "Somewhat agree", "QID4#2": "Neither agree nor disagree", "QID4#3": "Strongly agree", QID5: "8", QID6: "12", QID7: "yes", QID8: "Longer weekend hours", QID9: "Good" };
const phone = (n: number) => `+1202555${String(1000 + n).padStart(4, "0")}`;
const person = (n: number, over: object = {}) => ({ phone: phone(n), timezone: "America/New_York", consent: CONSENT, externalRef: `R_${n}`, ...over });

async function setup(contacts: object[] = [person(1)], settings = {}): Promise<{ sql: Sql; store: Store; campaign: Campaign }> {
  const sql = await testDb();
  const store = new Store(sql);
  const campaign = await store.createCampaign({ name: "Library pilot", instrument: library(), wording: DEFAULT_WORDING, settings });
  await store.addCases(campaign.id, contacts as never);
  await store.setCampaignStatus(campaign.id, "running");
  return { sql, store, campaign: await store.getCampaign(campaign.id) };
}

const talkTo = (persona: Persona): Connect => async (_claim, interviewer) => {
  await converse(interviewer, persona);
  return { connected: true };
};

describe("migrations", () => {
  it("apply once and are safe to run again", async () => {
    const sql = await testDb();
    expect(await migrate(sql)).toEqual([]);
    expect((await sql.query("select name from schema_migrations")).length).toBe(1);
  });

  it("keeps function bodies whole when splitting statements", () => {
    const parts = splitStatements("-- c\ncreate table a (x int);\ncreate function f() returns trigger language plpgsql as $$\nbegin\n  return new;\nend $$;\ncreate index i on a (x);\n");
    expect(parts).toHaveLength(3);
    expect(parts[1]).toContain("return new;");
  });
});

describe("campaigns and contact lists", () => {
  it("skips bad numbers, duplicates and numbers on the do-not-call list", async () => {
    const { store, campaign } = await setup([]);
    await store.addToDnc(phone(3), "asked by email", "operator", NOON_ET);
    const r = await store.addCases(campaign.id, [person(1), person(1), { phone: "911" }, person(3), person(4, { consent: null })] as never);
    expect(r.added).toBe(2);
    expect(r.skipped.map((s) => s.reason)).toEqual(["already in this campaign", "emergency and service codes are never called", "on the do-not-call list"]);
  });

  it("stores JSON as real JSON values, not as encoded strings", async () => {
    const { sql, store, campaign } = await setup();
    const claim = (await store.claimNext(campaign.id, "simulator", NOON_ET))!;
    await runClaim(store, claim, { connect: talkTo(cooperative(SPOKEN_A)), now: () => NOON_ET });
    const [types] = await sql.query<Record<string, string>>(
      `select jsonb_typeof(k.instrument) as instrument, jsonb_typeof(k.wording) as wording, jsonb_typeof(k.policy) as policy, jsonb_typeof(k.settings) as settings,
              jsonb_typeof(c.consent) as consent, jsonb_typeof(c.interview) as interview, jsonb_typeof(c.review) as review,
              (select jsonb_typeof(body) from audit_events limit 1) as audit
       from campaigns k join cases c on c.campaign_id = k.id`,
    );
    expect(types).toEqual({ instrument: "object", wording: "object", policy: "object", settings: "object", consent: "object", interview: "object", review: "array", audit: "object" });
  });

  it("refuses a campaign whose wording is incomplete", async () => {
    const store = new Store(await testDb());
    await expect(store.createCampaign({ name: "x", instrument: library(), wording: { ...DEFAULT_WORDING, sponsor: "" } })).rejects.toThrow(/sponsor/);
  });
});

describe("claiming a case to call", () => {
  it("claims a callable case once, and opens the attempt", async () => {
    const { store, campaign } = await setup();
    const claim = await store.claimNext(campaign.id, "simulator", NOON_ET);
    expect(claim).toMatchObject({ case: { status: "in_call", attempts: 1, phone: phone(1) }, attempt: { number: 1, transport: "simulator", endedAt: null } });
    expect(await store.claimNext(campaign.id, "simulator", NOON_ET)).toBeNull();
  });

  it("claims nobody when the campaign is not running, outside hours, or with no consent on file", async () => {
    const { store, campaign } = await setup([person(1), person(2, { consent: null })]);
    await store.setCampaignStatus(campaign.id, "paused");
    expect(await store.claimNext(campaign.id, "simulator", NOON_ET)).toBeNull();
    await store.setCampaignStatus(campaign.id, "running");
    expect(await store.claimNext(campaign.id, "simulator", new Date("2026-11-10T08:00:00Z"))).toBeNull();
    expect((await store.claimNext(campaign.id, "simulator", NOON_ET))!.case.phone).toBe(phone(1));
    expect(await store.claimNext(campaign.id, "simulator", NOON_ET)).toBeNull();
    expect(await store.blocked(campaign.id, NOON_ET)).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "no_consent" }), expect.objectContaining({ reason: "call_in_progress" })]));
  });

  it("looks past people who cannot be called now to find one who can", async () => {
    const hawaii = Array.from({ length: 60 }, (_, i) => person(i + 1, { timezone: "Pacific/Honolulu" }));
    const { store, campaign } = await setup([...hawaii, person(99)]);
    const claim = await store.claimNext(campaign.id, "simulator", NOON_ET); // 7am in Hawaii
    expect(claim!.case.phone).toBe(phone(99));
  });

  it("stops when the campaign's minutes are used up", async () => {
    const { store, campaign } = await setup([person(1), person(2)], { maxCallMinutes: 5 });
    const claim = (await store.claimNext(campaign.id, "simulator", NOON_ET))!;
    await store.finishAttempt({ claim, outcome: "complete", interview: { answers: {}, heard: [] }, review: [], recordingConsent: null, events: [], now: new Date(NOON_ET.getTime() + 6 * 60_000) });
    expect(await store.minutesUsed(campaign.id)).toBeCloseTo(6);
    expect(await store.claimNext(campaign.id, "simulator", new Date(NOON_ET.getTime() + 7 * 60_000))).toBeNull();
  });
});

describe("the database enforces the rules by itself", () => {
  it("an attempt cannot be created for a case without consent, whatever the code does", async () => {
    const { sql, store, campaign } = await setup([person(1, { consent: null })]);
    const [c] = await store.listCases(campaign.id);
    await expect(sql.query("insert into attempts (id, case_id, number, transport, started_at) values ('a1', $1, 1, 'phone', now())", [c!.id])).rejects.toThrow(/no consent on file/);
  });

  it("an attempt cannot be created for a number on the do-not-call list", async () => {
    const { sql, store, campaign } = await setup();
    await store.addToDnc(phone(1), "asked by email", "operator", NOON_ET);
    const [c] = await store.listCases(campaign.id);
    await expect(sql.query("insert into attempts (id, case_id, number, transport, started_at) values ('a1', $1, 1, 'phone', now())", [c!.id])).rejects.toThrow(/do-not-call/);
    expect(await store.claimNext(campaign.id, "simulator", NOON_ET)).toBeNull();
  });

  it("a person cannot be on two calls at once", async () => {
    const { sql, store, campaign } = await setup();
    const claim = (await store.claimNext(campaign.id, "simulator", NOON_ET))!;
    await expect(sql.query("insert into attempts (id, case_id, number, transport, started_at) values ('a2', $1, 2, 'phone', now())", [claim.case.id])).rejects.toThrow();
  });

  it("the audit log and the do-not-call list cannot be edited or deleted", async () => {
    const { sql, store, campaign } = await setup();
    const claim = (await store.claimNext(campaign.id, "simulator", NOON_ET))!;
    await runClaim(store, claim, { connect: talkTo(at("QID5", "remove me", cooperative(SPOKEN_A))), now: () => NOON_ET });
    await expect(sql.query("update audit_events set body = '{}'")).rejects.toThrow(/append-only/);
    await expect(sql.query("delete from audit_events")).rejects.toThrow(/append-only/);
    await expect(sql.query("delete from do_not_call")).rejects.toThrow(/append-only/);
    expect((await store.doNotCallList()).map((d) => d.phone)).toEqual([phone(1)]);
  });
});

describe("running calls", () => {
  it("a completed call is saved with its answers, audit log and a Qualtrics row", async () => {
    const { store, campaign } = await setup();
    let clock = NOON_ET.getTime();
    const summary = await runCampaign(store, campaign.id, { transport: "simulator", connect: talkTo(cooperative(SPOKEN_A)), now: () => new Date((clock += 60_000)) });
    expect(summary).toMatchObject({ attempts: 1, byOutcome: { complete: 1 } });
    const [c] = await store.listCases(campaign.id);
    expect(c).toMatchObject({ status: "final", finalOutcome: "complete", attempts: 1, nextAttemptAt: null });
    expect(c!.interview.answers).toEqual(RESPONSE_A);
    const [attempt] = await store.listAttempts(campaign.id);
    const audit = await store.auditFor(attempt!.id);
    expect(audit.map((e) => e.seq)).toEqual(audit.map((_, i) => i + 1));
    expect(audit.filter((e) => e.type === "decision" && e.action === "record")).toHaveLength(10);
    const rows = parseCsv(writeResponsesCsv(campaign.instrument, await store.responseRecords(campaign.id)));
    expect(rows[3]!.slice(5)).toEqual(["1", "1", "3", "4", "3", "5", "8", "12", "1", "Longer weekend hours", "2", "ai_voice", "R_1"]);
  });

  it("an opt-out is permanent, and covers every campaign", async () => {
    const { store, campaign } = await setup();
    await runCampaign(store, campaign.id, { transport: "simulator", connect: talkTo(at("QID5", "take me off your list", cooperative(SPOKEN_A))), now: () => NOON_ET });
    expect((await store.listCases(campaign.id))[0]).toMatchObject({ status: "final", finalOutcome: "opt_out" });
    const second = await store.createCampaign({ name: "Another study", instrument: library(), wording: DEFAULT_WORDING });
    expect(await store.addCases(second.id, [person(1)] as never)).toMatchObject({ added: 0, skipped: [{ reason: "on the do-not-call list" }] });
  });

  it("an interrupted call is retried later and resumes at the next unanswered question", async () => {
    const { store, campaign } = await setup();
    await runCampaign(store, campaign.id, { transport: "simulator", connect: talkTo(at("QID5", null, cooperative(SPOKEN_A))), now: () => NOON_ET });
    const [after1] = await store.listCases(campaign.id);
    expect(after1).toMatchObject({ status: "pending", attempts: 1, finalOutcome: null });
    expect(Object.keys(after1!.interview.answers)).toHaveLength(5);
    expect(after1!.nextAttemptAt!.getTime()).toBeGreaterThan(NOON_ET.getTime());
    // Not due yet: nothing is claimed.
    expect(await store.claimNext(campaign.id, "simulator", new Date(NOON_ET.getTime() + 3_600_000))).toBeNull();
    const later = new Date(after1!.nextAttemptAt!.getTime() + 60_000);
    await runCampaign(store, campaign.id, { transport: "simulator", connect: talkTo(cooperative(SPOKEN_A)), now: () => later });
    const [after2] = await store.listCases(campaign.id);
    expect(after2).toMatchObject({ status: "final", finalOutcome: "complete", attempts: 2 });
    expect(after2!.interview.answers).toEqual(RESPONSE_A);
    const attempts = await store.listAttempts(campaign.id);
    const secondAudit = await store.auditFor(attempts[1]!.id);
    expect(secondAudit.filter((e) => e.type === "say").map((e) => (e as { lineId: string }).lineId).slice(5, 8)).toEqual(["p.resume", "q.QID5.ask", "q.QID5.options"]);
  });

  it("no answer is retried up to the attempt limit, then closed", async () => {
    const { store, campaign } = await setup([person(1)], { maxAttempts: 3 });
    let now = NOON_ET;
    for (let i = 0; i < 5; i++) {
      await runCampaign(store, campaign.id, { transport: "simulator", connect: async () => ({ connected: false, outcome: "no_answer" }), now: () => now });
      const [c] = await store.listCases(campaign.id);
      if (c!.status === "final") break;
      now = new Date(c!.nextAttemptAt!.getTime() + 1000);
    }
    expect((await store.listCases(campaign.id))[0]).toMatchObject({ status: "final", attempts: 3, finalOutcome: "no_answer" });
    expect(await store.responseRecords(campaign.id)).toEqual([]);
  });

  it("a crash while connecting is an outcome, not a lost case; stale calls are recovered", async () => {
    const { store, campaign } = await setup([person(1), person(2)]);
    await runCampaign(store, campaign.id, { transport: "simulator", maxAttempts: 1, concurrency: 1, connect: async () => Promise.reject(new Error("socket closed")), now: () => NOON_ET });
    expect((await store.listAttempts(campaign.id))[0]).toMatchObject({ outcome: "carrier_error" });
    const abandoned = (await store.claimNext(campaign.id, "simulator", NOON_ET))!;
    expect(await store.recoverStale(30, new Date(NOON_ET.getTime() + 10 * 60_000))).toBe(0);
    expect(await store.recoverStale(30, new Date(NOON_ET.getTime() + 31 * 60_000))).toBe(1);
    expect(await store.getCase(abandoned.case.id)).toMatchObject({ status: "pending" });
  });
});

describe("many calls at once", () => {
  it("200 people, 40 calls at a time: nobody is called twice at once, nothing is lost or duplicated", async () => {
    const rand = rng(7);
    const people = Array.from({ length: 200 }, (_, i) => person(i + 1, i % 20 === 19 ? { consent: null } : {}));
    const { store, campaign } = await setup(people, { concurrency: 40, maxCallMinutes: 100_000 });
    const kinds = new Map<string, string>();
    const inCall = new Set<string>();
    const connect: Connect = async (claim, interviewer) => {
      expect(inCall.has(claim.case.id)).toBe(false);
      inCall.add(claim.case.id);
      try {
        const kind = kinds.get(claim.case.phone) ?? ["complete", "complete", "complete", "optout", "decline", "hangup", "noanswer", "machine"][Math.floor(rand() * 8)]!;
        kinds.set(claim.case.phone, kind);
        await new Promise((r) => setTimeout(r, Math.floor(rand() * 5)));
        if (kind === "noanswer") return { connected: false, outcome: "no_answer" };
        if (kind === "machine") return { connected: false, outcome: "answering_machine" };
        const persona = kind === "optout" ? at("QID6", "remove me", cooperative(SPOKEN_A)) : kind === "decline" ? () => "no" : kind === "hangup" && claim.attempt.number === 1 ? at("QID4#2", null, cooperative(SPOKEN_A)) : cooperative(SPOKEN_A);
        await converse(interviewer, persona);
        return { connected: true };
      } finally {
        inCall.delete(claim.case.id);
      }
    };
    let now = NOON_ET;
    let peak = 0;
    for (let pass = 0; pass < 8; pass++) {
      const s = await runCampaign(store, campaign.id, { transport: "simulator", connect, now: () => now });
      peak = Math.max(peak, s.peakConcurrency);
      now = new Date(now.getTime() + 27 * 3_600_000);
    }
    expect(peak).toBeGreaterThan(10);
    expect(peak).toBeLessThanOrEqual(40);

    const cases = await store.listCases(campaign.id);
    const attempts = await store.listAttempts(campaign.id);
    expect(cases).toHaveLength(200);
    for (const c of cases) {
      const mine = attempts.filter((a) => a.caseId === c.id).sort((a, b) => a.number - b.number);
      expect(mine.map((a) => a.number)).toEqual(mine.map((_, i) => i + 1));
      expect(mine.length).toBe(c.attempts);
      expect(mine.every((a) => a.endedAt !== null && a.outcome !== null)).toBe(true);
      if (c.consent === null) {
        expect(mine).toEqual([]);
        continue;
      }
      expect(c.status).toBe("final");
      const kind = kinds.get(c.phone)!;
      if (kind === "complete" || kind === "hangup") {
        expect(c.finalOutcome).toBe("complete");
        expect(c.interview.answers).toEqual(RESPONSE_A);
        expect(mine.length).toBe(kind === "hangup" ? 2 : 1);
      } else if (kind === "optout") {
        expect(c.finalOutcome).toBe("opt_out");
        expect(Object.keys(c.interview.answers)).toHaveLength(6);
      } else if (kind === "decline") expect(c.interview.answers).toEqual({});
      else expect(mine.length).toBe(4);
    }
    // Every recorded answer has exactly one "record" decision in the audit log, across all attempts.
    const [{ n: decisions }] = (await (store as unknown as { sql: Sql }).sql.query<{ n: string }>("select count(*) as n from audit_events where body->>'type' = 'decision' and body->>'action' in ('record', 'nonresponse')")) as [{ n: string }];
    expect(Number(decisions)).toBe(cases.reduce((n, c) => n + Object.keys(c.interview.answers).length, 0));
    const optedOut = cases.filter((c) => c.finalOutcome === "opt_out").map((c) => c.phone).sort();
    expect((await store.doNotCallList()).map((d) => d.phone).sort()).toEqual(optedOut);
    expect(await store.responseRecords(campaign.id)).toHaveLength(cases.filter((c) => Object.keys(c.interview.answers).length > 0).length);
  }, 120_000);
});
