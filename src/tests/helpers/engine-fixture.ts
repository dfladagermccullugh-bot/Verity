import { vi } from "vitest";
import { randomUUID } from "node:crypto";
import { STOP_CONFIRM } from "@/lib/guard";
import type { ChatMessage, ModelReply } from "@/lib/model-client";
import { invites } from "@/lib/db/schema";
import type { TestDb } from "./pglite-db";
import { PRD_REPLY } from "./scripted-model";

/** One clean question per tracked dimension (classifier-verified). */
export const DIMENSION_QUESTIONS = [
  "Is the main pain point forgetting?",
  "Is it mostly for parents?",
  "Is tracking the core task?",
  "Will people upload photos?",
  "Should it produce a weekly summary?",
  "Will it run on a phone?",
  "Is any of it health information?",
  "Will thousands use it at once?",
  "Should it sync with a calendar?",
  "Would coming back daily mean success?",
];

export type Responder = (messages: ChatMessage[]) => string | ModelReply | Promise<string | ModelReply>;

/** Is this call the forced-PRD path? */
export function wantsPrd(messages: ChatMessage[]): boolean {
  const last = messages[messages.length - 1];
  const prev = messages[messages.length - 2];
  return (
    (prev?.role === "assistant" && prev.content === STOP_CONFIRM && last?.content === "yes") ||
    /Write the PRD now/.test(last?.content ?? "")
  );
}

/**
 * Default well-behaved model: asks one question per dimension (in order of
 * answered questions so far), asks to stop after ten, and writes a valid PRD
 * when asked.
 */
export const defaultResponder: Responder = (messages) => {
  if (wantsPrd(messages)) return PRD_REPLY;
  const asked = messages.filter((m) => m.role === "assistant").length;
  if (asked >= DIMENSION_QUESTIONS.length) return STOP_CONFIRM;
  return DIMENSION_QUESTIONS[asked];
};

/** A controllable stand-in for `callModel`. */
export function modelController() {
  let responder: Responder = defaultResponder;
  const calls: ChatMessage[][] = [];
  const fn = vi.fn(async (messages: ChatMessage[]): Promise<ModelReply> => {
    calls.push(messages.map((m) => ({ ...m })));
    const out = await responder(messages);
    return typeof out === "string" ? { text: out, stopReason: "end_turn" } : out;
  });
  return {
    fn,
    calls,
    set(r: Responder) {
      responder = r;
    },
    reset() {
      responder = defaultResponder;
      calls.length = 0;
      fn.mockClear();
    },
  };
}

export async function seedInvite(db: TestDb, overrides: Partial<typeof invites.$inferInsert> = {}) {
  const [row] = await db
    .insert(invites)
    .values({
      token: `tok-${randomUUID()}`,
      inviteeName: "Test",
      expiresAt: new Date(Date.now() + 86_400_000),
      ...overrides,
    })
    .returning();
  return row;
}

export const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
