/**
 * The language-model half of answer classification, using Claude.
 *
 * The model is asked one narrow question: what did the respondent mean? It never writes anything
 * that is spoken, and whatever it returns is checked again in code (`checkVerdict`) before it
 * counts. A refusal, a timeout or malformed output all end the same way: the reply is treated as
 * unclear and the interviewer asks again.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Answer, Item } from "../instrument/types.js";
import type { ModelClassifier, ModelRequest, ModelVerdict } from "./classify.js";

/** A small, fast model: a caller is waiting on the line. Override with VERITY_CLASSIFIER_MODEL. */
export const DEFAULT_CLASSIFIER_MODEL = "claude-haiku-5-5";

/** Bump when the instructions or the reply format change; it is recorded with every verdict. */
export const CLASSIFIER_PROMPT_VERSION = "1";

const Reply = z.object({
  intent: z.enum(["answer", "dont_know", "refused", "yes", "no", "repeat", "opt_out", "stop", "callback", "question", "unclear"]),
  option_code: z.string().nullable(),
  number: z.number().nullable(),
  confidence: z.number(),
  evidence: z.string(),
});
type Reply = z.infer<typeof Reply>;

export const CLASSIFIER_INSTRUCTIONS = `You classify what a survey respondent said on a phone call. You do not talk to the respondent and nothing you write is spoken. A separate program decides what happens next and checks your output.

You are given the question that was just asked and the respondent's reply as transcribed by speech recognition (it may contain recognition errors).

Return:
- intent: one of
  - "answer": the reply answers the question. For a question with options, set option_code to the code of the one option they chose. For a number question, set number. For an open question, leave both null.
  - "dont_know": they said they do not know or cannot say.
  - "refused": they declined to answer this question.
  - "yes" / "no": only when the question is a consent question.
  - "repeat": they asked to hear the question or the options again.
  - "opt_out": they asked not to be called again or to be removed from the list.
  - "stop": they want to end the call now.
  - "callback": they asked to be called at another time.
  - "question": they asked what something means or asked the interviewer something else.
  - "unclear": none of the above can be told from the reply.
- confidence: from 0 to 1, how sure you are that a careful human coder listening to the call would code it the same way. Use below 0.6 when the reply is hedged, falls between two options, names an option that is not offered, or could be a recognition error. Use 0.9 or above only when the reply plainly settles it.
- evidence: the exact words from the reply that your decision rests on, copied character for character. Never paraphrase, never add words.

Rules:
- Code only what the respondent said. Do not infer an answer from tone, from politeness, or from what is likely.
- If they give an answer and then change it, code the final one.
- If the reply fits two options about equally, choose "unclear".
- Do not pick the nearest option for a reply that fits none; choose "unclear".
- For a number question, convert spoken numbers ("a dozen", "twenty five") to a number. A range ("ten to fifteen") or a vague amount ("a few") is "unclear".`;

export function describeRequest(req: ModelRequest): string {
  if (req.expecting === "consent" || !req.item) {
    return JSON.stringify({ question_type: "consent", question: "Do you agree to take part? (yes or no)", reply: req.utterance });
  }
  const item = req.item;
  const base = { question: item.text, reply: req.utterance };
  if (item.kind === "single" || item.kind === "scale" || item.kind === "grid") {
    return JSON.stringify({ question_type: "choose one option", ...base, options: (item.choices ?? []).map((c) => ({ code: c.code, label: c.label })) });
  }
  if (item.kind === "number") return JSON.stringify({ question_type: "number", ...base, minimum: item.number?.min ?? null, maximum: item.number?.max ?? null });
  return JSON.stringify({ question_type: "open answer in their own words", ...base });
}

/** Turn the model's reply into a verdict. Shape problems become "unclear"; content is checked later. */
export function toVerdict(reply: Reply, req: ModelRequest): ModelVerdict {
  const base = { confidence: reply.confidence, evidence: reply.evidence };
  if (reply.intent === "dont_know") return { ...base, intent: "answer", answer: { kind: "nonresponse", reason: "dont_know" } };
  if (reply.intent === "refused") return { ...base, intent: "answer", answer: { kind: "nonresponse", reason: "refused" } };
  if (reply.intent !== "answer") return { ...base, intent: reply.intent };
  const item: Item | undefined = req.item;
  let answer: Answer | undefined;
  if (item?.kind === "single" || item?.kind === "scale" || item?.kind === "grid") {
    if (reply.option_code !== null) answer = { kind: "choice", code: reply.option_code };
  } else if (item?.kind === "number") {
    if (reply.number !== null) answer = { kind: "number", value: reply.number };
  } else if (item?.kind === "text") answer = { kind: "text", value: req.utterance };
  return answer ? { ...base, intent: "answer", answer } : { ...base, intent: "unclear" };
}

/** The part of the Anthropic client this module uses; lets tests supply a stand-in. */
export interface ParseClient {
  messages: { parse(body: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ stop_reason: string | null; parsed_output: unknown }> };
}

export interface ClaudeClassifierOptions {
  client?: ParseClient;
  model?: string;
  /** Milliseconds to wait before giving up on one reading. */
  timeoutMs?: number;
}

export function claudeClassifier(opts: ClaudeClassifierOptions = {}): ModelClassifier {
  const model = opts.model ?? process.env.VERITY_CLASSIFIER_MODEL ?? DEFAULT_CLASSIFIER_MODEL;
  // Credentials come from the environment (ANTHROPIC_API_KEY or an `ant auth login` profile).
  const client: ParseClient = opts.client ?? (new Anthropic() as unknown as ParseClient);
  return {
    id: `${model}/prompt-v${CLASSIFIER_PROMPT_VERSION}`,
    async classify(req: ModelRequest): Promise<ModelVerdict> {
      const response = await client.messages.parse(
        {
          model,
          max_tokens: 1024,
          system: CLASSIFIER_INSTRUCTIONS,
          messages: [{ role: "user", content: describeRequest(req) }],
          // Low effort: this is a short classification and a caller is waiting.
          output_config: { effort: "low", format: zodOutputFormat(Reply) },
        },
        { timeout: opts.timeoutMs ?? 6000, maxRetries: 1 },
      );
      if (response.stop_reason === "refusal") throw new Error("the model declined to classify this reply");
      if (response.stop_reason === "max_tokens") throw new Error("the model's reply was cut off");
      const parsed = Reply.safeParse(response.parsed_output);
      if (!parsed.success) throw new Error("the model's reply did not match the expected format");
      return toVerdict(parsed.data, req);
    },
  };
}

/**
 * Compile-time check that the real SDK accepts the request this module sends. Never called.
 * If the SDK's request shape changes, this stops compiling.
 */
export async function _sdkShapeCheck(client: Anthropic): Promise<void> {
  await client.messages.parse(
    { model: DEFAULT_CLASSIFIER_MODEL, max_tokens: 1024, system: CLASSIFIER_INSTRUCTIONS, messages: [{ role: "user", content: "{}" }], output_config: { effort: "low", format: zodOutputFormat(Reply) } },
    { timeout: 6000, maxRetries: 1 },
  );
}
