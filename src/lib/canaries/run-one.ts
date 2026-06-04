/**
 * Drive a single fixture through the interview model loop without touching
 * the database. Mirrors the shape-generation + retry policy of
 * `interview-engine.ts` so the canary measures the same behavior the
 * invitee experiences, minus persistence.
 *
 * Kept separate from the engine on purpose: the engine is DB-coupled and
 * pulling DB-free helpers out would complicate the production path for a
 * test-only callsite. The duplication is small (~30 lines) and audited.
 */

import { callModel, type ChatMessage, getModelName } from "../anthropic";
import { guardOutput, STOP_CONFIRM } from "../guard";
import { RUNAWAY_CEILING } from "../interview-engine";
import type { SeedFixture, SeedMetrics } from "./types";

const REQUIRED_HEADING_PATTERNS = ["^# ", "^## "] as const;

type Shape =
  | { kind: "question"; text: string }
  | { kind: "stop_confirm" }
  | { kind: "prd"; markdown: string };

interface RunCounters {
  rejects: number;
  accepts: number;
  questionLengths: number[];
}

async function generateNextShape(
  messages: ChatMessage[],
  counters: RunCounters,
): Promise<Shape> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await callModel(messages);
    const g = guardOutput(raw);
    if (g.kind === "question") {
      counters.accepts += 1;
      counters.questionLengths.push(g.text.length);
      return { kind: "question", text: g.text };
    }
    if (g.kind === "stop_confirm") {
      counters.accepts += 1;
      return { kind: "stop_confirm" };
    }
    if (g.kind === "prd") {
      counters.accepts += 1;
      return { kind: "prd", markdown: g.markdown };
    }
    counters.rejects += 1;
  }
  return { kind: "stop_confirm" };
}

async function forcePrd(
  messages: ChatMessage[],
  counters: RunCounters,
): Promise<string> {
  const convo: ChatMessage[] = [
    ...messages,
    { role: "assistant", content: STOP_CONFIRM },
    { role: "user", content: "yes" },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await callModel(convo);
    const g = guardOutput(raw);
    if (g.kind === "prd") {
      counters.accepts += 1;
      return g.markdown;
    }
    counters.rejects += 1;
    convo.push({ role: "assistant", content: raw });
    convo.push({
      role: "user",
      content:
        "Write the PRD now. Begin your reply with the line ===PRD=== and include every required section.",
    });
  }
  const fallback = await callModel(convo);
  return fallback.replace(/^===PRD===\s*/, "");
}

/**
 * Run one fixture end-to-end. Returns the metrics needed by the comparator.
 * Throws if the answer script is exhausted before the model terminates —
 * the caller should treat that as a fixture bug, not drift.
 */
export async function runOne(fixture: SeedFixture): Promise<SeedMetrics> {
  const messages: ChatMessage[] = [{ role: "user", content: fixture.seed }];
  const counters: RunCounters = { rejects: 0, accepts: 0, questionLengths: [] };
  let prdMarkdown: string | null = null;
  let terminatedNaturally = true;
  let answersUsed = 0;

  for (let step = 0; step < RUNAWAY_CEILING; step++) {
    const shape = await generateNextShape(messages, counters);

    if (shape.kind === "prd") {
      prdMarkdown = shape.markdown;
      break;
    }
    if (shape.kind === "stop_confirm") {
      // Mirror the engine: silently force the PRD.
      prdMarkdown = await forcePrd(messages, counters);
      break;
    }

    // shape.kind === "question" — supply the next scripted answer.
    if (answersUsed >= fixture.answerScript.length) {
      throw new Error(
        `answer script for "${fixture.id}" exhausted at step ${step + 1}; lengthen the script or accept ceiling termination.`,
      );
    }
    const answer = fixture.answerScript[answersUsed++];
    messages.push({ role: "assistant", content: shape.text });
    messages.push({ role: "user", content: answer });

    if (answer === "done") {
      terminatedNaturally = false;
      prdMarkdown = await forcePrd(messages, counters);
      break;
    }
  }

  if (prdMarkdown === null) {
    // Hit RUNAWAY_CEILING without a PRD — mirror the engine.
    terminatedNaturally = false;
    prdMarkdown = await forcePrd(messages, counters);
  }

  const totalCalls = counters.accepts + counters.rejects;
  const guardRejectRate = totalCalls === 0 ? 0 : counters.rejects / totalCalls;
  const meanQuestionLengthChars =
    counters.questionLengths.length === 0
      ? 0
      : Math.round(
          counters.questionLengths.reduce((s, n) => s + n, 0) /
            counters.questionLengths.length,
        );

  const prdHeadingsPresent: string[] = [];
  for (const pat of REQUIRED_HEADING_PATTERNS) {
    if (new RegExp(pat, "m").test(prdMarkdown)) prdHeadingsPresent.push(pat);
  }

  return {
    turnCount: counters.questionLengths.length,
    guardRejectRate: Math.round(guardRejectRate * 1000) / 1000,
    meanQuestionLengthChars,
    prdHeadingsPresent,
    terminatedNaturally,
  };
}

export function liveModelName(): string {
  return getModelName();
}
