import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { invites, sessions, turns } from "@/lib/db/schema";
import { verifyInviteToken } from "@/lib/tokens";
import { getSkillVersion } from "@/lib/skill/version";
import Interview from "./interview";

export const dynamic = "force-dynamic";

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

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.inviteId, invite!.id),
  });
  if (!session) redirect(`/i/${token}`);

  const [pending] = await db
    .select()
    .from(turns)
    .where(and(eq(turns.sessionId, session!.id), isNull(turns.answer)));

  // No question waiting: a finalized round (awaiting review or complete) rests
  // on /done; otherwise the next round's question is still being prepared.
  if (!pending) {
    if (session!.completedAt) redirect(`/i/${token}/done`);
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-label-sm text-on-surface-variant">
          Standby — refresh to resume
        </p>
      </main>
    );
  }

  // Progress reflects the current round only.
  const all = await db
    .select()
    .from(turns)
    .where(eq(turns.sessionId, session!.id));
  const answeredCount = all.filter(
    (t) => t.roundId === pending.roundId && t.answer != null
  ).length;

  return (
    <Interview
      token={token}
      initialQuestion={pending.questionText}
      initialAnswered={answeredCount}
      protocol={getSkillVersion()}
    />
  );
}
