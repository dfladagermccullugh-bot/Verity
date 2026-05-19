import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Fast local prefilter — obvious disallowed-intent terms. Not exhaustive;
// the Claude classify call is the real check.
const HARD_BLOCK = [
  "child sexual",
  "csam",
  "child porn",
  "make a bomb",
  "build a bomb",
  "bioweapon",
  "nerve agent",
  "mass shooting",
  "kill my",
  "how to kill",
];

export type ModerationResult = { allowed: boolean; reason?: string };

export async function moderateSeed(seed: string): Promise<ModerationResult> {
  const lower = seed.toLowerCase();
  for (const t of HARD_BLOCK) {
    if (lower.includes(t)) return { allowed: false, reason: "prefilter" };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { allowed: true };

  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: 8,
      system:
        "You are a content safety classifier for a product-idea intake form. " +
        "Reply with exactly one word: ALLOW if the text is a benign product or app idea, " +
        "or BLOCK if it requests or describes serious harm (weapons of mass destruction, " +
        "CSAM, credible violence, or clearly illegal activity). Reply with only ALLOW or BLOCK.",
      messages: [{ role: "user", content: seed.slice(0, 1000) }],
    });
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()
      .toUpperCase();
    if (text.startsWith("BLOCK")) return { allowed: false, reason: "classifier" };
    return { allowed: true };
  } catch (err) {
    // Fail open on classifier error — the seed is low-sensitivity and the
    // prefilter already caught the worst cases.
    console.error("Moderation classify failed:", err);
    return { allowed: true };
  }
}
