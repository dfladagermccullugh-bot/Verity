/**
 * Lifecycle vocabulary and transition rules for sessions, rounds and turns.
 *
 * Every status / reason / answer string the app persists is declared here, and
 * the schema columns are typed from these unions (`text(..., { enum })`, no
 * DDL). The routing for the respondent and the state shown to the operator are
 * derived here too, so the pages and actions stop re-deriving them.
 *
 * Pure: no I/O, no `server-only`, safe to import from tests and scripts.
 */

// ── Vocabularies ────────────────────────────────────────────────────────────

export const SESSION_STATUSES = ["active", "awaiting_review", "complete"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const ROUND_STATUSES = ["in_progress", "complete"] as const;
export type RoundStatus = (typeof ROUND_STATUSES)[number];

/** Why a round ended. */
export const TERMINATION_REASONS = [
  /** The respondent pressed "done". */
  "done_by_user",
  /** The per-round runaway ceiling was reached. */
  "ceiling",
  /** The model asked to stop (stop confirmation); the PRD was then forced. */
  "forced_prd",
  /** The model emitted the PRD on its own. */
  "model_prd",
  /** The model would not ask even a first question. */
  "degenerate",
  /** The operator closed a stalled round. */
  "abandoned",
  /** Every generation attempt (and the coverage nudge) was rejected by the
   *  guard; the PRD was then forced. Previously recorded as forced_prd. */
  "guard_exhausted",
  /** No valid PRD could be obtained; the round carries no PRD. */
  "prd_failed",
] as const;
export type TerminationReason = (typeof TERMINATION_REASONS)[number];

export const ANSWERS = ["yes", "no", "done"] as const;
export type Answer = (typeof ANSWERS)[number];

export function isAnswer(v: unknown): v is Answer {
  return typeof v === "string" && (ANSWERS as readonly string[]).includes(v);
}

export function isSessionStatus(v: unknown): v is SessionStatus {
  return typeof v === "string" && (SESSION_STATUSES as readonly string[]).includes(v);
}

// ── Transitions ─────────────────────────────────────────────────────────────

/**
 * Allowed session transitions.
 *  - active → awaiting_review: a round finalized with a PRD.
 *  - awaiting_review → active: the operator opened a follow-up round.
 *  - awaiting_review → complete: the operator closed the session.
 *  - active → complete: the operator closed a stalled session.
 */
export const SESSION_TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  active: ["awaiting_review", "complete"],
  awaiting_review: ["active", "complete"],
  complete: [],
};

export const ROUND_TRANSITIONS: Record<RoundStatus, readonly RoundStatus[]> = {
  in_progress: ["complete"],
  complete: [],
};

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return SESSION_TRANSITIONS[from].includes(to);
}

export function canTransitionRound(from: RoundStatus, to: RoundStatus): boolean {
  return ROUND_TRANSITIONS[from].includes(to);
}

// ── Derived views ───────────────────────────────────────────────────────────

/** What the respondent's durable link should show. */
export type RespondentView =
  /** Token fails verification or names no invite. */
  | "invalid"
  /** No session yet, and the invite was consumed. */
  | "consumed"
  /** No session yet, and the invite has expired. */
  | "expired"
  /** No session yet: show the seed form. */
  | "seed"
  /** A question is waiting. */
  | "question"
  /** The session is active but no question is waiting: resume generation. */
  | "preparing"
  /** The round is with the operator, or the session is closed. */
  | "done";

export interface RespondentViewInput {
  invite: { consumedAt: Date | null; expiresAt: Date } | null;
  session: { status: string } | null;
  hasPendingTurn: boolean;
  now?: number;
}

/**
 * Route the respondent. An existing session takes precedence over invite
 * expiry and consumption: the durable link keeps resolving across rounds.
 */
export function deriveRespondentView(input: RespondentViewInput): RespondentView {
  const { invite, session, hasPendingTurn } = input;
  if (!invite) return "invalid";
  if (session) {
    if (session.status === "complete") return "done";
    if (hasPendingTurn) return "question";
    if (session.status === "awaiting_review") return "done";
    if (session.status === "active") return "preparing";
    return "done"; // unknown status: never generate off it
  }
  if (invite.consumedAt) return "consumed";
  if (invite.expiresAt.getTime() < (input.now ?? Date.now())) return "expired";
  return "seed";
}

/** What the operator sees for a session. */
export type OperatorState =
  | "awaiting_respondent"
  | "stalled"
  | "awaiting_review"
  | "complete"
  | "unknown";

export function deriveOperatorState(input: {
  status: string;
  hasPendingTurn: boolean;
}): OperatorState {
  switch (input.status) {
    case "active":
      return input.hasPendingTurn ? "awaiting_respondent" : "stalled";
    case "awaiting_review":
      return "awaiting_review";
    case "complete":
      return "complete";
    default:
      return "unknown";
  }
}
