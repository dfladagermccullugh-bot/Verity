"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { startSession } from "@/actions/interview";
import { randomLoadingWord } from "@/lib/loading-words";

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
  const [loadingWord, setLoadingWord] = useState("planting");
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
    <main className="flex min-h-screen items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md rounded-md3-xl bg-surface-container-high p-7 shadow-md3-2"
      >
        <h1 className="text-center text-2xl font-semibold text-primary">
          Idea Seeder
        </h1>
        <p className="mt-2 text-center text-sm text-on-surface-variant">
          Hi {inviteeName} — describe your idea in a sentence or two. Then just tap
          yes or no.
        </p>

        <textarea
          value={seed}
          onChange={(e) => setSeed(e.target.value.slice(0, SEED_MAX))}
          maxLength={SEED_MAX}
          rows={5}
          disabled={pending}
          placeholder="e.g. An app that reminds my grandkids to call me"
          className="mt-5 w-full resize-none rounded-md3-lg border border-outline-variant bg-surface-container-low p-4 text-base text-on-surface outline-none placeholder:text-on-surface-variant/60 focus:border-primary disabled:opacity-50"
        />
        <div className="mt-1 text-right text-xs text-on-surface-variant">
          {count}/{SEED_MAX}
        </div>

        {error && (
          <p className="mt-3 text-center text-sm text-error">{error}</p>
        )}

        <button
          onClick={begin}
          disabled={pending || seed.trim().length === 0}
          className="mt-4 w-full rounded-full bg-primary py-4 text-lg font-semibold text-on-primary transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? `${loadingWord}…` : "Begin"}
        </button>
      </motion.div>
    </main>
  );
}
