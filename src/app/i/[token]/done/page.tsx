import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { invites, sessions } from "@/lib/db/schema";
import { verifyInviteToken } from "@/lib/tokens";
import Puppy from "./puppy";

export const dynamic = "force-dynamic";

export default async function DonePage({
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
    where: eq(sessions.inviteId, invite.id),
  });
  if (!session) redirect(`/i/${token}`);
  if (!session.completedAt) redirect(`/i/${token}/q`);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <Puppy />
      <p className="mt-6 text-center text-on-surface-variant">
        Your idea&apos;s in good hands.
      </p>
    </main>
  );
}
