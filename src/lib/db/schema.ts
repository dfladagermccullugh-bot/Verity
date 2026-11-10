import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  ANSWERS,
  ROUND_STATUSES,
  SESSION_STATUSES,
  TERMINATION_REASONS,
} from "../lifecycle";

// Status / reason / answer columns are typed from the unions in lifecycle.ts
// (`text(..., { enum })` is TypeScript-only — no DDL, no CHECK constraint).

export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  token: text("token").notNull().unique(),
  inviteeName: text("invitee_name").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  inviteId: uuid("invite_id")
    .notNull()
    .references(() => invites.id),
  seed: text("seed").notNull(),
  skillVersion: text("skill_version").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  // Lifecycle across rounds (see lifecycle.ts): "active" while a round is open;
  // "awaiting_review" once a round has finalized and the operator decides;
  // "complete" once the operator closes the session (invite consumed).
  status: text("status", { enum: SESSION_STATUSES }).notNull().default("active"),
  // Device-portability backstop for the durable anonymous link. Never required.
  resumePhrase: text("resume_phrase"),
  // Non-blocking seed-quality warnings (JSON array), surfaced to the operator.
  seedWarnings: text("seed_warnings"),
  // Mirrors of the LATEST completed round, kept for the existing download
  // routes / done screen. Canonical per-round copies live on `rounds`.
  completedAt: timestamp("completed_at", { withTimezone: true }),
  abandonedAtStep: integer("abandoned_at_step"),
  prdMarkdown: text("prd_markdown"),
  methodologyMarkdown: text("methodology_markdown"),
  constructBrief: text("construct_brief"),
  // Operator-set archive flag: hides a session from the default registry view
  // without deleting it (the row + all rounds/turns are retained). Null = active.
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => ({
  // Migration 0006 (guarded: skipped if duplicates remain — the engine's
  // locked claims enforce the same invariants either way).
  inviteUnique: uniqueIndex("sessions_invite_id_unique").on(t.inviteId),
}));

export const rounds = pgTable("rounds", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id),
  roundNumber: integer("round_number").notNull(),
  prdVersion: integer("prd_version").notNull(),
  status: text("status", { enum: ROUND_STATUSES }).notNull().default("in_progress"),
  // Why the round ended — one of TERMINATION_REASONS in lifecycle.ts.
  terminationReason: text("termination_reason", { enum: TERMINATION_REASONS }),
  // Critic gap-analysis that seeded THIS round; null for round 1.
  focusBrief: text("focus_brief"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  prdMarkdown: text("prd_markdown"),
  methodologyMarkdown: text("methodology_markdown"),
  analysisMarkdown: text("analysis_markdown"),
  // Gap-analysis critic verdict for THIS round, persisted every finalize so a
  // declined round still records why it stopped (advisory; a human decides
  // whether to act on it). `criticFocus` seeds the next round's `focusBrief`.
  criticRecommendOpen: boolean("critic_recommend_open"),
  criticGaps: text("critic_gaps"),
  criticFocus: text("critic_focus"),
}, (t) => ({
  roundNumberUnique: uniqueIndex("rounds_session_round_unique").on(t.sessionId, t.roundNumber),
}));

export const turns = pgTable("turns", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id),
  // Nullable for rows created before the rounds layer existed.
  roundId: uuid("round_id").references(() => rounds.id),
  step: integer("step").notNull(),
  questionText: text("question_text").notNull(),
  // null while the question is pending; then one of ANSWERS.
  answer: text("answer", { enum: ANSWERS }),
  timeToAnswerMs: integer("time_to_answer_ms"),
  // Per-question metadata (Survey Methodology measurement layer).
  constructDimension: text("construct_dimension"),
  regenCount: integer("regen_count"),
  guardRejections: text("guard_rejections"),
  leadingVerdict: text("leading_verdict"),
  isTriangulationProbe: boolean("is_triangulation_probe"),
  deviceClass: text("device_class"),
  viewport: text("viewport"),
}, (t) => ({
  stepUnique: uniqueIndex("turns_session_step_unique").on(t.sessionId, t.step),
  // At most one unanswered (displayed) turn per session.
  onePending: uniqueIndex("turns_one_pending_per_session")
    .on(t.sessionId)
    .where(sql`${t.answer} is null`),
  roundIdx: index("turns_round_id_idx").on(t.roundId),
}));

export type Invite = typeof invites.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Round = typeof rounds.$inferSelect;
export type Turn = typeof turns.$inferSelect;
