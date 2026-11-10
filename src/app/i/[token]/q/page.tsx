import { redirect } from "next/navigation";
import { loadRespondent } from "@/lib/respondent";
import Interview from "./interview";
import Resume from "./resume";

export const dynamic = "force-dynamic";
// Hosts the answer / resume actions: generation + finalize can take several
// model calls.
export const maxDuration = 60;

export default async function InterviewPage({
  params,
}: {
  params: { token: string };
}) {
  const token = params.token;
  const r = await loadRespondent(token);

  switch (r.view) {
    case "question":
      return (
        <Interview
          token={token}
          initialTurnId={r.pending!.id}
          initialQuestion={r.pending!.questionText}
          initialAnswered={r.answeredInRound}
        />
      );
    case "preparing":
      // Active, no question waiting: resume instead of a static screen.
      return <Resume token={token} />;
    case "done":
      redirect(`/i/${token}/done`);
    default:
      redirect(`/i/${token}`);
  }
}
