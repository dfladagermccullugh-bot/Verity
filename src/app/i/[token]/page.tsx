import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { invites, sessions, turns } from "@/lib/db/schema";
import { verifyInviteToken } from "@/lib/tokens";
import SeedForm from "./seed-form";

export const dynamic = "force-dynamic";

function InvalidLink({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-margin-mobile md:px-margin-desktop">
      <div className="max-w-md text-center">
        <p className="text-label-sm uppercase tracking-engrave text-error">
          Access denied
        </p>
        <p className="mt-4 text-body-lg text-on-surface-variant opacity-80">
          {message}
        </p>
      </div>
    </main>
  );
}

export default async function SeedPage({ params }: { params: { token: string } }) {
  const token = params.token;
  if (!verifyInviteToken(token)) {
    return <InvalidLink message="This link is not valid." />;
  }

  const invite = await db.query.invites.findFirst({
    where: eq(invites.token, token),
  });
  if (!invite) return <InvalidLink message="This link is not valid." />;

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
    if (existing.status === "complete") redirect(`/i/${token}/done`);
    redirect(`/i/${token}/q`);
  }

  if (invite.consumedAt)
    return <InvalidLink message="This link has already been used. Thank you!" />;
  if (invite.expiresAt.getTime() < Date.now())
    return <InvalidLink message="This link has expired." />;

  return <SeedForm token={token} inviteeName={invite.inviteeName} />;
}
