import "server-only";
import { getSkillPrompt } from "./skill/version";
import {
  callModelWithSystem,
  callOneShotWithSystem,
  type ChatMessage,
  type ModelReply,
} from "./model-client";

// Server-only binding over `model-client.ts`: supplies the interview skill as
// the system prompt. Scripts (the canary) use `model-client.ts` directly.
export { getModelName, MAX_TOKENS } from "./model-client";
export type { ChatMessage, ModelReply } from "./model-client";

/** One interview call. System prompt is always the server-side skill. */
export async function callModel(messages: ChatMessage[]): Promise<ModelReply> {
  return callModelWithSystem(getSkillPrompt(), messages);
}

/** One-shot call with a custom system prompt. Used for sidecar calls that are
 *  not part of the interview loop (e.g. the construct-validity probe) — they
 *  must not inherit the interview system prompt or pollute its cached prefix. */
export async function callModelOneShot(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const reply = await callOneShotWithSystem(systemPrompt, userMessage);
  return reply.text;
}
