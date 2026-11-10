import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { invites, sessions, turns } from "@/lib/db/schema";
import { verifyInviteToken } from "@/lib/tokens";
import NoticeScreen from "@/components/notice-screen";
import SeedForm from "./seed-form";

export const dynamic = "force-dynamic";
// Hosts the start action: moderation, the construct probe and the first
// generation can take several model calls.
export const maxDuration = 60;

function InvalidLink({ message }: { message: string }) {
  return (
    <NoticeScreen
      eyebrow="Invalid link"
      title="Invalid or expired link"
      body={message}
      tone="error"
    />
  );
}

export default async function SeedPage({ params }: { params: { token: string } }) {
  const token = params.token;
  const invalidMessage =
    "The invitation link you used is no longer valid. It may have expired, been revoked, or already been used. Please contact the operator who issued it.";
  if (!verifyInviteToken(token)) {
    return <InvalidLink message={invalidMessage} />;
  }

  const invite = await db.query.invites.findFirst({
    where: eq(invites.token, token),
  });
  if (!invite) return <InvalidLink message={invalidMessage} />;

  // An existing session takes precedence over invite expiry/consumption — the
  // durable link must keep resolving across rounds. Route to whatever is next.
  const existing = await db.query.sessions.findFirst({
    where: eq(sessions.inviteId, invite.id),
  });
  if (existing) {
    const [pending] = await db
      .select()
      .from(turns)
      .where(and(eq(turns.sessionId, existing.id), isNull(turns.answer)));
    if (pending) redirect(`/i/${token}/q`);
    // An active session with no question waiting was interrupted mid-step:
    // /q resumes it. A finalized round rests on /done until the operator
    // opens another round, which creates a new pending turn (routes above).
    if (existing.status === "active") redirect(`/i/${token}/q`);
    redirect(`/i/${token}/done`);
  }

  if (invite.consumedAt)
    return (
      <InvalidLink message="This invitation has already been completed. Thank you — you can close this tab." />
    );
  if (invite.expiresAt.getTime() < Date.now())
    return (
      <InvalidLink message="This invitation link has expired. Please contact the operator who issued it for a new one." />
    );

  return <SeedForm token={token} inviteeName={invite.inviteeName} />;
}
