/**
 * The respondent's interview card as a pure state machine:
 *
 *   asking ──submit──▶ submitting ──question──▶ asking (next turn)
 *                         │   └──────done──────▶ leaving
 *                         └──fail──▶ failed ──retry──▶ submitting (resync)
 *
 * Pure (no React, no I/O) so it is unit-tested directly; `interview.tsx`
 * drives it with `useReducer`.
 */
import type { Answer } from "./lifecycle";

export type Phase = "asking" | "submitting" | "failed" | "leaving";

export interface InterviewState {
  phase: Phase;
  turnId: string;
  question: string;
  /** Answered questions in this round (progress bar, "Question N"). */
  answered: number;
  error: string | null;
  /** The answer in flight, for the exit animation direction. */
  inFlight: Answer | null;
  /** Bumped per transition so the animated block remounts. */
  key: number;
}

export type InterviewEvent =
  | { type: "submit"; value: Answer }
  | { type: "question"; turnId: string; text: string; answered: number }
  | { type: "done" }
  | { type: "fail"; error: string }
  | { type: "retry" };

export function initialInterviewState(input: {
  turnId: string;
  question: string;
  answered: number;
}): InterviewState {
  return { phase: "asking", error: null, inFlight: null, key: 0, ...input };
}

export function interviewReducer(state: InterviewState, event: InterviewEvent): InterviewState {
  switch (event.type) {
    case "submit":
      // Only a visible question can be answered; ignore double submits.
      if (state.phase !== "asking") return state;
      return {
        ...state,
        phase: "submitting",
        error: null,
        inFlight: event.value,
        // Advance progress optimistically; the server count replaces it.
        answered: event.value === "done" ? state.answered : state.answered + 1,
        key: state.key + 1,
      };
    case "question":
      if (state.phase !== "submitting") return state;
      return {
        ...state,
        phase: "asking",
        turnId: event.turnId,
        question: event.text,
        answered: event.answered,
        error: null,
        inFlight: null,
      };
    case "done":
      if (state.phase !== "submitting") return state;
      return { ...state, phase: "leaving", error: null };
    case "fail":
      if (state.phase !== "submitting") return state;
      return {
        ...state,
        phase: "failed",
        error: event.error,
        // Roll the optimistic step back.
        answered:
          state.inFlight && state.inFlight !== "done"
            ? Math.max(0, state.answered - 1)
            : state.answered,
        inFlight: null,
      };
    case "retry":
      // "Try again" resyncs from the server (the answer may or may not have
      // been saved), so it waits like a submit.
      if (state.phase !== "failed") return state;
      return { ...state, phase: "submitting", error: null, key: state.key + 1 };
  }
}

/** Buttons and shortcuts are live only while a question is shown. */
export function canAnswer(state: InterviewState): boolean {
  return state.phase === "asking";
}

/**
 * Time-to-answer for the displayed turn, measured from when *that* turn's
 * question became visible — never from when the previous answer was sent,
 * which would fold model latency into the paradata. Null if the visible
 * timestamp belongs to another turn.
 */
export function timeToAnswer(
  shown: { turnId: string; at: number } | null,
  turnId: string,
  now: number
): number | null {
  if (!shown || shown.turnId !== turnId) return null;
  return Math.max(0, Math.round(now - shown.at));
}
