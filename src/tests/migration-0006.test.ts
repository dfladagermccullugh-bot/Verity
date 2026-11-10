/**
 * Migration 0006 on PGlite: apply 0000–0005, seed the dirty rows the old
 * engine could produce, apply 0006, and check that it cleans what it may,
 * never loses respondent data, skips (does not force) an index whose
 * duplicates remain, and is idempotent.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/lib/db/schema";
import { MIGRATIONS_DIR, migrationsUpTo } from "./helpers/pglite-db";

const INDEXES = [
  "sessions_invite_id_unique",
  "rounds_session_round_unique",
  "turns_session_step_unique",
  "turns_one_pending_per_session",
  "turns_round_id_idx",
];

const STATEMENTS = readFileSync(join(MIGRATIONS_DIR, "0006_state_invariants.sql"), "utf-8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

async function at0005() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: migrationsUpTo(6) });
  return { client, db };
}

async function applyAll(client: PGlite) {
  await migrate(drizzle(client, { schema }), { migrationsFolder: MIGRATIONS_DIR });
}

async function q<T = Record<string, unknown>>(client: PGlite, sql: string): Promise<T[]> {
  return (await client.query<T>(sql)).rows;
}

async function indexNames(client: PGlite): Promise<string[]> {
  const rows = await q<{ indexname: string }>(
    client,
    `select indexname from pg_indexes where schemaname = 'public' and indexname in (${INDEXES.map((i) => `'${i}'`).join(",")})`
  );
  return rows.map((r) => r.indexname).sort();
}

/** Respondent data that must survive: sessions, answered turns, rounds. */
async function snapshot(client: PGlite) {
  const [s] = await q<{ n: number }>(client, "select count(*)::int n from sessions");
  const answered = await q<{ id: string; answer: string; question_text: string }>(
    client,
    "select id, answer, question_text from turns where answer is not null order by id"
  );
  const rs = await q<{ id: string; prd_markdown: string | null }>(
    client,
    "select id, prd_markdown from rounds order by id"
  );
  return { sessions: s.n, answered, rounds: rs };
}

const ids = {
  invClean: "00000000-0000-4000-8000-000000000001",
  invDup: "00000000-0000-4000-8000-000000000002",
  legacy: "10000000-0000-4000-8000-000000000001",
  active2: "10000000-0000-4000-8000-000000000002",
  dirty: "10000000-0000-4000-8000-000000000003",
  dupA: "10000000-0000-4000-8000-000000000004",
  dupB: "10000000-0000-4000-8000-000000000005",
  r1: "20000000-0000-4000-8000-000000000001",
  r2a: "20000000-0000-4000-8000-000000000002",
  r2b: "20000000-0000-4000-8000-000000000003",
  r3: "20000000-0000-4000-8000-000000000004",
};

async function seedDirty(client: PGlite, opts: { duplicateSessions: boolean }) {
  const inv = (id: string, token: string) =>
    `insert into invites (id, token, invitee_name, expires_at) values ('${id}', '${token}', 'X', now() + interval '7 days')`;
  await client.exec(`
    ${inv(ids.invClean, "t-clean")};
    ${inv(ids.invDup, "t-dup")};
    ${inv("00000000-0000-4000-8000-000000000003", "t-legacy")};
    ${inv("00000000-0000-4000-8000-000000000004", "t-active2")};

    -- Legacy (pre-0003) completed session: no rounds, still "active".
    insert into sessions (id, invite_id, seed, skill_version, status, completed_at, prd_markdown)
      values ('${ids.legacy}', '00000000-0000-4000-8000-000000000003', 's', 'v', 'active', now(), '# PRD');
    insert into turns (session_id, step, question_text, answer) values ('${ids.legacy}', 1, 'Q?', 'yes');

    -- Mid-round-2 session: completed_at set by round 1, must stay active.
    insert into sessions (id, invite_id, seed, skill_version, status, completed_at, prd_markdown)
      values ('${ids.active2}', '00000000-0000-4000-8000-000000000004', 's', 'v', 'active', now(), '# PRD v1');
    insert into rounds (id, session_id, round_number, prd_version, status, prd_markdown)
      values ('${ids.r3}', '${ids.active2}', 1, 1, 'complete', '# PRD v1');

    -- Dirty session: duplicate round numbers (one with a PRD), surplus
    -- pending turns, and two answered turns at one step.
    insert into sessions (id, invite_id, seed, skill_version, status)
      values ('${ids.dirty}', '${ids.invClean}', 's', 'v', 'active');
    insert into rounds (id, session_id, round_number, prd_version, status, prd_markdown, started_at)
      values ('${ids.r1}', '${ids.dirty}', 1, 1, 'complete', '# PRD v1', now() - interval '3 hours'),
             ('${ids.r2a}', '${ids.dirty}', 2, 2, 'in_progress', null, now() - interval '2 hours'),
             ('${ids.r2b}', '${ids.dirty}', 2, 2, 'complete', '# PRD v2', now() - interval '1 hour');
    insert into turns (session_id, round_id, step, question_text, answer) values
      ('${ids.dirty}', '${ids.r1}', 1, 'Q1?', 'yes'),
      ('${ids.dirty}', '${ids.r1}', 2, 'Q2a?', 'no'),
      ('${ids.dirty}', '${ids.r1}', 2, 'Q2b?', 'yes'),
      ('${ids.dirty}', '${ids.r2a}', 3, 'P3a?', null),
      ('${ids.dirty}', '${ids.r2a}', 3, 'P3b?', null),
      ('${ids.dirty}', '${ids.r2b}', 4, 'P4?', null);
  `);
  if (opts.duplicateSessions) {
    // Two sessions for one invite: cannot be resolved without deleting a
    // session, so the unique index must be skipped.
    await client.exec(`
      insert into sessions (id, invite_id, seed, skill_version) values
        ('${ids.dupA}', '${ids.invDup}', 'a', 'v'),
        ('${ids.dupB}', '${ids.invDup}', 'b', 'v');
      insert into turns (session_id, step, question_text, answer) values
        ('${ids.dupA}', 1, 'A?', 'yes'), ('${ids.dupB}', 1, 'B?', 'no');
    `);
  }
}

describe("migration 0006", () => {
  it("applies cleanly to an empty database and creates every index", async () => {
    const { client } = await at0005();
    await applyAll(client);
    expect(await indexNames(client)).toEqual([...INDEXES].sort());
  }, 60_000);

  it("cleans dirty rows without losing respondent data", async () => {
    const { client } = await at0005();
    await seedDirty(client, { duplicateSessions: false });
    const before = await snapshot(client);

    await applyAll(client);

    const after = await snapshot(client);
    expect(after.sessions).toBe(before.sessions);
    expect(after.answered).toEqual(before.answered);
    expect(after.rounds).toEqual(before.rounds); // every round kept, PRDs intact

    // Legacy session backfilled; the mid-round-2 session untouched.
    const statuses = await q<{ id: string; status: string }>(
      client,
      `select id, status from sessions where id in ('${ids.legacy}', '${ids.active2}') order by id`
    );
    expect(statuses).toEqual([
      { id: ids.legacy, status: "complete" },
      { id: ids.active2, status: "active" },
    ]);

    // One pending turn left: the displayed one (lowest step, then id).
    const pending = await q<{ question_text: string }>(
      client,
      `select question_text from turns where session_id = '${ids.dirty}' and answer is null`
    );
    expect(pending).toHaveLength(1);
    expect(["P3a?", "P3b?"]).toContain(pending[0].question_text);

    // Steps renumbered 1..n in order; answered before pending at a tie.
    const steps = await q<{ step: number; question_text: string; answer: string | null }>(
      client,
      `select step, question_text, answer from turns where session_id = '${ids.dirty}' order by step`
    );
    expect(steps.map((s) => s.step)).toEqual([1, 2, 3, 4]);
    expect(steps[0].question_text).toBe("Q1?");
    expect(steps.slice(1, 3).map((s) => s.question_text).sort()).toEqual(["Q2a?", "Q2b?"]);
    expect(steps[3].answer).toBeNull();

    // Round numbers renumbered by start time; versions untouched.
    const rs = await q<{ id: string; round_number: number }>(
      client,
      `select id, round_number from rounds where session_id = '${ids.dirty}' order by round_number`
    );
    expect(rs).toEqual([
      { id: ids.r1, round_number: 1 },
      { id: ids.r2a, round_number: 2 },
      { id: ids.r2b, round_number: 3 },
    ]);

    expect(await indexNames(client)).toEqual([...INDEXES].sort());
  }, 60_000);

  it("skips — does not force — an index whose duplicates remain", async () => {
    const { client } = await at0005();
    await seedDirty(client, { duplicateSessions: true });
    const before = await snapshot(client);

    await applyAll(client); // must not throw

    const names = await indexNames(client);
    expect(names).not.toContain("sessions_invite_id_unique");
    expect(names).toEqual(INDEXES.filter((i) => i !== "sessions_invite_id_unique").sort());
    const after = await snapshot(client);
    expect(after).toEqual(before);
    const dup = await q(client, `select id from sessions where invite_id = '${ids.invDup}'`);
    expect(dup).toHaveLength(2);
  }, 60_000);

  it("is idempotent: every statement can run again", async () => {
    const { client } = await at0005();
    await seedDirty(client, { duplicateSessions: true });
    await applyAll(client);
    const once = await snapshot(client);
    const stepsOnce = await q(client, "select id, step from turns order by id");

    for (const stmt of STATEMENTS) await client.exec(stmt);
    for (const stmt of STATEMENTS) await client.exec(stmt);

    expect(await snapshot(client)).toEqual(once);
    expect(await q(client, "select id, step from turns order by id")).toEqual(stepsOnce);
  }, 60_000);

  it("enforces the invariants once the indexes exist", async () => {
    const { client } = await at0005();
    await applyAll(client);
    await client.exec(`
      insert into invites (id, token, invitee_name, expires_at) values ('${ids.invClean}', 't', 'X', now());
      insert into sessions (id, invite_id, seed, skill_version) values ('${ids.dirty}', '${ids.invClean}', 's', 'v');
      insert into turns (session_id, step, question_text) values ('${ids.dirty}', 1, 'Q?');
    `);
    await expect(
      client.exec(
        `insert into sessions (invite_id, seed, skill_version) values ('${ids.invClean}', 's', 'v')`
      )
    ).rejects.toThrow(/sessions_invite_id_unique/);
    await expect(
      client.exec(`insert into turns (session_id, step, question_text) values ('${ids.dirty}', 2, 'Q2?')`)
    ).rejects.toThrow(/turns_one_pending_per_session/);
    await expect(
      client.exec(
        `insert into turns (session_id, step, question_text, answer) values ('${ids.dirty}', 1, 'Q?', 'yes')`
      )
    ).rejects.toThrow(/turns_session_step_unique/);
  }, 60_000);
});
