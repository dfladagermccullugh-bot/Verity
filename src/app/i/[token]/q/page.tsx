import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { invites, sessions, turns } from "@/lib/db/schema";
import { verifyInviteToken } from "@/lib/tokens";
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
  if (session!.completedAt) redirect(`/i/${token}/done`);

  const all = await db
    .select()
    .from(turns)
    .where(eq(turns.sessionId, session!.id));
  const answeredCount = all.filter((t) => t.answer != null).length;

  const [pending] = await db
    .select()
    .from(turns)
    .where(and(eq(turns.sessionId, session!.id), isNull(turns.answer)));

  if (!pending) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-center text-on-surface-variant">
          One moment — please refresh this page.
        </p>
      </main>
    );
  }

  return (
    <Interview
      token={token}
      initialQuestion={pending.questionText}
      initialAnswered={answeredCount}
    />
  );
}
