"use client";

import { useState, useRef, useEffect, useReducer } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  answer as submitAnswer,
  resume as resumeSession,
  type AnswerInput,
  type StepResponse,
} from "@/actions/interview";
import type { Answer } from "@/lib/lifecycle";
import {
  canAnswer,
  initialInterviewState,
  interviewReducer,
  timeToAnswer,
} from "@/lib/interview-state";
import { LOADING_WORDS, randomLoadingWord } from "@/lib/loading-words";
import { BrandHeader, ContextTag, SiteFooter } from "@/components/chrome";

function progressWidth(answered: number): string {
  const pct = Math.min(0.8, 0.08 + answered * 0.06) * 100;
  return `${pct}%`;
}

/** Coarse device class from viewport width — backend paradata only. */
function deviceClass(): string | null {
  if (typeof window === "undefined") return null;
  const w = window.innerWidth;
  if (w < 640) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

export interface InterviewActions {
  answer: (
    token: string,
    turnId: string,
    value: Answer,
    paradata: AnswerInput
  ) => Promise<StepResponse>;
  resume: (token: string) => Promise<StepResponse>;
}

const serverActions: InterviewActions = { answer: submitAnswer, resume: resumeSession };

const RETRY_MESSAGE = "That didn't go through — please try again.";

export default function Interview({
  token,
  initialTurnId,
  initialQuestion,
  initialAnswered,
  actions = serverActions,
  onDone,
}: {
  token: string;
  initialTurnId: string;
  initialQuestion: string;
  initialAnswered: number;
  /** Injectable for the client harness; defaults to the server actions. */
  actions?: InterviewActions;
  onDone?: () => void;
}) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [state, dispatch] = useReducer(
    interviewReducer,
    // The answer is bound to the turn that was displayed, never "whatever is
    // pending now" — a stale tab cannot answer a question it never showed.
    { turnId: initialTurnId, question: initialQuestion, answered: initialAnswered },
    initialInterviewState
  );
  const [loadingWord, setLoadingWord] = useState(LOADING_WORDS[0]);
  const busy = state.phase === "submitting" || state.phase === "leaving";
  const exitDir = state.inFlight === "yes" ? 1 : state.inFlight === "no" ? -1 : 0;

  // Honor reduced-motion: no horizontal slide, opacity-only crossfade.
  const dist = reduce ? 0 : 40;
  const blockVariants = {
    enter: (dir: number) => ({ opacity: 0, x: -dir * dist }),
    center: { opacity: 1, x: 0 },
    exit: (dir: number) => ({ opacity: 0, x: dir * dist }),
  };

  // Paradata: time-to-answer runs from when THIS turn's question became
  // visible (after the model returned), keyed on the turn id — not from when
  // the previous answer was sent, which would include model latency.
  const shown = useRef<{ turnId: string; at: number } | null>(null);
  useEffect(() => {
    if (state.phase === "asking") shown.current = { turnId: state.turnId, at: performance.now() };
  }, [state.phase, state.turnId]);

  // Cycle the status word every ~700ms while waiting on the model so the
  // screen reads as active rather than stalled.
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setLoadingWord(randomLoadingWord()), 700);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => {
    if (state.phase !== "leaving") return;
    if (onDone) onDone();
    else router.replace(`/i/${token}/done`);
  }, [state.phase, onDone, router, token]);

  function apply(res: StepResponse) {
    if (!res.ok) dispatch({ type: "fail", error: res.error });
    else if (res.kind === "done") dispatch({ type: "done" });
    else dispatch({ type: "question", turnId: res.turnId, text: res.text, answered: res.answered });
  }

  async function send(value: Answer) {
    if (!canAnswer(state)) return;
    const turnId = state.turnId;
    const paradata: AnswerInput = {
      timeToAnswerMs: timeToAnswer(shown.current, turnId, performance.now()),
      deviceClass: deviceClass(),
      viewport:
        typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : null,
    };
    setLoadingWord(randomLoadingWord());
    dispatch({ type: "submit", value });
    try {
      apply(await actions.answer(token, turnId, value, paradata));
    } catch {
      // Transport/server failure — never leave the action ambiguous.
      dispatch({ type: "fail", error: RETRY_MESSAGE });
    }
  }

  /** "Try again": the answer may or may not have been saved, so resync from
   *  the server (same question if not, the next one if it was). */
  async function retry() {
    if (state.phase !== "failed") return;
    dispatch({ type: "retry" });
    try {
      apply(await actions.resume(token));
    } catch {
      dispatch({ type: "fail", error: RETRY_MESSAGE });
    }
  }

  // Keep a ref to the latest send so the global key handler stays current
  // without re-subscribing on each render.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });

  // Keyboard shortcuts: Y / N / D mirror the three buttons (hint shown below
  // the actions). A held key's auto-repeat is ignored, so it cannot answer
  // each new question as it arrives; send() no-ops unless a question shows.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "y") sendRef.current("yes");
      else if (k === "n") sendRef.current("no");
      else if (k === "d") sendRef.current("done");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pending = busy;
  const answered = state.answered;
  const question = state.question;
  const error = state.error;
  const disabled = !canAnswer(state);

  return (
    <>
      <BrandHeader />

      {/* Progress: a slim rounded bar pinned to the very top. */}
      <div
        className="fixed left-0 top-0 z-[60] h-1 w-full bg-surface-container-high"
        role="progressbar"
        aria-label="Interview progress"
      >
        <motion.div
          className="h-full rounded-full bg-primary"
          animate={{ width: progressWidth(answered) }}
          transition={{ duration: reduce ? 0 : 0.4 }}
        />
      </div>

      <main
        className="relative flex min-h-screen items-center justify-center px-margin-mobile md:px-margin-desktop"
        aria-busy={pending}
      >
        <div className="z-10 w-full max-w-4xl">
          {/* Persistent live region: reliably announces each new question to
              assistive tech (the visually-animated heading remounts per turn
              and would not announce dependably). */}
          <p className="sr-only" role="status" aria-live="polite">
            {pending ? "" : question}
          </p>
          <ContextTag label={`Question ${answered + 1}`} />

          <div className="relative mt-10">
            <div className="absolute -left-6 bottom-0 top-0 hidden w-0.5 rounded-full bg-primary/30 md:block" />
            <AnimatePresence mode="wait" custom={exitDir} initial={false}>
              <motion.div
                key={state.key}
                custom={exitDir}
                variants={blockVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: reduce ? 0 : 0.28, ease: [0.2, 0, 0, 1] }}
              >
                <div className="min-h-[12rem]">
                  {pending ? (
                    <LoadingLine word={loadingWord} />
                  ) : (
                    <h2 className="text-display-lg-mobile tracking-tight text-on-surface md:text-display-lg">
                      {question}
                    </h2>
                  )}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Binary actions: No = neutral utility, Yes = blue confirm. Opposing
              answers are kept well apart (>=24px) to avoid mis-taps. */}
          <div className="mt-16 flex flex-col gap-6 md:flex-row md:gap-8">
            <button
              onClick={() => send("no")}
              disabled={disabled}
              aria-keyshortcuts="n"
              className="group flex w-full items-center justify-between rounded-full border border-hairline bg-surface-container-lowest px-8 py-4 transition-colors duration-200 hover:border-on-surface-variant hover:bg-surface-container disabled:opacity-40 md:w-64"
            >
              <span className="text-label-sm font-semibold text-on-surface-variant transition-colors group-hover:text-on-surface">
                No
              </span>
              <span
                aria-hidden
                className="text-on-surface-variant transition-colors group-hover:text-on-surface"
              >
                ✕
              </span>
            </button>
            <button
              onClick={() => send("yes")}
              disabled={disabled}
              aria-keyshortcuts="y"
              className="group flex w-full items-center justify-between rounded-full bg-primary px-10 py-4 text-on-primary shadow-elevation-1 transition-colors duration-200 hover:brightness-95 disabled:opacity-40 md:w-80"
            >
              <span className="text-label-sm font-semibold">Yes</span>
              <span aria-hidden className="text-lg leading-none">
                →
              </span>
            </button>
          </div>

          <button
            onClick={() => send("done")}
            disabled={disabled}
            aria-keyshortcuts="d"
            className="mt-8 rounded-full border border-hairline px-6 py-2.5 text-label-sm text-on-surface-variant transition-colors hover:border-on-surface-variant hover:text-on-surface disabled:opacity-40"
          >
            Conclude — compile brief
          </button>

          <p className="mt-4 hidden text-label-sm text-on-surface-variant md:block">
            Or press{" "}
            <kbd className="rounded border border-hairline px-1.5 py-0.5 font-mono">
              Y
            </kbd>{" "}
            ·{" "}
            <kbd className="rounded border border-hairline px-1.5 py-0.5 font-mono">
              N
            </kbd>{" "}
            ·{" "}
            <kbd className="rounded border border-hairline px-1.5 py-0.5 font-mono">
              D
            </kbd>
          </p>

          {error && (
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <p role="alert" className="text-label-sm text-error">
                {error}
              </p>
              {state.phase === "failed" && (
                <button
                  type="button"
                  onClick={retry}
                  className="rounded-full border border-hairline px-5 py-2 text-label-sm font-semibold text-on-surface transition-colors hover:border-on-surface-variant"
                >
                  Try again
                </button>
              )}
            </div>
          )}
        </div>
      </main>

      <SiteFooter />
    </>
  );
}

function LoadingLine({ word }: { word: string }) {
  // After ~10s, escalate the message so a long model wait reads as progress
  // rather than a stall (source-of-truth §5 / Doherty).
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), 10000);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="pt-2" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <AnimatePresence mode="wait">
          <motion.span
            key={word}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="text-label-sm text-on-surface-variant"
          >
            {word}
          </motion.span>
        </AnimatePresence>
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 animate-pulse-dot rounded-full bg-primary"
        />
      </div>
      {slow && (
        <p className="mt-3 text-label-sm text-on-surface-variant">
          Still working — a richer idea takes a little longer to think through.
        </p>
      )}
    </div>
  );
}
