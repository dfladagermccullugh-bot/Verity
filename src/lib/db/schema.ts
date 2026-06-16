import { pgTable, uuid, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";

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
  // Lifecycle across multiple rounds: "active" while a round is open or a
  // follow-up round is queued; "complete" once the critic ends the interview.
  status: text("status").notNull().default("active"),
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
});

export const rounds = pgTable("rounds", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id),
  roundNumber: integer("round_number").notNull(),
  prdVersion: integer("prd_version").notNull(),
  status: text("status").notNull().default("in_progress"),
  // Why the round ended: done_by_user | ceiling | forced_prd | model_prd |
  // degenerate | abandoned.
  terminationReason: text("termination_reason"),
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
});

export const turns = pgTable("turns", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id),
  // Nullable for rows created before the rounds layer existed.
  roundId: uuid("round_id").references(() => rounds.id),
  step: integer("step").notNull(),
  questionText: text("question_text").notNull(),
  answer: text("answer"),
  timeToAnswerMs: integer("time_to_answer_ms"),
  // Per-question metadata (Survey Methodology measurement layer).
  constructDimension: text("construct_dimension"),
  regenCount: integer("regen_count"),
  guardRejections: text("guard_rejections"),
  leadingVerdict: text("leading_verdict"),
  isTriangulationProbe: boolean("is_triangulation_probe"),
  deviceClass: text("device_class"),
  viewport: text("viewport"),
});

export type Invite = typeof invites.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Round = typeof rounds.$inferSelect;
export type Turn = typeof turns.$inferSelect;
