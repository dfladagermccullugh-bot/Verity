import "server-only";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import {
  invites,
  rounds,
  sessions,
  turns,
  type Round,
  type Session,
  type Turn,
} from "./db/schema";
import { callModel, type ChatMessage } from "./anthropic";
import { classifyDimension } from "./dimensions";
import { computeAnalysis } from "./analysis";
import {
  RUNAWAY_CEILING,
  enforceCoverage as enforceCoveragePolicy,
  forcePrd as forcePrdPolicy,
  generateNextShape as generateNextShapePolicy,
  type GenResult,
  type ModelFn,
  type NextShape,
} from "./interview-policy";
import type { CoverageTurn } from "./coverage";
import { MIRROR_DIMENSION, isMirrorQuestion } from "./dimensions";
import type { Answer, TerminationReason } from "./lifecycle";
import { critiqueRound } from "./critic";
import { sendPrdEmail } from "./email";
import {
  buildPrdHeader,
  buildMethodologyDocument,
  buildAnalysisDocument,
  type TerminationDiagnostics,
} from "./disclosure";
import { buildConstructBrief } from "./construct-brief";

export { RUNAWAY_CEILING } from "./interview-policy";

/** The interview model, bound for the policy module. */
const model: ModelFn = (messages) => callModel(messages);

async function generateNextShape(messages: ChatMessage[]): Promise<GenResult> {
  return generateNextShapePolicy(model, messages);
}

/** Termination reason for a non-question shape. */
function stopReason(shape: NextShape, firstTurn: boolean): TerminationReason {
  if (shape.kind === "prd") return "model_prd";
  if (shape.kind === "exhausted") return "guard_exhausted";
  return firstTurn ? "degenerate" : "forced_prd";
}

/**
 * Apply the coverage gate to a non-question shape. Returns the question to
 * insert, or the stop to conclude with (plus the nudge's rejections).
 */
async function gateStop(
  messages: ChatMessage[],
  answered: CoverageTurn[],
  gen: GenResult
): Promise<{ gen: GenResult; rejections: string[] }> {
  const cov = await enforceCoveragePolicy(model, messages, answered, gen);
  return {
    gen: cov.gen,
    rejections: [...gen.guardRejections, ...(cov.nudge?.guardRejections ?? [])],
  };
}

/** End a round: obtain the PRD (unless the model already wrote it) and
 *  finalize. A PRD that cannot be obtained fails the round (`prd_failed`). */
async function concludeRound(
  session: Session,
  round: Round,
  messages: ChatMessage[],
  reason: TerminationReason,
  gen: GenResult | null,
  guardRejections: string[] = gen?.guardRejections ?? []
): Promise<void> {
  if (gen?.shape.kind === "prd") {
    await finalizeRound(session, round, gen.shape.markdown, {
      reason,
      guardRejections,
      prdRejections: [],
      prdVia: "model",
    });
    return;
  }
  const r = await forcePrdPolicy(model, messages);
  await finalizeRound(session, round, r.ok ? r.markdown : null, {
    reason: r.ok ? reason : "prd_failed",
    guardRejections,
    prdRejections: r.rejections,
    prdVia: r.ok ? r.via : null,
  });
}

/** Paradata captured alongside each answer (Survey Methodology §15). */
export interface AnswerParadata {
  timeToAnswerMs: number | null;
  deviceClass?: string | null;
  viewport?: string | null;
}

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

/** All turns for a session, across rounds, ordered by step. */
async function loadTurns(sessionId: string): Promise<Turn[]> {
  return db
    .select()
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .orderBy(asc(turns.step));
}

function maxStep(allTurns: Turn[]): number {
  return allTurns.reduce((m, t) => Math.max(m, t.step), 0);
}

/** Insert a pending question turn, computing its measurement metadata. */
async function insertTurn(
  session: Session,
  round: Round,
  step: number,
  questionText: string,
  gen: GenResult,
  priorRoundAnswered: Turn[]
): Promise<void> {
  // The skill's opening "mirror … Ready?" turn is protocol, not measurement:
  // tagged so coverage and the analysis exclude it.
  const dimension =
    step === 1 && isMirrorQuestion(questionText)
      ? MIRROR_DIMENSION
      : classifyDimension(questionText);
  const isTriangulationProbe = priorRoundAnswered.some(
    (t) => t.constructDimension === dimension
  );
  await db.insert(turns).values({
    sessionId: session.id,
    roundId: round.id,
    step,
    questionText,
    answer: null,
    timeToAnswerMs: null,
    constructDimension: dimension,
    regenCount: gen.regenCount,
    guardRejections: JSON.stringify(gen.guardRejections),
    leadingVerdict: gen.leadingRewrites > 0 ? "rewritten" : "clean",
    isTriangulationProbe,
    deviceClass: null,
    viewport: null,
  });
}

/** The active (latest) round for a session. */
async function getActiveRound(
  sessionId: string,
  pending: Turn | null
): Promise<Round | null> {
  if (pending?.roundId) {
    const r = await db.query.rounds.findFirst({
      where: eq(rounds.id, pending.roundId),
    });
    if (r) return r;
  }
  const rs = await db
    .select()
    .from(rounds)
    .where(eq(rounds.sessionId, sessionId))
    .orderBy(desc(rounds.roundNumber));
  return rs[0] ?? null;
}

/**
 * Finalize a round: build + freeze the PRD, methodology, and analysis
 * documents; mirror the latest version onto the session; email the operator;
 * then run the gap-analysis critic. If the critic opens a follow-up round,
 * generate its first question and leave the session active. Otherwise mark the
 * session complete and consume the invite.
 */
async function finalizeRound(
  session: Session,
  round: Round,
  markdown: string | null,
  termination: TerminationDiagnostics
): Promise<void> {
  const terminationReason = termination.reason as TerminationReason;
  const fresh = await db.query.sessions.findFirst({
    where: eq(sessions.id, session.id),
  });
  const constructBriefPresent = !!fresh?.constructBrief;

  const roundTurns = await db
    .select()
    .from(turns)
    .where(eq(turns.roundId, round.id))
    .orderBy(asc(turns.step));

  const analysis = computeAnalysis(
    roundTurns.map((t) => ({
      answer: t.answer,
      timeToAnswerMs: t.timeToAnswerMs,
      constructDimension: t.constructDimension,
      leadingVerdict: t.leadingVerdict,
    }))
  );
  const analysisMarkdown = buildAnalysisDocument({
    sessionId: session.id,
    analysis,
    prdVersion: round.prdVersion,
  });

  const prdMarkdown =
    markdown == null ? null : buildPrdHeader({ sessionId: session.id }) + markdown;
  const methodologyMarkdown = buildMethodologyDocument({
    sessionId: session.id,
    constructBriefPresent,
    prdVersion: round.prdVersion,
    analysisPresent: true,
    termination,
  });

  const now = new Date();
  await db
    .update(rounds)
    .set({
      status: "complete",
      terminationReason,
      completedAt: now,
      prdMarkdown,
      methodologyMarkdown,
      analysisMarkdown,
    })
    .where(eq(rounds.id, round.id));

  // Mirror the latest version onto the session for the existing routes/screens.
  // The round is done but the session is not complete: it enters `awaiting_review`
  // so a human operator can read the PRD and decide whether to open another round.
  // A failed round (no PRD) leaves the previous version's mirror in place.
  await db
    .update(sessions)
    .set({
      ...(prdMarkdown != null ? { prdMarkdown, methodologyMarkdown } : {}),
      completedAt: now,
      abandonedAtStep: null,
      status: "awaiting_review",
    })
    .where(eq(sessions.id, session.id));

  // Nothing to email or critique without a PRD; the operator sees the
  // failed round in admin.
  if (markdown == null || prdMarkdown == null) return;

  // Email this version promptly, independent of whether more rounds follow.
  const invite = await db.query.invites.findFirst({
    where: eq(invites.id, session.inviteId),
  });
  await sendPrdEmail({
    inviteeName: invite?.inviteeName ?? "Unknown",
    seed: session.seed,
    sessionId: session.id,
    prdVersion: round.prdVersion,
    prdMarkdown,
    methodologyMarkdown,
    analysisMarkdown,
  });

  // Gap-analysis critic — ADVISORY. It runs at every finalize and its verdict
  // is persisted on the round (so a one-round session still records *why* it
  // stopped), but it no longer opens rounds itself. A human operator decides
  // whether to extend, via `openFollowupRound`. Fail-safe: any error yields a
  // "stop" verdict (see critic.ts), which simply records no recommendation.
  const transcript = roundTurns
    .filter((t) => t.answer != null && t.answer !== "done")
    .map((t) => `Q${t.step}: ${t.questionText}\nA: ${t.answer}`)
    .join("\n");
  const critique = await critiqueRound(session.seed, transcript, markdown);
  await db
    .update(rounds)
    .set({
      criticRecommendOpen: critique.openNewRound,
      criticGaps: JSON.stringify(critique.gaps),
      criticFocus: critique.focus,
    })
    .where(eq(rounds.id, round.id));
}

/**
 * Operator-initiated follow-up round. Creates round N+1 (steered by the prior
 * round's stored critic focus, when present), generates its first question from
 * the full cross-round transcript, and reactivates the session. Returns
 * `ok: false` (leaving the session in `awaiting_review`) if no question could be
 * generated, so the operator can retry or complete instead.
 */
export async function openFollowupRound(
  session: Session
): Promise<{ ok: boolean; reason?: string }> {
  const rs = await db
    .select()
    .from(rounds)
    .where(eq(rounds.sessionId, session.id))
    .orderBy(desc(rounds.roundNumber));
  const last = rs[0];
  if (!last) return { ok: false, reason: "No prior round to follow." };

  const [next] = await db
    .insert(rounds)
    .values({
      sessionId: session.id,
      roundNumber: last.roundNumber + 1,
      prdVersion: last.prdVersion + 1,
      status: "in_progress",
      focusBrief: last.criticFocus ?? null,
    })
    .returning();

  const allTurns = await loadTurns(session.id);
  const messages = messagesFromTurns(session.seed, allTurns);
  messages.push({
    role: "user",
    content: last.criticFocus
      ? `(Continue the interview. The analyst flagged these gaps to focus on next: ${last.criticFocus} Ask the next single yes/no question.)`
      : `(Continue the interview with another round of questions. Ask the next single yes/no question about anything still unclear.)`,
  });
  const gen = await generateNextShape(messages);

  if (gen.shape.kind === "question") {
    await insertTurn(session, next, maxStep(allTurns) + 1, gen.shape.text, gen, []);
    await db
      .update(sessions)
      .set({ status: "active" })
      .where(eq(sessions.id, session.id));
    return { ok: true };
  }

  // The follow-up produced no question — close the empty round, stay in review.
  await db
    .update(rounds)
    .set({ status: "complete", terminationReason: "degenerate", completedAt: new Date() })
    .where(eq(rounds.id, next.id));
  return { ok: false, reason: "The model did not produce a new question." };
}

/** The currently-displayed (unanswered) turn, if any. */
export async function pendingTurn(sessionId: string) {
  const [row] = await db
    .select()
    .from(turns)
    .where(and(eq(turns.sessionId, sessionId), isNull(turns.answer)))
    .orderBy(asc(turns.step));
  return row ?? null;
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
        .where(eq(sessions.id, session.id));
    }
  } catch {
    // Swallow — the interview must proceed even if the auditor call fails.
  }
}

/** Step 1: first model call after the seed is submitted. Opens round 1. */
export async function beginInterview(session: Session): Promise<
  | { kind: "question"; text: string }
  | { kind: "done" }
> {
  await persistConstructBrief(session);

  const [round] = await db
    .insert(rounds)
    .values({ sessionId: session.id, roundNumber: 1, prdVersion: 1, status: "in_progress" })
    .returning();

  const messages: ChatMessage[] = [{ role: "user", content: session.seed }];
  let gen = await generateNextShape(messages);
  let rejections = gen.guardRejections;
  // Coverage gate: a model that jumps straight to the PRD on turn 1 has covered
  // nothing — push it to start asking.
  if (gen.shape.kind !== "question") {
    ({ gen, rejections } = await gateStop(messages, [], gen));
  }

  if (gen.shape.kind === "question") {
    await insertTurn(session, round, 1, gen.shape.text, gen, []);
    return { kind: "question", text: gen.shape.text };
  }

  // Degenerate first turn — model jumped straight to stop/PRD.
  await concludeRound(session, round, messages, stopReason(gen.shape, true), gen, rejections);
  return { kind: "done" };
}

/** Record the answer to the pending turn and produce the next step. */
export async function submitAnswer(
  session: Session,
  answer: Answer,
  paradata: AnswerParadata
): Promise<{ kind: "question"; text: string } | { kind: "done" }> {
  if (session.status === "complete") return { kind: "done" };

  const allTurns = await loadTurns(session.id);
  const pending = allTurns.find((t) => t.answer == null) ?? null;
  // No pending question means the round has finalized (awaiting operator review)
  // — there is nothing to answer, so never generate off a stale/duplicate POST.
  if (!pending) return { kind: "done" };
  const activeRound = await getActiveRound(session.id, pending);

  if (pending) {
    await db
      .update(turns)
      .set({
        answer,
        timeToAnswerMs: paradata.timeToAnswerMs,
        deviceClass: paradata.deviceClass ?? null,
        viewport: paradata.viewport ?? null,
      })
      .where(eq(turns.id, pending.id));
    pending.answer = answer; // reflect in-memory; avoids a refetch
  }

  if (!activeRound) return { kind: "done" }; // safety: nothing to drive

  const messages = messagesFromTurns(session.seed, allTurns);
  const answeredInRound = allTurns.filter(
    (t) => t.roundId === activeRound.id && t.answer != null
  ).length;

  // Invitee asked to finish, or runaway ceiling reached → go straight to PRD.
  if (answer === "done" || answeredInRound >= RUNAWAY_CEILING) {
    await concludeRound(
      session,
      activeRound,
      messages,
      answer === "done" ? "done_by_user" : "ceiling",
      null
    );
    return { kind: "done" };
  }

  const answeredInRoundTurns = allTurns.filter(
    (t) => t.roundId === activeRound.id && t.answer != null
  );

  let gen = await generateNextShape(messages);
  let rejections = gen.guardRejections;
  // Coverage gate: if the model tried to stop before the round covered enough
  // construct dimensions, nudge it for one more question instead of finalizing.
  if (gen.shape.kind !== "question") {
    ({ gen, rejections } = await gateStop(messages, answeredInRoundTurns, gen));
  }

  if (gen.shape.kind === "question") {
    await insertTurn(
      session,
      activeRound,
      maxStep(allTurns) + 1,
      gen.shape.text,
      gen,
      answeredInRoundTurns
    );
    return { kind: "question", text: gen.shape.text };
  }

  // stop / prd / exhausted → finish silently (invitee never sees the confirmation).
  await concludeRound(
    session,
    activeRound,
    messages,
    stopReason(gen.shape, false),
    gen,
    rejections
  );
  return { kind: "done" };
}
