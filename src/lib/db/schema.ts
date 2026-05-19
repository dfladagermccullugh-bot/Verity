import { pgTable, uuid, text, timestamp, integer } from "drizzle-orm/pg-core";

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
  completedAt: timestamp("completed_at", { withTimezone: true }),
  abandonedAtStep: integer("abandoned_at_step"),
  prdMarkdown: text("prd_markdown"),
});

export const turns = pgTable("turns", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id),
  step: integer("step").notNull(),
  questionText: text("question_text").notNull(),
  answer: text("answer"),
  timeToAnswerMs: integer("time_to_answer_ms"),
});

export type Invite = typeof invites.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Turn = typeof turns.$inferSelect;
