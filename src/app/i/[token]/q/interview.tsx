"use client";

import { useState, useRef, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { answer as submitAnswer } from "@/actions/interview";
import { LOADING_WORDS, randomLoadingWord } from "@/lib/loading-words";

function progressWidth(answered: number): string {
  const pct = Math.min(0.8, 0.08 + answered * 0.06) * 100;
  return `${pct}%`;
}

const cardVariants = {
  enter: (dir: number) => ({ opacity: 0, x: -dir * 48 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir * 48 }),
};

export default function Interview({
  token,
  initialQuestion,
  initialAnswered,
}: {
  token: string;
  initialQuestion: string;
  initialAnswered: number;
}) {
  const router = useRouter();
  const [question, setQuestion] = useState(initialQuestion);
  const [answered, setAnswered] = useState(initialAnswered);
  const [error, setError] = useState<string | null>(null);
  const [loadingWord, setLoadingWord] = useState(LOADING_WORDS[0]);
  const [pending, startTransition] = useTransition();
  const shownAt = useRef<number>(Date.now());
  const [qKey, setQKey] = useState(0);
  const [exitDir, setExitDir] = useState(1);

  useEffect(() => {
    shownAt.current = Date.now();
  }, [qKey]);

  // Cycle the loading word every ~800ms while waiting on the model so the
  // affordance feels alive instead of stalled on a single word.
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => setLoadingWord(randomLoadingWord()), 800);
    return () => clearInterval(id);
  }, [pending]);

  function send(value: "yes" | "no" | "done") {
    if (pending) return;
    setError(null);
    setLoadingWord(randomLoadingWord());
    // Yes slides the card right, No slides it left, Done fades straight up.
    setExitDir(value === "yes" ? 1 : value === "no" ? -1 : 0);
    // Advance the progress bar optimistically (real count syncs on success).
    if (value !== "done") setAnswered((a) => a + 1);
    // Swap cards immediately so the user sees motion before the network resolves.
    setQKey((k) => k + 1);
    const ms = Date.now() - shownAt.current;
    startTransition(async () => {
      const res = await submitAnswer(token, value, ms);
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
    });
  }

  return (
    <main className="flex min-h-screen flex-col">
      <div className="h-1.5 w-full bg-surface-container">
        <motion.div
          className="h-full bg-primary"
          animate={{ width: progressWidth(answered) }}
          transition={{ duration: 0.4 }}
        />
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md">
          <AnimatePresence mode="wait" custom={exitDir} initial={false}>
            <motion.div
              key={qKey}
              custom={exitDir}
              variants={cardVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.28, ease: [0.2, 0, 0, 1] }}
              className="rounded-md3-xl bg-surface-container-high p-7 shadow-md3-2"
            >
              <div className="min-h-[3.5rem] text-center text-xl font-medium leading-relaxed text-on-surface">
                {pending ? (
                  <LoadingLine word={loadingWord} />
                ) : (
                  <span>{question}</span>
                )}
              </div>

              <div className="mt-7 grid grid-cols-2 gap-3">
                <button
                  onClick={() => send("no")}
                  disabled={pending}
                  className="rounded-full border border-outline bg-surface-container-low py-5 text-lg font-semibold text-on-surface transition active:scale-[0.97] disabled:opacity-40"
                >
                  No
                </button>
                <button
                  onClick={() => send("yes")}
                  disabled={pending}
                  className="rounded-full bg-primary py-5 text-lg font-semibold text-on-primary transition active:scale-[0.97] disabled:opacity-40"
                >
                  Yes
                </button>
              </div>

              <button
                onClick={() => send("done")}
                disabled={pending}
                className="mt-5 w-full text-center text-sm text-on-surface-variant underline-offset-4 hover:underline disabled:opacity-40"
              >
                I&apos;m done — write the PRD
              </button>

              {error && (
                <p className="mt-4 text-center text-sm text-error">{error}</p>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}

function LoadingLine({ word }: { word: string }) {
  return (
    <span className="inline-flex items-center justify-center gap-2 text-on-surface-variant">
      <AnimatePresence mode="wait">
        <motion.span
          key={word}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.25 }}
        >
          {word}
        </motion.span>
      </AnimatePresence>
      <motion.span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full bg-on-surface-variant"
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
      />
    </span>
  );
}
