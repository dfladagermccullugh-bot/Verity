/**
 * Drive a single fixture through the interview model loop without touching
 * the database. Uses the same generation policy module as
 * `interview-engine.ts` (`interview-policy.ts`), so the canary measures the
 * behaviour the invitee experiences, minus persistence.
 *
 * No `server-only`, no `.md` import: the caller injects the model (bound to
 * the skill prompt it read from disk), so this runs under plain `tsx`.
 */

import { getModelName, type ChatMessage } from "../model-client";
import { classifyDimension } from "../dimensions";
import type { CoverageTurn } from "../coverage";
import {
  RUNAWAY_CEILING,
  enforceCoverage,
  forcePrd,
  generateNextShape,
  type GenResult,
  type ModelFn,
  type NextShape,
} from "../interview-policy";
import type { SeedFixture, SeedMetrics } from "./types";

const REQUIRED_HEADING_PATTERNS = ["^# ", "^## "] as const;

interface RunCounters {
  rejects: number;
  accepts: number;
  questionLengths: number[];
}

/** Fold one policy generation into the canary counters. */
function count(gen: GenResult, counters: RunCounters): NextShape {
  counters.rejects += gen.regenCount;
  if (gen.shape.kind !== "exhausted") counters.accepts += 1;
  if (gen.shape.kind === "question") counters.questionLengths.push(gen.shape.text.length);
  return gen.shape;
}

async function prd(
  model: ModelFn,
  messages: ChatMessage[],
  counters: RunCounters,
): Promise<string> {
  const r = await forcePrd(model, messages);
  counters.rejects += r.rejects;
  if (r.accepted) counters.accepts += 1;
  return r.markdown;
}

/**
 * Run one fixture end-to-end. Returns the metrics needed by the comparator.
 * Throws if the answer script is exhausted before the model terminates —
 * the caller should treat that as a fixture bug, not drift.
 */
export async function runOne(fixture: SeedFixture, model: ModelFn): Promise<SeedMetrics> {
  const messages: ChatMessage[] = [{ role: "user", content: fixture.seed }];
  const counters: RunCounters = { rejects: 0, accepts: 0, questionLengths: [] };
  const answered: CoverageTurn[] = [];
  let prdMarkdown: string | null = null;
  let terminatedNaturally = true;
  let answersUsed = 0;

  for (let step = 0; step < RUNAWAY_CEILING; step++) {
    const gen = await generateNextShape(model, messages);
    let shape = count(gen, counters);
    // The engine's coverage gate, before honouring an early stop.
    if (shape.kind !== "question") {
      const cov = await enforceCoverage(model, messages, answered, gen);
      if (cov.nudge) count(cov.nudge, counters);
      shape = cov.gen.shape;
    }

    if (shape.kind === "prd") {
      prdMarkdown = shape.markdown;
      break;
    }
    if (shape.kind === "stop_confirm" || shape.kind === "exhausted") {
      // Mirror the engine: silently force the PRD.
      prdMarkdown = await prd(model, messages, counters);
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
    answered.push({ answer, constructDimension: classifyDimension(shape.text) });

    if (answer === "done") {
      terminatedNaturally = false;
      prdMarkdown = await prd(model, messages, counters);
      break;
    }
  }

  if (prdMarkdown === null) {
    // Hit RUNAWAY_CEILING without a PRD — mirror the engine.
    terminatedNaturally = false;
    prdMarkdown = await prd(model, messages, counters);
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
