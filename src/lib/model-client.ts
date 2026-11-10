/**
 * Raw Anthropic calls with no `server-only` marker and no bundler-specific
 * imports, so the canary script (plain `tsx`) can use the same client as the
 * app. The system prompt is always passed in; `anthropic.ts` is the
 * server-only binding that supplies the interview skill.
 */
import Anthropic from "@anthropic-ai/sdk";

export type ChatMessage = { role: "user" | "assistant"; content: string };

/** One model reply: the text plus why generation stopped. */
export interface ModelReply {
  text: string;
  /** `end_turn`, `max_tokens`, `stop_sequence`, … or null when not reported. */
  stopReason: string | null;
}

/** Max tokens passed to every model call. Surfaced for disclosure. */
export const MAX_TOKENS = 4096;

/** Per-request timeout. The SDK default is ten minutes, far beyond any
 *  serverless budget; a stuck call should fail fast and leave the session
 *  resumable instead. */
export const MODEL_TIMEOUT_MS = 50_000;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    client = new Anthropic({ apiKey, timeout: MODEL_TIMEOUT_MS });
  }
  return client;
}

export function getModelName(): string {
  return process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
}

function textOf(content: { type: string }[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/**
 * One interview call. Uses prompt caching: the system prompt and the
 * conversation prefix up to the previous assistant turn are marked cacheable,
 * so each new turn only sends the delta. The model still receives the full
 * prompt + history.
 */
export async function callModelWithSystem(
  systemPrompt: string,
  messages: ChatMessage[]
): Promise<ModelReply> {
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
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: formatted,
  });
  return { text: textOf(resp.content), stopReason: resp.stop_reason ?? null };
}

/** One-shot call with a custom system prompt (sidecars: critic, probe,
 *  moderation). Never shares the interview's cached prefix. */
export async function callOneShotWithSystem(
  systemPrompt: string,
  userMessage: string
): Promise<ModelReply> {
  const resp = await getClient().messages.create({
    model: getModelName(),
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });
  return { text: textOf(resp.content), stopReason: resp.stop_reason ?? null };
}
