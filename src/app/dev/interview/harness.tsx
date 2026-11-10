"use client";

import { useEffect, useState } from "react";
import type { StepResponse } from "@/actions/interview";
import Interview, { type InterviewActions } from "@/app/i/[token]/q/interview";

type Call = { kind: "answer" | "resume"; turnId?: string; value?: string; paradata?: unknown; at: number };
type HarnessWindow = Window & { __verity?: { calls: Call[]; done: boolean } };

/**
 * Stubbed actions with a fake "server": each answer is saved, then after
 * `?delay=` ms the next question returns. `?fail=1` makes the first answer
 * save but report a failure, so "Try again" must resync to the next turn.
 */
export default function Harness() {
  // Client-only (reads window): build the stubs after mount.
  const [actions, setActions] = useState<InterviewActions | null>(null);
  useEffect(() => setActions(makeActions()), []);
  if (!actions) return null;

  return (
    <Interview
      token="harness"
      initialTurnId="turn-1"
      initialQuestion="Question 1?"
      initialAnswered={0}
      actions={actions}
      onDone={() => {
        (window as HarnessWindow).__verity!.done = true;
      }}
    />
  );
}

function makeActions(): InterviewActions {
  const params = new URLSearchParams(window.location.search);
  const delay = Number(params.get("delay") ?? "800");
  let failNext = params.get("fail") === "1";
  let current = 1; // server-side pending turn number
  const w = window as HarnessWindow;
  w.__verity = { calls: [], done: false };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const question = (n: number): StepResponse => ({
    ok: true,
    kind: "question",
    turnId: `turn-${n}`,
    text: `Question ${n}?`,
    answered: n - 1,
  });
  return {
    async answer(_token, turnId, value, paradata) {
      w.__verity!.calls.push({ kind: "answer", turnId, value, paradata, at: performance.now() });
      await sleep(delay);
      if (turnId === `turn-${current}`) current += 1; // claimed
      if (value === "done") return { ok: true, kind: "done" };
      if (failNext) {
        failNext = false;
        return { ok: false, error: "That didn't go through — please try again." };
      }
      return question(current);
    },
    async resume() {
      w.__verity!.calls.push({ kind: "resume", at: performance.now() });
      await sleep(Math.min(delay, 300));
      return question(current);
    },
  };
}
