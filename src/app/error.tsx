"use client";

import NoticeScreen from "@/components/notice-screen";

/**
 * Global error boundary. Plain-language recovery: name what happened and offer
 * a single "Try again" action (Next's reset() re-renders the segment).
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <NoticeScreen
      eyebrow="Something went wrong"
      title="Something went wrong"
      body="We hit an unexpected problem. Please check your connection and try again, or reach out to the operator if it keeps happening."
      tone="error"
    >
      <button
        onClick={reset}
        className="flex items-center justify-center gap-3 rounded-full bg-primary px-10 py-4 text-on-primary shadow-elevation-1 transition-colors hover:brightness-95"
      >
        <span className="text-label-sm font-semibold">Try again</span>
      </button>
    </NoticeScreen>
  );
}
