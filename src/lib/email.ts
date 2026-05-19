import "server-only";
import { Resend } from "resend";

export async function sendPrdEmail(opts: {
  inviteeName: string;
  seed: string;
  prdMarkdown: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.DAVIN_EMAIL;
  const from = process.env.RESEND_FROM || "onboarding@resend.dev";
  if (!apiKey || !to) {
    console.error("Email skipped: RESEND_API_KEY or DAVIN_EMAIL missing");
    return;
  }

  const resend = new Resend(apiKey);
  const subject = `New PRD from ${opts.inviteeName}`;
  const text = [
    `Invitee: ${opts.inviteeName}`,
    "",
    `Seed:`,
    opts.seed,
    "",
    "----- PRD -----",
    "",
    opts.prdMarkdown,
  ].join("\n");

  try {
    await resend.emails.send({ from, to, subject, text });
  } catch (err) {
    // Delivery failure must not lose the PRD — it is already saved server-side.
    console.error("Resend send failed:", err);
  }
}
