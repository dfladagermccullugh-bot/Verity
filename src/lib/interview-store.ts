/**
 * Query helpers for the interview state, each taking an executor (`db` or a
 * transaction) so the engine can run the same reads inside a claim.
 *
 * Every state change is a short transaction that first locks the owning row
 * (`SELECT … FOR UPDATE` on the session, or the invite when creating a
 * session), re-checks the precondition, then writes. That serializes writers
 * per session at the application level, so the invariants hold even where a
 * unique index from migration 0006 could not be created. Never hold a
 * transaction across a model call: the pool has a single connection.
 */
import { and, asc, eq, isNull, sql, type ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./db/schema";
import { rounds, sessions, turns, invites, type Round, type Session, type Turn } from "./db/schema";
import type { Answer } from "./lifecycle";

export type Executor = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/** Lock and return the session row (inside a transaction). */
export async function lockSession(ex: Executor, sessionId: string): Promise<Session | null> {
  const [row] = await ex.select().from(sessions).where(eq(sessions.id, sessionId)).for("update");
  return row ?? null;
}

/** Lock and return the invite row (inside a transaction). */
export async function lockInvite(ex: Executor, inviteId: string) {
  const [row] = await ex.select().from(invites).where(eq(invites.id, inviteId)).for("update");
  return row ?? null;
}

export async function getSession(ex: Executor, sessionId: string): Promise<Session | null> {
  const [row] = await ex.select().from(sessions).where(eq(sessions.id, sessionId));
  return row ?? null;
}

/** The session for an invite. Oldest first, so a duplicate (possible only
 *  where the unique index was skipped) never shadows the original. */
export async function sessionForInvite(ex: Executor, inviteId: string): Promise<Session | null> {
  const [row] = await ex
    .select()
    .from(sessions)
    .where(eq(sessions.inviteId, inviteId))
    .orderBy(asc(sessions.startedAt), asc(sessions.id))
    .limit(1);
  return row ?? null;
}

/** All turns for a session, across rounds, in step order. */
export async function listTurns(ex: Executor, sessionId: string): Promise<Turn[]> {
  return ex
    .select()
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .orderBy(asc(turns.step), asc(turns.id));
}

/** All rounds for a session, in round order. */
export async function listRounds(ex: Executor, sessionId: string): Promise<Round[]> {
  return ex
    .select()
    .from(rounds)
    .where(eq(rounds.sessionId, sessionId))
    .orderBy(asc(rounds.roundNumber), asc(rounds.startedAt), asc(rounds.id));
}

/** The displayed (unanswered) turn, if any. Deterministic order. */
export async function findPendingTurn(ex: Executor, sessionId: string): Promise<Turn | null> {
  const [row] = await ex
    .select()
    .from(turns)
    .where(and(eq(turns.sessionId, sessionId), isNull(turns.answer)))
    .orderBy(asc(turns.step), asc(turns.id))
    .limit(1);
  return row ?? null;
}

export interface AnswerWrite {
  answer: Answer;
  timeToAnswerMs: number | null;
  deviceClass: string | null;
  viewport: string | null;
}

/**
 * Claim a pending turn with an answer: one conditional UPDATE. Succeeds only
 * if the turn belongs to the session, is still unanswered, and the session is
 * active. Returns null for a stale or duplicate answer.
 */
export async function claimAnswer(
  ex: Executor,
  sessionId: string,
  turnId: string,
  write: AnswerWrite
): Promise<Turn | null> {
  const [row] = await ex
    .update(turns)
    .set(write)
    .where(
      and(
        eq(turns.id, turnId),
        eq(turns.sessionId, sessionId),
        isNull(turns.answer),
        sql`exists (select 1 from ${sessions} where ${sessions.id} = ${turns.sessionId} and ${sessions.status} = 'active')`
      )
    )
    .returning();
  return row ?? null;
}

/** Highest step in a turn list (0 when empty). */
export function maxStep(all: Turn[]): number {
  return all.reduce((m, t) => Math.max(m, t.step), 0);
}
