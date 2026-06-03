"use client";

import { useState, useRef, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { answer as submitAnswer } from "@/actions/interview";
import { randomLoadingWord } from "@/lib/loading-words";

function progressWidth(answered: number): string {
  const pct = Math.min(0.8, 0.08 + answered * 0.06) * 100;
  return `${pct}%`;
}

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
  const [loadingWord, setLoadingWord] = useState("growing");
  const [pending, startTransition] = useTransition();
  const shownAt = useRef<number>(Date.now());
  const [qKey, setQKey] = useState(0);

  useEffect(() => {
    shownAt.current = Date.now();
  }, [qKey]);

  function send(value: "yes" | "no" | "done") {
    if (pending) return;
    setError(null);
    setLoadingWord(randomLoadingWord());
    const ms = Date.now() - shownAt.current;
    startTransition(async () => {
      const res = await submitAnswer(token, value, ms);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.kind === "done") {
        router.replace(`/i/${token}/done`);
        return;
      }
      setAnswered((a) => a + 1);
      setQuestion(res.text);
      setQKey((k) => k + 1);
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
          <AnimatePresence mode="wait">
            <motion.div
              key={qKey}
              initial={{ opacity: 0, x: 28 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -28 }}
              transition={{ duration: 0.2 }}
              className="rounded-md3-xl bg-surface-container-high p-7 shadow-md3-2"
            >
              <p className="min-h-[3.5rem] text-center text-xl font-medium leading-relaxed text-on-surface">
                {pending ? (
                  <span className="text-on-surface-variant">{loadingWord}…</span>
                ) : (
                  question
                )}
              </p>

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
