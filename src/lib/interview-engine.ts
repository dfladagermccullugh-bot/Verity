import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { invites, sessions, turns, type Session, type Turn } from "./db/schema";
import { callModel, type ChatMessage } from "./anthropic";
import { guardOutput, STOP_CONFIRM } from "./guard";
import { sendPrdEmail } from "./email";
import { buildPrdHeader, buildMethodologyDocument } from "./disclosure";
import { buildConstructBrief } from "./construct-brief";

export const RUNAWAY_CEILING = 40;

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

async function loadTurns(sessionId: string): Promise<Turn[]> {
  return db
    .select()
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .orderBy(asc(turns.step));
}

type NextShape =
  | { kind: "question"; text: string }
  | { kind: "stop_confirm" }
  | { kind: "prd"; markdown: string };

/** Call the model, run the guard, regenerate once on reject, then fall back to stop-confirm. */
async function generateNextShape(messages: ChatMessage[]): Promise<NextShape> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await callModel(messages);
    const g = guardOutput(raw);
    if (g.kind === "question") return { kind: "question", text: g.text };
    if (g.kind === "stop_confirm") return { kind: "stop_confirm" };
    if (g.kind === "prd") return { kind: "prd", markdown: g.markdown };
    // reject → loop once more
  }
  // Two rejects → force the stop-confirm path.
  return { kind: "stop_confirm" };
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
    // Nudge harder and retry.
    convo.push({ role: "assistant", content: raw });
    convo.push({
      role: "user",
      content:
        "Write the PRD now. Begin your reply with the line ===PRD=== and include every required section.",
    });
  }
  // Last resort: take whatever the model said so Davin still gets content.
  const fallback = await callModel(convo);
  return fallback.replace(/^===PRD===\s*/, "");
}

async function finalizeWithPrd(session: Session, markdown: string): Promise<void> {
  // Freeze methodology provenance with the artifact. The PRD itself carries
  // only an invisible HTML-comment header linking it to the companion
  // methodology document; the full AAPOR disclosure lives in a separate field
  // so it can be distributed as its own file. Both documents share the session
  // ID in their filenames and headers, so the association survives separation.
  //
  // Re-read the session before building the methodology document — the
  // in-memory copy is from before the construct-brief probe ran.
  const fresh = await db.query.sessions.findFirst({
    where: eq(sessions.id, session.id),
  });
  const constructBriefPresent = !!fresh?.constructBrief;

  const prdMarkdown = buildPrdHeader({ sessionId: session.id }) + markdown;
  const methodologyMarkdown = buildMethodologyDocument({
    sessionId: session.id,
    constructBriefPresent,
  });

  await db
    .update(sessions)
    .set({
      prdMarkdown,
      methodologyMarkdown,
      completedAt: new Date(),
      abandonedAtStep: null,
    })
    .where(eq(sessions.id, session.id));
  await db
    .update(invites)
    .set({ consumedAt: new Date() })
    .where(eq(invites.id, session.inviteId));

  const invite = await db.query.invites.findFirst({
    where: eq(invites.id, session.inviteId),
  });
  await sendPrdEmail({
    inviteeName: invite?.inviteeName ?? "Unknown",
    seed: session.seed,
    sessionId: session.id,
    prdMarkdown,
    methodologyMarkdown,
  });
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
 * brief on the session. Never throws — a missing brief must not block the
 * interview, only flag it as missing in the methodology disclosure.
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

/** Step 1: first model call after the seed is submitted. */
export async function beginInterview(session: Session): Promise<
  | { kind: "question"; text: string }
  | { kind: "done" }
> {
  // Fire the AAPOR §4.3.1 construct-validity probe before generating the
  // first question. Awaited so the brief is on file (or known-missing) before
  // any substantive content is produced.
  await persistConstructBrief(session);

  const messages: ChatMessage[] = [{ role: "user", content: session.seed }];
  const shape = await generateNextShape(messages);

  if (shape.kind === "question") {
    await db.insert(turns).values({
      sessionId: session.id,
      step: 1,
      questionText: shape.text,
      answer: null,
      timeToAnswerMs: null,
    });
    return { kind: "question", text: shape.text };
  }

  // Degenerate first turn — model jumped straight to stop/PRD.
  const markdown =
    shape.kind === "prd" ? shape.markdown : await forcePrd(messages);
  await finalizeWithPrd(session, markdown);
  return { kind: "done" };
}

/** Record the answer to the pending turn and produce the next step. */
export async function submitAnswer(
  session: Session,
  answer: "yes" | "no" | "done",
  timeToAnswerMs: number | null
): Promise<{ kind: "question"; text: string } | { kind: "done" }> {
  if (session.completedAt) return { kind: "done" };

  // One fetch covers pending lookup, history rebuild, answered count, and next-step number.
  const allTurns = await loadTurns(session.id);
  const pending = allTurns.find((t) => t.answer == null) ?? null;

  if (pending) {
    await db
      .update(turns)
      .set({ answer, timeToAnswerMs })
      .where(eq(turns.id, pending.id));
    pending.answer = answer; // reflect the write in-memory; avoids a refetch
  }

  const messages = messagesFromTurns(session.seed, allTurns);
  const count = allTurns.reduce((n, t) => (t.answer != null ? n + 1 : n), 0);
  const nextStep = allTurns.reduce((m, t) => Math.max(m, t.step), 0) + 1;

  // Invitee asked to finish, or runaway ceiling reached → go straight to PRD.
  if (answer === "done" || count >= RUNAWAY_CEILING) {
    const markdown = await forcePrd(messages);
    await finalizeWithPrd(session, markdown);
    return { kind: "done" };
  }

  const shape = await generateNextShape(messages);

  if (shape.kind === "question") {
    await db.insert(turns).values({
      sessionId: session.id,
      step: nextStep,
      questionText: shape.text,
      answer: null,
      timeToAnswerMs: null,
    });
    return { kind: "question", text: shape.text };
  }

  // stop_confirm or prd → finish silently (invitee never sees the confirmation).
  const markdown =
    shape.kind === "prd" ? shape.markdown : await forcePrd(messages);
  await finalizeWithPrd(session, markdown);
  return { kind: "done" };
}
