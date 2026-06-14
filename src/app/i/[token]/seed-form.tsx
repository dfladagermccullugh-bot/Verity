"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { startSession } from "@/actions/interview";
import { randomLoadingWord } from "@/lib/loading-words";
import {
  BrandHeader,
  Scanline,
  GridUnderlay,
  ContextTag,
  TelemetryFooter,
} from "@/components/chrome";

const SEED_MAX = 1000;

export default function SeedForm({
  token,
  inviteeName,
}: {
  token: string;
  inviteeName: string;
}) {
  const router = useRouter();
  const [seed, setSeed] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingWord, setLoadingWord] = useState("INITIALIZING");
  const [pending, startTransition] = useTransition();

  function begin() {
    setError(null);
    setLoadingWord(randomLoadingWord());
    startTransition(async () => {
      const res = await startSession(token, seed);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.kind === "done") router.replace(`/i/${token}/done`);
      else router.replace(`/i/${token}/q`);
    });
  }

  const count = seed.length;

  return (
    <>
      <Scanline />
      <BrandHeader />
      <main className="relative flex min-h-screen items-center justify-center px-margin-mobile md:px-margin-desktop">
        <GridUnderlay />
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="z-10 w-full max-w-3xl"
        >
          <ContextTag label="Intake // Premise" />

          <h1 className="mt-10 text-display-lg-mobile text-on-surface md:text-display-lg">
            Operative {inviteeName}.
          </h1>
          <p className="mt-5 max-w-2xl border-l border-hairline pl-6 text-body-lg text-on-surface-variant opacity-80">
            State the premise in one or two sentences. The system will
            interrogate via binary response until the brief is complete.
          </p>

          <div className="mt-12">
            <textarea
              value={seed}
              onChange={(e) => setSeed(e.target.value.slice(0, SEED_MAX))}
              maxLength={SEED_MAX}
              rows={3}
              disabled={pending}
              autoFocus
              placeholder="A reusable water bottle that nudges you to drink throughout the day."
              className="w-full resize-none border-b border-hairline bg-transparent pb-4 text-headline-md text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/40 focus:border-primary disabled:opacity-50"
            />
            <div className="mt-2 text-right text-label-sm uppercase tracking-engrave text-on-surface-variant opacity-60">
              {count} / {SEED_MAX}
            </div>
          </div>

          {error && (
            <p className="mt-6 text-label-sm uppercase tracking-engrave text-error">
              {error}
            </p>
          )}

          <div className="mt-12">
            <button
              onClick={begin}
              disabled={pending || seed.trim().length === 0}
              className="group relative flex w-full items-center justify-between rounded bg-primary px-10 py-5 text-surface-container-lowest transition-all duration-300 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30 md:w-80"
            >
              <span className="text-label-sm font-bold uppercase tracking-engrave">
                {pending ? loadingWord : "Initiate"}
              </span>
              <span aria-hidden className="text-lg leading-none">
                {pending ? "·" : "→"}
              </span>
            </button>
          </div>
        </motion.div>
      </main>
      <TelemetryFooter status="Intake" />
    </>
  );
}
