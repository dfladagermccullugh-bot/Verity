import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { invites, rounds, sessions, turns, type Round, type Session, type Turn } from "./db/schema";
import { callModel, type ChatMessage } from "./anthropic";
import { MIRROR_DIMENSION, classifyDimension, isMirrorQuestion } from "./dimensions";
import { computeAnalysis } from "./analysis";
import {
  RUNAWAY_CEILING,
  enforceCoverage,
  forcePrd,
  generateNextShape,
  type GenResult,
  type ModelFn,
  type NextShape,
} from "./interview-policy";
import type { CoverageTurn } from "./coverage";
import { latestPrdRound, type Answer, type TerminationReason } from "./lifecycle";
import { critiqueRound } from "./critic";
import { sendPrdEmail } from "./email";
import {
  buildPrdHeader,
  buildMethodologyDocument,
  buildAnalysisDocument,
  type TerminationDiagnostics,
} from "./disclosure";
import { buildConstructBrief } from "./construct-brief";
import {
  claimAnswer,
  findPendingTurn,
  getSession,
  listRounds,
  listTurns,
  lockInvite,
  lockSession,
  maxStep,
  sessionForInvite,
  type Executor,
} from "./interview-store";

/**
 * The interview engine: claim, then re-entrant advance.
 *
 *  - `submitAnswer` claims the displayed turn with one conditional UPDATE.
 *  - `advance` is idempotent: it reads the state and either returns the
 *    pending turn, or generates the next turn / finalizes the round and
 *    claims that write in a short transaction (session row locked, the
 *    precondition re-checked). A lost claim just re-reads the state.
 *
 * Because `advance` derives everything from the database, it is also the
 * recovery path: a request that died between the answer and the next turn
 * leaves a session that the next call to `advance` simply picks up.
 *
 * Model calls never run inside a transaction (the pool has one connection).
 */

export { RUNAWAY_CEILING } from "./interview-policy";

/** The interview model, bound for the policy module. */
const model: ModelFn = (messages) => callModel(messages);

/** Engine database handle (the typed executor view of `db`). */
const dbx = db as unknown as Executor;

/** Paradata captured alongside each answer (Survey Methodology §15). */
export interface AnswerParadata {
  timeToAnswerMs: number | null;
  deviceClass?: string | null;
  viewport?: string | null;
}

export type StepResult =
  | { kind: "question"; turnId: string; text: string; answeredInRound: number }
  | { kind: "done" };

/** Maximum claim attempts per `advance` before giving up for this request. */
const MAX_ADVANCE_PASSES = 4;

// ── Pure helpers ────────────────────────────────────────────────────────────

/** Build the model conversation from the seed + already-answered turns. */
function messagesFromTurns(seed: string, allTurns: Turn[]): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "user", content: seed }];
  for (const t of allTurns) {
    if (t.answer == null) continue; // pending (unanswered) turn — not part of history yet
    messages.push({ role: "assistant", content: t.questionText });
    messages.push({ role: "user", content: t.answer });
  }
  return messages;
}

/** The steering note for a follow-up round, re-injected on every turn. */
function focusNote(focus: string | null): ChatMessage {
  return {
    role: "user",
    content: focus
      ? `(Continue the interview. The analyst flagged these gaps to focus on next: ${focus} Ask the next single yes/no question.)`
      : `(Continue the interview with another round of questions. Ask the next single yes/no question about anything still unclear.)`,
  };
}

/** Termination reason for a non-question shape. */
function stopReason(shape: NextShape, firstTurn: boolean): TerminationReason {
  if (shape.kind === "prd") return "model_prd";
  if (shape.kind === "exhausted") return "guard_exhausted";
  return firstTurn ? "degenerate" : "forced_prd";
}

function answered(t: Turn): boolean {
  return t.answer != null;
}

function questionResult(turn: Turn, all: Turn[]): StepResult {
  return {
    kind: "question",
    turnId: turn.id,
    text: turn.questionText,
    answeredInRound: all.filter((t) => t.roundId === turn.roundId && answered(t)).length,
  };
}

/** Turn metadata computed at insert time. */
function turnValues(
  session: Session,
  round: Round,
  step: number,
  text: string,
  gen: GenResult,
  answeredInRound: Turn[]
): typeof turns.$inferInsert {
  // The skill's opening "mirror … Ready?" turn is protocol, not measurement:
  // tagged so coverage and the analysis exclude it.
  const dimension =
    step === 1 && isMirrorQuestion(text) ? MIRROR_DIMENSION : classifyDimension(text);
  return {
    sessionId: session.id,
    roundId: round.id,
    step,
    questionText: text,
    answer: null,
    timeToAnswerMs: null,
    constructDimension: dimension,
    regenCount: gen.regenCount,
    guardRejections: JSON.stringify(gen.guardRejections),
    leadingVerdict: gen.leadingRewrites > 0 ? "rewritten" : "clean",
    isTriangulationProbe: answeredInRound.some((t) => t.constructDimension === dimension),
    deviceClass: null,
    viewport: null,
  };
}

// ── State ───────────────────────────────────────────────────────────────────

interface State {
  session: Session;
  rounds: Round[];
  turns: Turn[];
  pending: Turn | null;
}

async function readState(ex: Executor, sessionId: string): Promise<State | null> {
  const session = await getSession(ex, sessionId);
  if (!session) return null;
  const rs = await listRounds(ex, sessionId);
  const ts = await listTurns(ex, sessionId);
  return { session, rounds: rs, turns: ts, pending: ts.find((t) => !answered(t)) ?? null };
}

/** The round being driven: the pending turn's, else the latest open one. */
function openRoundOf(st: State): Round | null {
  const pendingRoundId = st.pending?.roundId;
  if (pendingRoundId) {
    const r = st.rounds.find((x) => x.id === pendingRoundId);
    if (r) return r;
  }
  for (let i = st.rounds.length - 1; i >= 0; i--)
    if (st.rounds[i].status === "in_progress") return st.rounds[i];
  return null;
}

// ── Planning (model calls, no writes) ───────────────────────────────────────

type Plan =
  | { kind: "question"; text: string; gen: GenResult }
  | { kind: "conclude"; markdown: string | null; termination: TerminationDiagnostics };

/** Decide the next step for an open round with no pending turn. */
async function plan(st: State, round: Round): Promise<Plan> {
  const inRound = st.turns.filter((t) => t.roundId === round.id && answered(t));
  const answeredAll = st.turns.filter(answered);
  const last = answeredAll[answeredAll.length - 1] ?? null;
  const messages = messagesFromTurns(st.session.seed, st.turns);

  // Invitee asked to finish, or runaway ceiling reached → straight to PRD.
  if (last && last.roundId === round.id && last.answer === "done")
    return conclude(messages, "done_by_user", null, []);
  if (inRound.length >= RUNAWAY_CEILING) return conclude(messages, "ceiling", null, []);

  // Follow-up rounds carry their focus on every turn, not just the first.
  const genMessages =
    round.roundNumber > 1 ? [...messages, focusNote(round.focusBrief)] : messages;
  let gen = await generateNextShape(model, genMessages);
  let rejections = gen.guardRejections;
  // Coverage gate, session-wide: a follow-up round is not forced to re-cover
  // the dimensions earlier rounds already covered.
  if (gen.shape.kind !== "question") {
    const coverage: CoverageTurn[] = answeredAll;
    const cov = await enforceCoverage(model, genMessages, coverage, gen);
    rejections = [...gen.guardRejections, ...(cov.nudge?.guardRejections ?? [])];
    gen = cov.gen;
  }
  if (gen.shape.kind === "question") return { kind: "question", text: gen.shape.text, gen };

  return conclude(messages, stopReason(gen.shape, inRound.length === 0), gen, rejections);
}

/** Obtain the PRD (unless the model already wrote it). A PRD that cannot be
 *  obtained fails the round (`prd_failed`) instead of storing arbitrary text. */
async function conclude(
  messages: ChatMessage[],
  reason: TerminationReason,
  gen: GenResult | null,
  guardRejections: string[]
): Promise<Plan> {
  if (gen?.shape.kind === "prd")
    return {
      kind: "conclude",
      markdown: gen.shape.markdown,
      termination: { reason, guardRejections, prdRejections: [], prdVia: "model" },
    };
  const r = await forcePrd(model, messages);
  return {
    kind: "conclude",
    markdown: r.ok ? r.markdown : null,
    termination: {
      reason: r.ok ? reason : "prd_failed",
      guardRejections,
      prdRejections: r.rejections,
      prdVia: r.ok ? r.via : null,
    },
  };
}

// ── Claims (short transactions, no model calls) ─────────────────────────────

function asExecutor(tx: unknown): Executor {
  return tx as Executor;
}

/**
 * Insert the next question if the state is still the one it was planned from:
 * session active, round open, no pending turn, same max step. Returns the
 * pending turn (ours, or one a concurrent writer inserted first), or null if
 * the state moved and the caller should re-read.
 */
async function claimQuestion(
  st: State,
  round: Round,
  text: string,
  gen: GenResult
): Promise<Turn | null> {
  return db.transaction(async (tx) => {
    const ex = asExecutor(tx);
    const s = await lockSession(ex, st.session.id);
    if (!s || s.status !== "active") return null;
    const pending = await findPendingTurn(ex, s.id);
    if (pending) return pending;
    const [r] = await ex
      .select()
      .from(rounds)
      .where(and(eq(rounds.id, round.id), eq(rounds.status, "in_progress")));
    if (!r) return null;
    const current = await listTurns(ex, s.id);
    if (maxStep(current) !== maxStep(st.turns)) return null;
    const inRound = current.filter((t) => t.roundId === r.id && answered(t));
    const [row] = await ex
      .insert(turns)
      .values(turnValues(s, r, maxStep(current) + 1, text, gen, inRound))
      .returning();
    return row;
  });
}

interface Finalized {
  session: Session;
  round: Round;
  roundTurns: Turn[];
  prdMarkdown: string | null;
  methodologyMarkdown: string;
  analysisMarkdown: string;
}

/**
 * Freeze the round's documents and move the session to `awaiting_review`, in
 * one transaction, if the state is still the one it was planned from. Returns
 * null if another writer got there first.
 */
async function claimFinalize(
  st: State,
  round: Round,
  markdown: string | null,
  termination: TerminationDiagnostics
): Promise<Finalized | null> {
  const roundTurns = st.turns.filter((t) => t.roundId === round.id);
  const analysis = computeAnalysis(
    roundTurns.map((t) => ({
      answer: t.answer,
      timeToAnswerMs: t.timeToAnswerMs,
      constructDimension: t.constructDimension,
      leadingVerdict: t.leadingVerdict,
    }))
  );
  const analysisMarkdown = buildAnalysisDocument({
    sessionId: st.session.id,
    analysis,
    prdVersion: round.prdVersion,
  });
  const prdMarkdown =
    markdown == null ? null : buildPrdHeader({ sessionId: st.session.id }) + markdown;
  const methodologyMarkdown = buildMethodologyDocument({
    sessionId: st.session.id,
    constructBriefPresent: !!st.session.constructBrief,
    prdVersion: round.prdVersion,
    analysisPresent: true,
    termination,
  });

  return db.transaction(async (tx) => {
    const ex = asExecutor(tx);
    const s = await lockSession(ex, st.session.id);
    if (!s || s.status !== "active") return null;
    if (await findPendingTurn(ex, s.id)) return null;
    const current = await listTurns(ex, s.id);
    if (maxStep(current) !== maxStep(st.turns)) return null;
    const now = new Date();
    const [r] = await ex
      .update(rounds)
      .set({
        status: "complete",
        terminationReason: termination.reason as TerminationReason,
        completedAt: now,
        prdMarkdown,
        methodologyMarkdown,
        analysisMarkdown,
      })
      .where(and(eq(rounds.id, round.id), eq(rounds.status, "in_progress")))
      .returning();
    if (!r) return null;
    // Mirror the latest version onto the session for the existing routes. A
    // failed round (no PRD) leaves the previous version's mirror in place.
    const [updated] = await ex
      .update(sessions)
      .set({
        ...(prdMarkdown != null ? { prdMarkdown, methodologyMarkdown } : {}),
        completedAt: now,
        abandonedAtStep: null,
        status: "awaiting_review",
      })
      .where(and(eq(sessions.id, s.id), eq(sessions.status, "active")))
      .returning();
    return {
      session: updated,
      round: r,
      roundTurns,
      prdMarkdown,
      methodologyMarkdown,
      analysisMarkdown,
    };
  });
}

/**
 * After the finalize commit: email the version, then run the advisory critic.
 * Both are best-effort; neither can change the session state. A critic that
 * fails leaves the verdict null ("not assessed"), never "no round needed".
 */
async function afterFinalize(f: Finalized, rawMarkdown: string | null): Promise<void> {
  if (f.prdMarkdown == null || rawMarkdown == null) return; // failed round
  try {
    const [invite] = await db.select().from(invites).where(eq(invites.id, f.session.inviteId));
    await sendPrdEmail({
      inviteeName: invite?.inviteeName ?? "Unknown",
      seed: f.session.seed,
      sessionId: f.session.id,
      prdVersion: f.round.prdVersion,
      prdMarkdown: f.prdMarkdown,
      methodologyMarkdown: f.methodologyMarkdown,
      analysisMarkdown: f.analysisMarkdown,
    });
  } catch (err) {
    console.error("PRD email failed", err);
  }
  try {
    const transcript = f.roundTurns
      .filter((t) => t.answer != null && t.answer !== "done")
      .map((t) => `Q${t.step}: ${t.questionText}\nA: ${t.answer}`)
      .join("\n");
    const critique = await critiqueRound(f.session.seed, transcript, rawMarkdown);
    if (critique) {
      await db
        .update(rounds)
        .set({
          criticRecommendOpen: critique.openNewRound,
          criticGaps: JSON.stringify(critique.gaps),
          criticFocus: critique.focus,
        })
        .where(eq(rounds.id, f.round.id));
    }
  } catch (err) {
    console.error("Critic failed", err);
  }
}

/** Open round 1 if the session has no round yet (the seed was saved but the
 *  first generation never ran or died). */
async function claimFirstRound(sessionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const ex = asExecutor(tx);
    const s = await lockSession(ex, sessionId);
    if (!s || s.status !== "active") return;
    if ((await listRounds(ex, sessionId)).length > 0) return;
    await ex
      .insert(rounds)
      .values({ sessionId, roundNumber: 1, prdVersion: 1, status: "in_progress" });
  });
}

/**
 * Best-effort sidecar call: run the construct-validity probe and persist the
 * brief on the session. Never throws.
 */
async function persistConstructBrief(session: Session): Promise<void> {
  try {
    const brief = await buildConstructBrief(session.seed);
    if (brief) {
      await db
        .update(sessions)
        .set({ constructBrief: brief })
        .where(and(eq(sessions.id, session.id), isNull(sessions.constructBrief)));
    }
  } catch {
    // Swallow — the interview must proceed even if the auditor call fails.
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Idempotent, re-entrant step. Returns the pending question if there is one;
 * otherwise generates and claims the next turn or finalizes the round.
 * Returns `done` when the session is not active (awaiting review, complete).
 */
export async function advance(sessionId: string): Promise<StepResult> {
  for (let pass = 0; pass < MAX_ADVANCE_PASSES; pass++) {
    const st = await readState(dbx, sessionId);
    if (!st || st.session.status !== "active") return { kind: "done" };
    if (st.pending) return questionResult(st.pending, st.turns);

    const round = openRoundOf(st);
    if (!round) {
      // Legacy (pre-rounds) sessions carry a PRD but no rounds: nothing to drive.
      if (st.rounds.length > 0 || st.session.prdMarkdown) return { kind: "done" };
      if (!st.session.constructBrief) await persistConstructBrief(st.session);
      await claimFirstRound(sessionId);
      continue;
    }

    const next = await plan(st, round);
    if (next.kind === "question") {
      const turn = await claimQuestion(st, round, next.text, next.gen);
      if (turn) return questionResult(turn, await listTurns(dbx, sessionId));
      continue; // state moved under us — re-read
    }
    const fin = await claimFinalize(st, round, next.markdown, next.termination);
    if (fin) {
      await afterFinalize(fin, next.markdown);
      return { kind: "done" };
    }
  }
  // Still contended after several passes: report whatever is current.
  const pending = await findPendingTurn(dbx, sessionId);
  if (pending) return questionResult(pending, await listTurns(dbx, sessionId));
  throw new Error("The interview is busy — please try again.");
}

/**
 * Create the session for an invite, or return the existing one. The invite
 * row is locked, so concurrent starts yield exactly one session.
 */
export async function createSessionForInvite(
  inviteId: string,
  values: Omit<typeof sessions.$inferInsert, "inviteId">
): Promise<Session> {
  return db.transaction(async (tx) => {
    const ex = asExecutor(tx);
    await lockInvite(ex, inviteId);
    const existing = await sessionForInvite(ex, inviteId);
    if (existing) return existing;
    const [row] = await ex
      .insert(sessions)
      .values({ ...values, inviteId })
      .returning();
    return row;
  });
}

/**
 * Record the answer to the displayed turn, then advance. A stale or
 * duplicate answer (turn already answered, wrong session, session not active)
 * changes nothing and returns the current state so the client resyncs.
 */
export async function submitAnswer(
  sessionId: string,
  turnId: string,
  answer: Answer,
  paradata: AnswerParadata
): Promise<StepResult & { stale: boolean }> {
  const claimed = await claimAnswer(dbx, sessionId, turnId, {
    answer,
    timeToAnswerMs: paradata.timeToAnswerMs,
    deviceClass: paradata.deviceClass ?? null,
    viewport: paradata.viewport ?? null,
  });
  const result = await advance(sessionId);
  return { ...result, stale: !claimed };
}

/**
 * Operator-initiated follow-up round. Generates the first question first
 * (steered by the latest PRD-bearing round's critic focus), then in one
 * transaction claims the session, inserts round N+1 and its first turn, and
 * reactivates the session. Nothing is written when no question comes back.
 * A second concurrent call finds the session already active and succeeds
 * without opening another round.
 */
export async function openFollowupRound(
  sessionId: string
): Promise<{ ok: boolean; reason?: string }> {
  const st = await readState(dbx, sessionId);
  if (!st) return { ok: false, reason: "Session not found." };
  if (st.session.status === "active" && openRoundOf(st)) return { ok: true };
  if (st.session.status !== "awaiting_review")
    return { ok: false, reason: "This session is not awaiting review." };
  if (st.rounds.length === 0) return { ok: false, reason: "No prior round to follow." };

  const prdRound = latestPrdRound(st.rounds);
  const focus = prdRound?.criticFocus || null;
  const messages = [...messagesFromTurns(st.session.seed, st.turns), focusNote(focus)];
  const gen = await generateNextShape(model, messages);
  if (gen.shape.kind !== "question")
    return { ok: false, reason: "The model did not produce a new question. Try again." };
  const text = gen.shape.text;

  return db.transaction(async (tx) => {
    const ex = asExecutor(tx);
    const s = await lockSession(ex, sessionId);
    if (!s) return { ok: false, reason: "Session not found." };
    const rs = await listRounds(ex, sessionId);
    if (s.status === "active" && rs.some((r) => r.status === "in_progress")) return { ok: true };
    if (s.status !== "awaiting_review")
      return { ok: false, reason: "This session is not awaiting review." };
    if (rs.length !== st.rounds.length)
      return { ok: false, reason: "The session changed — reload and try again." };
    const current = await listTurns(ex, sessionId);
    const roundNumber = rs.reduce((m, r) => Math.max(m, r.roundNumber), 0) + 1;
    const prdVersion = (latestPrdRound(rs)?.prdVersion ?? 0) + 1;
    const [next] = await ex
      .insert(rounds)
      .values({ sessionId, roundNumber, prdVersion, status: "in_progress", focusBrief: focus })
      .returning();
    await ex.insert(turns).values(turnValues(s, next, maxStep(current) + 1, text, gen, []));
    await ex
      .update(sessions)
      .set({ status: "active" })
      .where(and(eq(sessions.id, sessionId), eq(sessions.status, "awaiting_review")));
    return { ok: true };
  });
}

/**
 * Operator decision to close out a reviewed interview: mark the session
 * complete and consume the invite. Conditional on `awaiting_review`, so it
 * is refused while the respondent is mid-round.
 */
export async function completeReviewedSession(
  sessionId: string
): Promise<{ ok: boolean; reason?: string }> {
  return db.transaction(async (tx) => {
    const ex = asExecutor(tx);
    const [s] = await ex
      .update(sessions)
      .set({ status: "complete" })
      .where(and(eq(sessions.id, sessionId), eq(sessions.status, "awaiting_review")))
      .returning();
    if (!s) return { ok: false, reason: "This session is not awaiting review." };
    await ex.update(invites).set({ consumedAt: new Date() }).where(eq(invites.id, s.inviteId));
    return { ok: true };
  });
}

/** The session for an invite (oldest first), or null. */
export async function sessionByInvite(inviteId: string): Promise<Session | null> {
  return sessionForInvite(dbx, inviteId);
}

/** The displayed (unanswered) turn for a session, if any. */
export async function pendingTurn(sessionId: string): Promise<Turn | null> {
  return findPendingTurn(dbx, sessionId);
}

/**
 * Operator decision to close a stalled session (active, no question waiting:
 * a request died and nobody resumed it). Any open round is closed with the
 * `abandoned` reason, `abandonedAtStep` records the last answered step, the
 * session completes and the invite is consumed — one transaction,
 * conditional on the stalled state, so it is refused once a question exists.
 */
export async function closeStalledSession(
  sessionId: string
): Promise<{ ok: boolean; reason?: string }> {
  return db.transaction(async (tx) => {
    const ex = asExecutor(tx);
    const s = await lockSession(ex, sessionId);
    if (!s) return { ok: false, reason: "Session not found." };
    if (s.status !== "active" || (await findPendingTurn(ex, sessionId)))
      return { ok: false, reason: "This session is not stalled." };
    const ts = await listTurns(ex, sessionId);
    const lastAnswered = ts.filter(answered).reduce((m, t) => Math.max(m, t.step), 0);
    const now = new Date();
    await ex
      .update(rounds)
      .set({ status: "complete", terminationReason: "abandoned", completedAt: now })
      .where(and(eq(rounds.sessionId, sessionId), eq(rounds.status, "in_progress")));
    await ex
      .update(sessions)
      .set({ status: "complete", abandonedAtStep: lastAnswered || null })
      .where(and(eq(sessions.id, sessionId), eq(sessions.status, "active")));
    await ex.update(invites).set({ consumedAt: now }).where(eq(invites.id, s.inviteId));
    return { ok: true };
  });
}

/**
 * Revoke an invite nobody has used: it expires now. Refused once a session
 * exists for it (the invite row is locked, so a concurrent start cannot slip
 * in between the check and the write).
 */
export async function revokeUnusedInvite(inviteId: string): Promise<{ ok: boolean; reason?: string }> {
  return db.transaction(async (tx) => {
    const ex = asExecutor(tx);
    const inv = await lockInvite(ex, inviteId);
    if (!inv) return { ok: false, reason: "Invite not found." };
    if (await sessionForInvite(ex, inviteId))
      return { ok: false, reason: "This invite has already been used." };
    await ex.update(invites).set({ expiresAt: new Date() }).where(eq(invites.id, inviteId));
    return { ok: true };
  });
}
