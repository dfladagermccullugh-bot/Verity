"use server";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { invites } from "@/lib/db/schema";
import { verifyInviteToken } from "@/lib/tokens";
import { getSkillVersion } from "@/lib/skill/version";
import { moderateSeed } from "@/lib/moderation";
import { seedWarnings } from "@/lib/seed-quality";
import { generateResumePhrase } from "@/lib/resume-phrase";
import { isAnswer } from "@/lib/lifecycle";
import { sanitizeParadata, isTurnId } from "@/lib/action-input";
import {
  advance,
  createSessionForInvite,
  sessionByInvite,
  submitAnswer,
  type StepResult,
} from "@/lib/interview-engine";

const SEED_MAX = 1000;

/** Client-supplied paradata for an answer; timing is captured in the browser. */
export interface AnswerInput {
  timeToAnswerMs: number | null;
  deviceClass?: string | null;
  viewport?: string | null;
}

export type StepResponse =
  | { ok: true; kind: "question"; turnId: string; text: string; answered: number; stale?: boolean }
  | { ok: true; kind: "done" }
  | { ok: false; error: string };

export type StartResult = StepResponse;
export type AnswerResult = StepResponse;

const BUSY = "That didn't go through — please try again.";

function toResponse(r: StepResult, stale = false): StepResponse {
  if (r.kind === "done") return { ok: true, kind: "done" };
  return {
    ok: true,
    kind: "question",
    turnId: r.turnId,
    text: r.text,
    answered: r.answeredInRound,
    ...(stale ? { stale: true } : {}),
  };
}

async function inviteByToken(token: unknown) {
  if (typeof token !== "string" || !token || !verifyInviteToken(token)) return null;
  const invite = await db.query.invites.findFirst({
    where: eq(invites.token, token),
  });
  return invite ?? null;
}

export async function startSession(token: string, seedRaw: string): Promise<StartResult> {
  const invite = await inviteByToken(token);
  if (!invite) return { ok: false, error: "This link is not valid." };

  // An existing session (another tab, a retried request) is resumed rather
  // than refused: the durable link always continues where it left off.
  const existing = await sessionByInvite(invite.id);
  if (existing) {
    try {
      return toResponse(await advance(existing.id));
    } catch {
      return { ok: false, error: BUSY };
    }
  }

  if (invite.consumedAt) return { ok: false, error: "This link has already been used." };
  if (invite.expiresAt.getTime() < Date.now())
    return { ok: false, error: "This link has expired." };

  const seed = (typeof seedRaw === "string" ? seedRaw : "").trim().slice(0, SEED_MAX);
  if (!seed) return { ok: false, error: "Please describe your idea first." };

  const mod = await moderateSeed(seed);
  if (!mod.allowed)
    return { ok: false, error: "Sorry — that idea can't be processed here." };

  const session = await createSessionForInvite(invite.id, {
    seed,
    skillVersion: getSkillVersion(),
    seedWarnings: JSON.stringify(seedWarnings(seed)),
    resumePhrase: generateResumePhrase(),
  });

  try {
    return toResponse(await advance(session.id));
  } catch {
    // The session is saved; reopening the link resumes it.
    return { ok: false, error: BUSY };
  }
}

export async function answer(
  token: string,
  turnId: string,
  value: string,
  paradata: AnswerInput
): Promise<AnswerResult> {
  if (!isAnswer(value)) return { ok: false, error: "That answer isn't recognised." };
  if (!isTurnId(turnId)) return { ok: false, error: "That question is out of date — reload." };

  const invite = await inviteByToken(token);
  if (!invite) return { ok: false, error: "This link is not valid." };

  const session = await sessionByInvite(invite.id);
  if (!session) return { ok: false, error: "No active session for this link." };
  if (session.status === "complete") return { ok: true, kind: "done" };

  try {
    const result = await submitAnswer(session.id, turnId, value, sanitizeParadata(paradata));
    return toResponse(result, result.stale);
  } catch {
    // The answer (if claimed) is saved; retrying resumes from it.
    return { ok: false, error: BUSY };
  }
}

/**
 * Resume a session with no question waiting (a request died mid-step, or
 * the next question is still being prepared). Idempotent.
 */
export async function resume(token: string): Promise<StepResponse> {
  const invite = await inviteByToken(token);
  if (!invite) return { ok: false, error: "This link is not valid." };
  const session = await sessionByInvite(invite.id);
  if (!session) return { ok: false, error: "No active session for this link." };
  try {
    return toResponse(await advance(session.id));
  } catch {
    return { ok: false, error: BUSY };
  }
}
