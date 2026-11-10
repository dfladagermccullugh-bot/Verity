import type { ChatMessage, ModelReply } from "@/lib/model-client";
import type { ModelFn } from "@/lib/interview-policy";

/**
 * A scripted stand-in for the model. Each call shifts the next reply off the
 * script (a string, a full reply, or a function of the messages). Every call's
 * messages are recorded for assertions. Throws when the script runs out so a
 * test never silently loops.
 */
export type ScriptStep =
  | string
  | ModelReply
  | Error
  | ((messages: ChatMessage[]) => string | ModelReply | Promise<string | ModelReply>);

export function scriptedModel(script: ScriptStep[]) {
  const calls: ChatMessage[][] = [];
  const fn: ModelFn = async (messages) => {
    calls.push(messages.map((m) => ({ ...m })));
    const step = script.shift();
    if (step === undefined) throw new Error("scripted model: script exhausted");
    if (step instanceof Error) throw step;
    const out = typeof step === "function" ? await step(messages) : step;
    return typeof out === "string" ? { text: out, stopReason: "end_turn" } : out;
  };
  return { fn, calls, remaining: () => script.length };
}

/** A valid PRD reply with every required heading. */
export const PRD_REPLY = [
  "===PRD===",
  "# One-line pitch",
  "A thing.",
  "## Problem",
  "People need it.",
  "## Primary user",
  "Parents.",
  "## Core jobs",
  "Track it.",
  "## Must-have features (MVP)",
  "- One",
  "## Open questions",
  "- Is it free?",
].join("\n");
