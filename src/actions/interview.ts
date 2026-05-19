"use server";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { invites, sessions } from "@/lib/db/schema";
import { verifyInviteToken } from "@/lib/tokens";
import { getSkillVersion } from "@/lib/skill/version";
import { moderateSeed } from "@/lib/moderation";
import { beginInterview, submitAnswer } from "@/lib/interview-engine";

const SEED_MAX = 1000;

export type StartResult =
  | { ok: true; kind: "question"; text: string }
  | { ok: true; kind: "done" }
  | { ok: false; error: string };

export type AnswerResult =
  | { ok: true; kind: "question"; text: string }
  | { ok: true; kind: "done" }
  | { ok: false; error: string };

async function inviteByToken(token: string) {
  if (!token || !verifyInviteToken(token)) return null;
  const invite = await db.query.invites.findFirst({
    where: eq(invites.token, token),
  });
  return invite ?? null;
}

export async function startSession(token: string, seedRaw: string): Promise<StartResult> {
  const invite = await inviteByToken(token);
  if (!invite) return { ok: false, error: "This link is not valid." };

  if (invite.consumedAt) return { ok: false, error: "This link has already been used." };
  if (invite.expiresAt.getTime() < Date.now())
    return { ok: false, error: "This link has expired." };

  const existing = await db.query.sessions.findFirst({
    where: eq(sessions.inviteId, invite.id),
  });
  if (existing) {
    if (existing.completedAt) return { ok: true, kind: "done" };
    return { ok: false, error: "This idea is already in progress — reopen the link." };
  }

  const seed = seedRaw.trim().slice(0, SEED_MAX);
  if (!seed) return { ok: false, error: "Please describe your idea first." };

  const mod = await moderateSeed(seed);
  if (!mod.allowed)
    return { ok: false, error: "Sorry — that idea can't be processed here." };

  const [session] = await db
    .insert(sessions)
    .values({ inviteId: invite.id, seed, skillVersion: getSkillVersion() })
    .returning();

  const result = await beginInterview(session);
  if (result.kind === "question")
    return { ok: true, kind: "question", text: result.text };
  return { ok: true, kind: "done" };
}

export async function answer(
  token: string,
  value: "yes" | "no" | "done",
  timeToAnswerMs: number | null
): Promise<AnswerResult> {
  const invite = await inviteByToken(token);
  if (!invite) return { ok: false, error: "This link is not valid." };

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.inviteId, invite.id),
  });
  if (!session) return { ok: false, error: "No active session for this link." };
  if (session.completedAt) return { ok: true, kind: "done" };

  const result = await submitAnswer(session, value, timeToAnswerMs);
  if (result.kind === "question")
    return { ok: true, kind: "question", text: result.text };
  return { ok: true, kind: "done" };
}
