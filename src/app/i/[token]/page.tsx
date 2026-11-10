import { redirect } from "next/navigation";
import NoticeScreen from "@/components/notice-screen";
import { loadRespondent } from "@/lib/respondent";
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
  // An existing session takes precedence over invite expiry/consumption — the
  // durable link keeps resolving across rounds (see deriveRespondentView).
  const r = await loadRespondent(token);

  switch (r.view) {
    case "question":
    case "preparing":
      redirect(`/i/${token}/q`);
    case "done":
      redirect(`/i/${token}/done`);
    case "consumed":
      return (
        <InvalidLink message="This invitation has already been completed. Thank you — you can close this tab." />
      );
    case "expired":
      return (
        <InvalidLink message="This invitation link has expired. Please contact the operator who issued it for a new one." />
      );
    case "seed":
      return <SeedForm token={token} inviteeName={r.invite!.inviteeName} />;
    default:
      return (
        <InvalidLink message="The invitation link you used is no longer valid. It may have expired, been revoked, or already been used. Please contact the operator who issued it." />
      );
  }
}
