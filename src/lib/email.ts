import "server-only";
import { Resend } from "resend";
import { methodologyFilename } from "./disclosure";

export async function sendPrdEmail(opts: {
  inviteeName: string;
  seed: string;
  sessionId: string;
  prdMarkdown: string;
  methodologyMarkdown: string;
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
    `Session: ${opts.sessionId}`,
    "",
    `Seed:`,
    opts.seed,
    "",
    `Methodology disclosure (AAPOR 2026) attached as ${methodologyFilename(opts.sessionId)}.`,
    "",
    "----- PRD -----",
    "",
    opts.prdMarkdown,
  ].join("\n");

  try {
    await resend.emails.send({
      from,
      to,
      subject,
      text,
      attachments: [
        {
          filename: methodologyFilename(opts.sessionId),
          content: Buffer.from(opts.methodologyMarkdown, "utf-8"),
        },
      ],
    });
  } catch (err) {
    // Delivery failure must not lose the PRD — it is already saved server-side.
    console.error("Resend send failed:", err);
  }
}
