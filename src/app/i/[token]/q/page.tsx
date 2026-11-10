import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { invites, turns } from "@/lib/db/schema";
import { verifyInviteToken } from "@/lib/tokens";
import { advance, pendingTurn, sessionByInvite } from "@/lib/interview-engine";
import ThinkingScreen from "@/components/thinking-screen";
import Interview from "./interview";

export const dynamic = "force-dynamic";
// Hosts the answer action: generation + finalize can take several model calls.
export const maxDuration = 60;

export default async function InterviewPage({
  params,
}: {
  params: { token: string };
}) {
  const token = params.token;
  if (!verifyInviteToken(token)) redirect(`/i/${token}`);

  const invite = await db.query.invites.findFirst({
    where: eq(invites.token, token),
  });
  if (!invite) redirect(`/i/${token}`);

  const session = await sessionByInvite(invite!.id);
  if (!session) redirect(`/i/${token}`);

  let pending = await pendingTurn(session!.id);

  // No question waiting. A session that is not active rests on /done. An
  // active one was interrupted mid-step (or is being advanced right now):
  // advance is idempotent, so resume it here instead of waiting forever.
  if (!pending) {
    if (session!.status !== "active") redirect(`/i/${token}/done`);
    let result;
    try {
      result = await advance(session!.id);
    } catch {
      return <ThinkingScreen label="Preparing your next question… reload in a moment." />;
    }
    if (result.kind === "done") redirect(`/i/${token}/done`);
    pending = await pendingTurn(session!.id);
    if (!pending) redirect(`/i/${token}/done`);
  }

  // Progress reflects the current round only.
  const all = await db
    .select()
    .from(turns)
    .where(eq(turns.sessionId, session!.id));
  const answeredCount = all.filter(
    (t) => t.roundId === pending!.roundId && t.answer != null
  ).length;

  return (
    <Interview
      token={token}
      initialTurnId={pending!.id}
      initialQuestion={pending!.questionText}
      initialAnswered={answeredCount}
    />
  );
}
