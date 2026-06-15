import "server-only";
import { Resend } from "resend";
import { methodologyFilename, analysisFilename } from "./disclosure";

export async function sendPrdEmail(opts: {
  inviteeName: string;
  seed: string;
  sessionId: string;
  prdMarkdown: string;
  methodologyMarkdown: string;
  /** Optional companion analysis document, attached when present. */
  analysisMarkdown?: string;
  /** PRD version (round number); defaults to 1. */
  prdVersion?: number;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.DAVIN_EMAIL;
  const from = process.env.RESEND_FROM || "onboarding@resend.dev";
  if (!apiKey || !to) {
    console.error("Email skipped: RESEND_API_KEY or DAVIN_EMAIL missing");
    return;
  }

  const resend = new Resend(apiKey);
  const version = opts.prdVersion ?? 1;
  const subject =
    version > 1
      ? `Updated PRD (v${version}) from ${opts.inviteeName}`
      : `New PRD from ${opts.inviteeName}`;
  const text = [
    `Invitee: ${opts.inviteeName}`,
    `Session: ${opts.sessionId}`,
    `PRD version (round): ${version}`,
    "",
    `Seed:`,
    opts.seed,
    "",
    `Methodology disclosure (AAPOR 2026) attached as ${methodologyFilename(opts.sessionId)}.`,
    opts.analysisMarkdown
      ? `Response-quality analysis attached as ${analysisFilename(opts.sessionId)}.`
      : "",
    "",
    "----- PRD -----",
    "",
    opts.prdMarkdown,
  ].join("\n");

  const attachments = [
    {
      filename: methodologyFilename(opts.sessionId),
      content: Buffer.from(opts.methodologyMarkdown, "utf-8"),
    },
  ];
  if (opts.analysisMarkdown) {
    attachments.push({
      filename: analysisFilename(opts.sessionId),
      content: Buffer.from(opts.analysisMarkdown, "utf-8"),
    });
  }

  try {
    await resend.emails.send({
      from,
      to,
      subject,
      text,
      attachments,
    });
  } catch (err) {
    // Delivery failure must not lose the PRD — it is already saved server-side.
    console.error("Resend send failed:", err);
  }
}
