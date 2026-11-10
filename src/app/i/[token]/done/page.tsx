import { redirect } from "next/navigation";
import { loadRespondent } from "@/lib/respondent";
import { BrandHeader, ContextTag, SiteFooter } from "@/components/chrome";

export const dynamic = "force-dynamic";

export default async function DonePage({
  params,
}: {
  params: { token: string };
}) {
  const token = params.token;
  const r = await loadRespondent(token);
  if (!r.session) redirect(`/i/${token}`);
  // Leave only for a question that is actually waiting. ("preparing" stays
  // here: /q resumes interrupted sessions, and bouncing back when there is
  // nothing left to generate would loop.)
  if (r.view === "question") redirect(`/i/${token}/q`);

  // Awaiting review: the operator may still open another round on this same
  // link, so the session is not "closed" yet.
  const closed = r.session.status === "complete";

  return (
    <>
      <BrandHeader />
      <main className="relative flex min-h-screen items-center justify-center px-margin-mobile md:px-margin-desktop">
        <div className="z-10 w-full max-w-3xl">
          <ContextTag label={closed ? "Session closed" : "Answers received"} />
          <h1 className="mt-10 text-display-lg-mobile tracking-tight text-on-surface md:text-display-lg">
            {closed ? "All done." : "Thank you — your answers are in."}
          </h1>
          <p className="mt-5 max-w-2xl border-l-2 border-hairline pl-6 text-body-lg text-on-surface-variant">
            {closed
              ? "This session is closed — there is nothing more to answer. You can close this tab."
              : "Your answers have been sent for review. If there is more to ask, this same link will show the next questions — otherwise there is nothing more to do. You can close this tab."}
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
