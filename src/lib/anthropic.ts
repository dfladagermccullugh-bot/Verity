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

export function getModelName(): string {
  return process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
}

/** Max tokens passed to every model call. Surfaced for disclosure. */
export const MAX_TOKENS = 4096;

export type ChatMessage = { role: "user" | "assistant"; content: string };

/** One raw model call. System prompt is always the server-side skill.
 *  Uses prompt caching: the skill system prompt and the conversation prefix
 *  up to the previous assistant turn are marked cacheable, so each new turn
 *  only sends the delta. The model still receives the full prompt + history. */
export async function callModel(messages: ChatMessage[]): Promise<string> {
  // Cache the prefix up to and including the most recent assistant message.
  // If there is none yet (first turn), cache through the seed instead so the
  // next turn benefits.
  let cacheIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      cacheIdx = i;
      break;
    }
  }
  if (cacheIdx === -1 && messages.length > 0) cacheIdx = 0;

  const formatted = messages.map((m, i) => {
    if (i === cacheIdx) {
      return {
        role: m.role,
        content: [
          {
            type: "text" as const,
            text: m.content,
            cache_control: { type: "ephemeral" as const },
          },
        ],
      };
    }
    return { role: m.role, content: m.content };
  });

  const resp = await getClient().beta.promptCaching.messages.create({
    model: getModelName(),
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: "text",
        text: getSkillPrompt(),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: formatted,
  });
  return resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
