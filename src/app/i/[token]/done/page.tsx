import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { invites, sessions } from "@/lib/db/schema";
import { verifyInviteToken } from "@/lib/tokens";
import {
  BrandHeader,
  Scanline,
  GridUnderlay,
  ContextTag,
  TelemetryFooter,
} from "@/components/chrome";

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
  // Sticky once any round has been compiled. A follow-up round may already be
  // queued (pull-based) — the respondent reaches it by reopening their link,
  // not by being bounced from this screen.
  if (!session.completedAt) redirect(`/i/${token}/q`);

  return (
    <>
      <Scanline />
      <BrandHeader />
      <main className="relative flex min-h-screen items-center justify-center px-margin-mobile md:px-margin-desktop">
        <GridUnderlay />
        <div className="z-10 w-full max-w-3xl">
          <ContextTag label="Sequence Complete" />
          <h1 className="mt-10 text-display-lg-mobile text-on-surface md:text-display-lg">
            Brief compiled.
          </h1>
          <p className="mt-5 max-w-2xl border-l border-hairline pl-6 text-body-lg text-on-surface-variant opacity-80">
            The structured brief and its methodology record have been
            transmitted. This session is closed. You may disconnect.
          </p>
        </div>
      </main>
      <TelemetryFooter status="Closed" />
    </>
  );
}
