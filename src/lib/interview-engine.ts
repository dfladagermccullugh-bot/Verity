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
import { guardOutput, STOP_CONFIRM } from "./guard";
import { detectLeading } from "./anti-leading";
import { classifyDimension } from "./dimensions";
import { computeAnalysis } from "./analysis";
import {
  coverageMet,
  uncoveredDimensionLabels,
  type CoverageTurn,
} from "./coverage";
import { critiqueRound } from "./critic";
import { sendPrdEmail } from "./email";
import {
  buildPrdHeader,
  buildMethodologyDocument,
  buildAnalysisDocument,
} from "./disclosure";
import { buildConstructBrief } from "./construct-brief";

export const RUNAWAY_CEILING = 40;

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

type NextShape =
  | { kind: "question"; text: string }
  | { kind: "stop_confirm" }
  | { kind: "prd"; markdown: string };

/** A generated shape plus the diagnostics recorded on the resulting turn. */
interface GenResult {
  shape: NextShape;
  regenCount: number;
  guardRejections: string[];
  leadingRewrites: number;
}

/**
 * Call the model, run the guard AND the deterministic anti-leading check,
 * regenerating on any rejection. After repeated failures, fall back to the
 * stop-confirm path. Returns the accepted shape with per-turn diagnostics.
 */
async function generateNextShape(messages: ChatMessage[]): Promise<GenResult> {
  const guardRejections: string[] = [];
  let leadingRewrites = 0;
  let regenCount = 0;

  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await callModel(messages);
    const g = guardOutput(raw);

    if (g.kind === "question") {
      const lead = detectLeading(g.text);
      if (lead.leading) {
        guardRejections.push(`leading:${lead.reason}`);
        leadingRewrites += 1;
        regenCount += 1;
        continue; // regenerate a neutrally-phrased question
      }
      return {
        shape: { kind: "question", text: g.text },
        regenCount,
        guardRejections,
        leadingRewrites,
      };
    }
    if (g.kind === "stop_confirm")
      return { shape: { kind: "stop_confirm" }, regenCount, guardRejections, leadingRewrites };
    if (g.kind === "prd")
      return {
        shape: { kind: "prd", markdown: g.markdown },
        regenCount,
        guardRejections,
        leadingRewrites,
      };

    guardRejections.push(g.reason);
    regenCount += 1;
  }

  return { shape: { kind: "stop_confirm" }, regenCount, guardRejections, leadingRewrites };
}

/** Drive the model to emit the final PRD markdown. Best-effort, never throws. */
async function forcePrd(messages: ChatMessage[]): Promise<string> {
  const convo: ChatMessage[] = [
    ...messages,
    { role: "assistant", content: STOP_CONFIRM },
    { role: "user", content: "yes" },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await callModel(convo);
    const g = guardOutput(raw);
    if (g.kind === "prd") return g.markdown;
    convo.push({ role: "assistant", content: raw });
    convo.push({
      role: "user",
      content:
        "Write the PRD now. Begin your reply with the line ===PRD=== and include every required section.",
    });
  }
  const fallback = await callModel(convo);
  return fallback.replace(/^===PRD===\s*/, "");
}

/**
 * Coverage gate (content validity). When the model tries to stop (PRD or
 * stop-confirm) before the round has covered enough construct dimensions, nudge
 * it once toward the uncovered dimensions and try to obtain one more question.
 * Falls back to the original stop-shape if the model still refuses to ask. The
 * caller bypasses this entirely on an explicit respondent "done".
 */
async function enforceCoverage(
  baseMessages: ChatMessage[],
  answered: CoverageTurn[],
  stopGen: GenResult
): Promise<GenResult> {
  if (coverageMet(answered)) return stopGen;
  const remaining = uncoveredDimensionLabels(answered).join(", ");
  const nudged: ChatMessage[] = [
    ...baseMessages,
    {
      role: "user",
      content: `(Not enough has been covered to write the PRD yet. These areas are still unaddressed: ${remaining}. Ask the next single yes/no question about one of them — do not write the PRD.)`,
    },
  ];
  const gen = await generateNextShape(nudged);
  return gen.shape.kind === "question" ? gen : stopGen;
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
  const dimension = classifyDimension(questionText);
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
  markdown: string,
  terminationReason: string
): Promise<void> {
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

  const prdMarkdown = buildPrdHeader({ sessionId: session.id }) + markdown;
  const methodologyMarkdown = buildMethodologyDocument({
    sessionId: session.id,
    constructBriefPresent,
    prdVersion: round.prdVersion,
    analysisPresent: true,
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
  await db
    .update(sessions)
    .set({
      prdMarkdown,
      methodologyMarkdown,
      completedAt: now,
      abandonedAtStep: null,
      status: "awaiting_review",
    })
    .where(eq(sessions.id, session.id));

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
  // Coverage gate: a model that jumps straight to the PRD on turn 1 has covered
  // nothing — push it to start asking.
  if (gen.shape.kind !== "question") {
    gen = await enforceCoverage(messages, [], gen);
  }

  if (gen.shape.kind === "question") {
    await insertTurn(session, round, 1, gen.shape.text, gen, []);
    return { kind: "question", text: gen.shape.text };
  }

  // Degenerate first turn — model jumped straight to stop/PRD.
  const markdown =
    gen.shape.kind === "prd" ? gen.shape.markdown : await forcePrd(messages);
  await finalizeRound(
    session,
    round,
    markdown,
    gen.shape.kind === "prd" ? "model_prd" : "degenerate"
  );
  return { kind: "done" };
}

/** Record the answer to the pending turn and produce the next step. */
export async function submitAnswer(
  session: Session,
  answer: "yes" | "no" | "done",
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
    const markdown = await forcePrd(messages);
    await finalizeRound(
      session,
      activeRound,
      markdown,
      answer === "done" ? "done_by_user" : "ceiling"
    );
    return { kind: "done" };
  }

  const answeredInRoundTurns = allTurns.filter(
    (t) => t.roundId === activeRound.id && t.answer != null
  );

  let gen = await generateNextShape(messages);
  // Coverage gate: if the model tried to stop before the round covered enough
  // construct dimensions, nudge it for one more question instead of finalizing.
  if (gen.shape.kind !== "question") {
    gen = await enforceCoverage(messages, answeredInRoundTurns, gen);
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

  // stop_confirm or prd → finish silently (invitee never sees the confirmation).
  const markdown =
    gen.shape.kind === "prd" ? gen.shape.markdown : await forcePrd(messages);
  await finalizeRound(
    session,
    activeRound,
    markdown,
    gen.shape.kind === "prd" ? "model_prd" : "forced_prd"
  );
  return { kind: "done" };
}
