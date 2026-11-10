import "server-only";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "./db";
import { invites, turns, type Invite, type Session, type Turn } from "./db/schema";
import { verifyInviteToken } from "./tokens";
import { deriveRespondentView, type RespondentView } from "./lifecycle";
import { pendingTurn, sessionByInvite } from "./interview-engine";

export interface RespondentState {
  view: RespondentView;
  invite: Invite | null;
  session: Session | null;
  pending: Turn | null;
  /** Answered questions in the pending turn's round (progress display). */
  answeredInRound: number;
}

/**
 * The one place respondent routing is derived: every `/i/[token]` page loads
 * this and acts on `view` (see `deriveRespondentView`).
 */
export async function loadRespondent(token: string): Promise<RespondentState> {
  const none = { invite: null, session: null, pending: null, answeredInRound: 0 };
  if (!verifyInviteToken(token)) return { view: "invalid", ...none };
  const invite = (await db.query.invites.findFirst({ where: eq(invites.token, token) })) ?? null;
  if (!invite) return { view: "invalid", ...none };
  const session = await sessionByInvite(invite.id);
  const pending = session ? await pendingTurn(session.id) : null;
  let answeredInRound = 0;
  if (pending?.roundId) {
    const rows = await db
      .select({ id: turns.id })
      .from(turns)
      .where(and(eq(turns.roundId, pending.roundId), isNotNull(turns.answer)));
    answeredInRound = rows.length;
  }
  return {
    view: deriveRespondentView({ invite, session, hasPendingTurn: !!pending }),
    invite,
    session,
    pending,
    answeredInRound,
  };
}
