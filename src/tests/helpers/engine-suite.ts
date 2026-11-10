/**
 * Engine integration suite on PGlite with the repo's real migrations and a
 * mocked model. Shared so it can run against the full migration set and
 * against a schema without the 0006 unique indexes (the application-level
 * claims must hold either way). The calling test file declares the mocks.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { invites, rounds, sessions, turns } from "@/lib/db/schema";
import {
  advance,
  completeReviewedSession,
  createSessionForInvite,
  openFollowupRound,
  submitAnswer,
} from "@/lib/interview-engine";
import { STOP_CONFIRM } from "@/lib/guard";
import { holder, makeTestDb, truncateAll, type TestDb } from "./pglite-db";
import { DIMENSION_QUESTIONS, modelController, seedInvite, tick, wantsPrd } from "./engine-fixture";
import { PRD_REPLY } from "./scripted-model";

type Mocked = {
  model: ReturnType<typeof modelController>;
  oneShot: { mockReset(): void; mockResolvedValue(v: string): void; mockRejectedValue(e: unknown): void };
  email: { mockClear(): void; mock: { calls: unknown[][] } };
};

const PARADATA = { timeToAnswerMs: 1500, deviceClass: "desktop", viewport: "1280x800" };

export function engineSuite(label: string, migrationsFolder: () => string, m: Mocked) {
  describe(`interview engine on PGlite — ${label}`, () => {
    let db: TestDb;

    beforeAll(async () => {
      db = await makeTestDb(migrationsFolder());
      holder.db = db;
    }, 60_000);

    beforeEach(async () => {
      holder.db = db;
      await truncateAll(db);
      m.model.reset();
      m.oneShot.mockReset();
      m.oneShot.mockResolvedValue(
        JSON.stringify({ openNewRound: true, gaps: ["pricing"], focus: "Probe pricing." })
      );
      m.email.mockClear();
    });

    async function start() {
      const invite = await seedInvite(db);
      const session = await createSessionForInvite(invite.id, {
        seed: "A water bottle that nudges you to drink.",
        skillVersion: "test",
      });
      return { invite, session };
    }

    async function pendingOf(sessionId: string) {
      return db
        .select()
        .from(turns)
        .where(and(eq(turns.sessionId, sessionId), isNull(turns.answer)));
    }

    async function sessionRow(id: string) {
      const [s] = await db.select().from(sessions).where(eq(sessions.id, id));
      return s;
    }

    /** Answer every question "yes" until the round finalizes. */
    async function runRound(sessionId: string, first: { turnId: string }) {
      let r: Awaited<ReturnType<typeof submitAnswer>> | { kind: "question"; turnId: string } = {
        kind: "question",
        turnId: first.turnId,
      };
      for (let i = 0; i < 50 && r.kind === "question"; i++) {
        r = await submitAnswer(sessionId, r.turnId, "yes", PARADATA);
      }
      return r;
    }

    it("runs a full round: questions, coverage, PRD, awaiting_review, email, critic", async () => {
      const { session } = await start();
      const q1 = await advance(session.id);
      expect(q1).toMatchObject({ kind: "question", text: DIMENSION_QUESTIONS[0], answeredInRound: 0 });
      if (q1.kind !== "question") return;

      const end = await runRound(session.id, q1);
      expect(end.kind).toBe("done");

      const s = await sessionRow(session.id);
      expect(s.status).toBe("awaiting_review");
      expect(s.prdMarkdown).toContain("# One-line pitch");
      const [r] = await db.select().from(rounds).where(eq(rounds.sessionId, session.id));
      expect(r.status).toBe("complete");
      expect(r.terminationReason).toBe("forced_prd");
      expect(r.criticRecommendOpen).toBe(true);
      expect(r.criticFocus).toBe("Probe pricing.");
      expect(r.methodologyMarkdown).toContain("## Round termination");
      expect(m.email.mock.calls).toHaveLength(1);
      const ts = await db.select().from(turns).where(eq(turns.sessionId, session.id));
      expect(ts).toHaveLength(DIMENSION_QUESTIONS.length);
      expect(ts.every((t) => t.answer === "yes" && t.timeToAnswerMs === 1500)).toBe(true);
    });

    it("advance is idempotent: a second call returns the same pending turn", async () => {
      const { session } = await start();
      const a = await advance(session.id);
      const b = await advance(session.id);
      expect(a).toEqual(b);
      expect(m.model.fn).toHaveBeenCalledTimes(1);
    });

    it("recovers when the model throws after the answer was claimed", async () => {
      const { session } = await start();
      const q1 = await advance(session.id);
      if (q1.kind !== "question") throw new Error("expected question");

      m.model.set(() => {
        throw new Error("model down");
      });
      await expect(submitAnswer(session.id, q1.turnId, "yes", PARADATA)).rejects.toThrow(
        "model down"
      );
      // Stranded: answer saved, no pending turn, session still active.
      expect(await pendingOf(session.id)).toHaveLength(0);
      expect((await sessionRow(session.id)).status).toBe("active");

      m.model.reset();
      const resumed = await advance(session.id);
      expect(resumed).toMatchObject({ kind: "question", text: DIMENSION_QUESTIONS[1], answeredInRound: 1 });
    });

    it("recovers when the first generation dies after the session row was inserted", async () => {
      const { session } = await start();
      m.model.set(() => {
        throw new Error("timeout");
      });
      await expect(advance(session.id)).rejects.toThrow("timeout");
      m.model.reset();
      const q1 = await advance(session.id);
      expect(q1).toMatchObject({ kind: "question", text: DIMENSION_QUESTIONS[0] });
      const rs = await db.select().from(rounds).where(eq(rounds.sessionId, session.id));
      expect(rs).toHaveLength(1);
    });

    it("two answers to one turn produce exactly one next turn", async () => {
      const { session } = await start();
      const q1 = await advance(session.id);
      if (q1.kind !== "question") throw new Error("expected question");

      // Slow model so both requests overlap around the model call.
      m.model.set(async (msgs) => {
        await tick(20);
        const asked = msgs.filter((x) => x.role === "assistant").length;
        return DIMENSION_QUESTIONS[asked];
      });
      const [a, b] = await Promise.all([
        submitAnswer(session.id, q1.turnId, "yes", PARADATA),
        submitAnswer(session.id, q1.turnId, "no", PARADATA),
      ]);
      expect([a.stale, b.stale].sort()).toEqual([false, true]);
      expect(a.kind === "question" && b.kind === "question" && a.turnId === b.turnId).toBe(true);
      const ts = await db.select().from(turns).where(eq(turns.sessionId, session.id));
      expect(ts).toHaveLength(2);
      expect(ts.filter((t) => t.answer == null)).toHaveLength(1);
      expect(new Set(ts.map((t) => t.step)).size).toBe(2);
    });

    it("a stale tab answering an old turn changes nothing", async () => {
      const { session } = await start();
      const q1 = await advance(session.id);
      if (q1.kind !== "question") throw new Error("expected question");
      const q2 = await submitAnswer(session.id, q1.turnId, "yes", PARADATA);
      if (q2.kind !== "question") throw new Error("expected question");

      const stale = await submitAnswer(session.id, q1.turnId, "no", PARADATA);
      expect(stale).toMatchObject({ kind: "question", turnId: q2.turnId, stale: true });
      const [t1] = await db.select().from(turns).where(eq(turns.id, q1.turnId));
      expect(t1.answer).toBe("yes");
      expect(await pendingOf(session.id)).toHaveLength(1);
    });

    it("an answer for another session's turn is refused", async () => {
      const a = await start();
      const b = await start();
      const qa = await advance(a.session.id);
      await advance(b.session.id);
      if (qa.kind !== "question") throw new Error("expected question");
      const r = await submitAnswer(b.session.id, qa.turnId, "yes", PARADATA);
      expect(r.stale).toBe(true);
      const [t] = await db.select().from(turns).where(eq(turns.id, qa.turnId));
      expect(t.answer).toBeNull();
    });

    it("two concurrent starts for one invite create one session", async () => {
      const invite = await seedInvite(db);
      const values = { seed: "A bottle.", skillVersion: "test" };
      const made = await Promise.all([
        createSessionForInvite(invite.id, values),
        createSessionForInvite(invite.id, values),
        createSessionForInvite(invite.id, values),
      ]);
      expect(new Set(made.map((s) => s.id)).size).toBe(1);
      const all = await db.select().from(sessions).where(eq(sessions.inviteId, invite.id));
      expect(all).toHaveLength(1);
    });

    it("refuses to complete a session that is still active", async () => {
      const { session, invite } = await start();
      await advance(session.id);
      const r = await completeReviewedSession(session.id);
      expect(r.ok).toBe(false);
      expect((await sessionRow(session.id)).status).toBe("active");
      const [inv] = await db.select().from(invites).where(eq(invites.id, invite.id));
      expect(inv.consumedAt).toBeNull();
    });

    it("completes a reviewed session and consumes the invite atomically", async () => {
      const { session, invite } = await start();
      const q1 = await advance(session.id);
      if (q1.kind !== "question") throw new Error("expected question");
      await submitAnswer(session.id, q1.turnId, "done", PARADATA);
      expect((await completeReviewedSession(session.id)).ok).toBe(true);
      expect((await sessionRow(session.id)).status).toBe("complete");
      const [inv] = await db.select().from(invites).where(eq(invites.id, invite.id));
      expect(inv.consumedAt).not.toBeNull();
      // Answering after completion is a no-op.
      expect((await advance(session.id)).kind).toBe("done");
    });

    it("'done' finalizes with done_by_user", async () => {
      const { session } = await start();
      const q1 = await advance(session.id);
      if (q1.kind !== "question") throw new Error("expected question");
      expect((await submitAnswer(session.id, q1.turnId, "done", PARADATA)).kind).toBe("done");
      const [r] = await db.select().from(rounds).where(eq(rounds.sessionId, session.id));
      expect(r.terminationReason).toBe("done_by_user");
    });

    it("two concurrent openFollowupRound calls open one round", async () => {
      const { session } = await start();
      const q1 = await advance(session.id);
      if (q1.kind !== "question") throw new Error("expected question");
      await runRound(session.id, q1);

      m.model.set(async (msgs) => {
        await tick(20);
        return wantsPrd(msgs) ? PRD_REPLY : "Is the price important?";
      });
      const [a, b] = await Promise.all([openFollowupRound(session.id), openFollowupRound(session.id)]);
      expect(a.ok && b.ok).toBe(true);
      const rs = await db.select().from(rounds).where(eq(rounds.sessionId, session.id));
      expect(rs.map((r) => r.roundNumber).sort()).toEqual([1, 2]);
      expect(await pendingOf(session.id)).toHaveLength(1);
      expect((await sessionRow(session.id)).status).toBe("active");
    });

    it("writes nothing when the follow-up produces no question", async () => {
      const { session } = await start();
      const q1 = await advance(session.id);
      if (q1.kind !== "question") throw new Error("expected question");
      await runRound(session.id, q1);
      m.model.set(() => STOP_CONFIRM);
      const r = await openFollowupRound(session.id);
      expect(r.ok).toBe(false);
      const rs = await db.select().from(rounds).where(eq(rounds.sessionId, session.id));
      expect(rs).toHaveLength(1);
      expect((await sessionRow(session.id)).status).toBe("awaiting_review");
    });

    it("steers follow-up rounds on every turn and gates coverage session-wide", async () => {
      const { session } = await start();
      const q1 = await advance(session.id);
      if (q1.kind !== "question") throw new Error("expected question");
      await runRound(session.id, q1); // covers all 10 dimensions in round 1

      m.model.reset();
      let stopNow = false;
      m.model.set((msgs) => {
        if (wantsPrd(msgs)) return PRD_REPLY;
        return stopNow ? STOP_CONFIRM : "Is the price important?";
      });
      expect((await openFollowupRound(session.id)).ok).toBe(true);
      const first = m.model.calls[m.model.calls.length - 1];
      expect(first[first.length - 1].content).toMatch(/focus on next: Probe pricing\./);

      const r2 = await advance(session.id);
      if (r2.kind !== "question") throw new Error("expected question");
      const r2q2 = await submitAnswer(session.id, r2.turnId, "yes", PARADATA);
      if (r2q2.kind !== "question") throw new Error("expected question");
      // The second turn of the round is steered too.
      const second = m.model.calls[m.model.calls.length - 1];
      expect(second[second.length - 1].content).toMatch(/focus on next: Probe pricing\./);

      // Session-wide coverage is met (round 1), so a stop is honoured at once.
      stopNow = true;
      const before = m.model.calls.length;
      expect((await submitAnswer(session.id, r2q2.turnId, "no", PARADATA)).kind).toBe("done");
      // One generation (stop) + one PRD call: no coverage nudge.
      expect(m.model.calls.length - before).toBe(2);

      const rs = await db.select().from(rounds).where(eq(rounds.sessionId, session.id));
      const round2 = rs.find((r) => r.roundNumber === 2)!;
      expect(round2.focusBrief).toBe("Probe pricing.");
      expect(round2.prdVersion).toBe(2);
      expect(round2.terminationReason).toBe("forced_prd");
    });

    it("takes the follow-up focus and version from the latest PRD-bearing round", async () => {
      const { session } = await start();
      const q1 = await advance(session.id);
      if (q1.kind !== "question") throw new Error("expected question");
      await runRound(session.id, q1);

      // Round 2 fails to produce a PRD.
      m.model.set((msgs) => (wantsPrd(msgs) ? "I cannot." : "Is the price important?"));
      expect((await openFollowupRound(session.id)).ok).toBe(true);
      const r2 = await advance(session.id);
      if (r2.kind !== "question") throw new Error("expected question");
      expect((await submitAnswer(session.id, r2.turnId, "done", PARADATA)).kind).toBe("done");

      let rs = await db.select().from(rounds).where(eq(rounds.sessionId, session.id));
      const failed = rs.find((r) => r.roundNumber === 2)!;
      expect(failed.terminationReason).toBe("prd_failed");
      expect(failed.prdMarkdown).toBeNull();
      expect(failed.criticFocus).toBeNull();
      const s = await sessionRow(session.id);
      expect(s.status).toBe("awaiting_review");
      expect(s.prdMarkdown).toContain("# One-line pitch"); // v1 mirror kept
      expect(m.email.mock.calls).toHaveLength(1); // no email for the failed round

      m.model.reset();
      m.model.set((msgs) => (wantsPrd(msgs) ? PRD_REPLY : "Is the price important?"));
      expect((await openFollowupRound(session.id)).ok).toBe(true);
      const last = m.model.calls[m.model.calls.length - 1];
      expect(last[last.length - 1].content).toMatch(/Probe pricing\./); // round 1's focus
      rs = await db.select().from(rounds).where(eq(rounds.sessionId, session.id));
      const round3 = rs.find((r) => r.roundNumber === 3)!;
      expect(round3.prdVersion).toBe(2); // no version skipped
    });

    it("leaves the critic verdict null when the critic fails", async () => {
      m.oneShot.mockRejectedValue(new Error("critic down"));
      const { session } = await start();
      const q1 = await advance(session.id);
      if (q1.kind !== "question") throw new Error("expected question");
      await submitAnswer(session.id, q1.turnId, "done", PARADATA);
      const [r] = await db.select().from(rounds).where(eq(rounds.sessionId, session.id));
      expect(r.status).toBe("complete");
      expect(r.criticRecommendOpen).toBeNull();
      expect(r.criticFocus).toBeNull();
    });

    it("records guard_exhausted when every attempt and the nudge are rejected", async () => {
      const { session } = await start();
      const q1 = await advance(session.id);
      if (q1.kind !== "question") throw new Error("expected question");
      m.model.set((msgs) => (wantsPrd(msgs) ? PRD_REPLY : "Should it use a database?"));
      expect((await submitAnswer(session.id, q1.turnId, "yes", PARADATA)).kind).toBe("done");
      const [r] = await db.select().from(rounds).where(eq(rounds.sessionId, session.id));
      expect(r.terminationReason).toBe("guard_exhausted");
      expect(r.methodologyMarkdown).toContain("`jargon:database`");
    });

    it("tags the session's opening mirror turn and keeps it out of coverage", async () => {
      const { session } = await start();
      m.model.set((msgs) => {
        if (wantsPrd(msgs)) return PRD_REPLY;
        const asked = msgs.filter((x) => x.role === "assistant").length;
        if (asked === 0) return "You want a bottle that reminds you to drink. Ready?";
        return DIMENSION_QUESTIONS[asked - 1] ?? STOP_CONFIRM;
      });
      const q1 = await advance(session.id);
      if (q1.kind !== "question") throw new Error("expected question");
      const [t1] = await db.select().from(turns).where(eq(turns.id, q1.turnId));
      expect(t1.constructDimension).toBe("mirror");
    });

    it("finalizes at the runaway ceiling", async () => {
      const { session } = await start();
      m.model.set((msgs) => (wantsPrd(msgs) ? PRD_REPLY : "Is anything else unclear?"));
      const q1 = await advance(session.id);
      if (q1.kind !== "question") throw new Error("expected question");
      const end = await runRound(session.id, q1);
      expect(end.kind).toBe("done");
      const [r] = await db.select().from(rounds).where(eq(rounds.sessionId, session.id));
      expect(r.terminationReason).toBe("ceiling");
      const ts = await db.select().from(turns).where(eq(turns.sessionId, session.id));
      expect(ts).toHaveLength(40);
    }, 30_000);
  });
}
