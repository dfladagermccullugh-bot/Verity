import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getSkillPrompt } from "./skill/version";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    client = new Anthropic({ apiKey });
  }
  return client;
}

function model(): string {
  return process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
}

export type ChatMessage = { role: "user" | "assistant"; content: string };

/** One raw model call. System prompt is always the server-side skill. */
export async function callModel(messages: ChatMessage[]): Promise<string> {
  const resp = await getClient().messages.create({
    model: model(),
    max_tokens: 4096,
    system: getSkillPrompt(),
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });
  return resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
