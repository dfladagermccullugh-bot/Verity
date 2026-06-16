"use client";

import { useState, useRef, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { answer as submitAnswer } from "@/actions/interview";
import { LOADING_WORDS, randomLoadingWord } from "@/lib/loading-words";
import { BrandHeader, ContextTag, TelemetryFooter } from "@/components/chrome";

function progressWidth(answered: number): string {
  const pct = Math.min(0.8, 0.08 + answered * 0.06) * 100;
  return `${pct}%`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Coarse device class from viewport width — backend paradata only. */
function deviceClass(): string | null {
  if (typeof window === "undefined") return null;
  const w = window.innerWidth;
  if (w < 640) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

export default function Interview({
  token,
  initialQuestion,
  initialAnswered,
  protocol,
}: {
  token: string;
  initialQuestion: string;
  initialAnswered: number;
  protocol?: string;
}) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [question, setQuestion] = useState(initialQuestion);
  const [answered, setAnswered] = useState(initialAnswered);
  const [error, setError] = useState<string | null>(null);
  const [loadingWord, setLoadingWord] = useState(LOADING_WORDS[0]);
  const [pending, startTransition] = useTransition();
  const shownAt = useRef<number>(Date.now());
  const [qKey, setQKey] = useState(0);
  const [exitDir, setExitDir] = useState(1);

  // Honor reduced-motion: no horizontal slide, opacity-only crossfade.
  const dist = reduce ? 0 : 40;
  const blockVariants = {
    enter: (dir: number) => ({ opacity: 0, x: -dir * dist }),
    center: { opacity: 1, x: 0 },
    exit: (dir: number) => ({ opacity: 0, x: dir * dist }),
  };

  useEffect(() => {
    shownAt.current = Date.now();
  }, [qKey]);

  // Cycle the status word every ~700ms while waiting on the model so the
  // screen reads as active rather than stalled.
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => setLoadingWord(randomLoadingWord()), 700);
    return () => clearInterval(id);
  }, [pending]);

  function send(value: "yes" | "no" | "done") {
    if (pending) return;
    setError(null);
    setLoadingWord(randomLoadingWord());
    // Yes slides the block right, No slides it left, Done fades straight through.
    setExitDir(value === "yes" ? 1 : value === "no" ? -1 : 0);
    // Advance progress optimistically (real count syncs on success).
    if (value !== "done") setAnswered((a) => a + 1);
    setQKey((k) => k + 1);
    const ms = Date.now() - shownAt.current;
    const paradata = {
      timeToAnswerMs: ms,
      deviceClass: deviceClass(),
      viewport:
        typeof window !== "undefined"
          ? `${window.innerWidth}x${window.innerHeight}`
          : null,
    };
    startTransition(async () => {
      try {
        const res = await submitAnswer(token, value, paradata);
        if (!res.ok) {
          setError(res.error);
          if (value !== "done") setAnswered((a) => Math.max(0, a - 1));
          return;
        }
        if (res.kind === "done") {
          router.replace(`/i/${token}/done`);
          return;
        }
        setQuestion(res.text);
      } catch {
        // Transport/server failure — never leave the action ambiguous. Roll
        // back the optimistic step and invite a retry (buttons re-enable).
        setError("That didn't go through — please try again.");
        if (value !== "done") setAnswered((a) => Math.max(0, a - 1));
      }
    });
  }

  // Keep a ref to the latest send so the global key handler stays current
  // without re-subscribing on each render.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });

  // Keyboard shortcuts: Y / N / D mirror the three buttons (hint shown below
  // the actions). send() itself no-ops while a turn is in flight.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "y") sendRef.current("yes");
      else if (k === "n") sendRef.current("no");
      else if (k === "d") sendRef.current("done");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
          <ContextTag label={`Question // ${pad(answered + 1)}`} />

          <div className="relative mt-10">
            <div className="absolute -left-6 bottom-0 top-0 hidden w-0.5 rounded-full bg-primary/30 md:block" />
            <AnimatePresence mode="wait" custom={exitDir} initial={false}>
              <motion.div
                key={qKey}
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
              disabled={pending}
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
              disabled={pending}
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
            disabled={pending}
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
            <p role="alert" className="mt-6 text-label-sm text-error">
              {error}
            </p>
          )}
        </div>
      </main>

      <TelemetryFooter protocol={protocol} status="Active" />
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
