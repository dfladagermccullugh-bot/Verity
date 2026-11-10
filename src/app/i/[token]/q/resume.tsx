"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { resume as resumeSession, type StepResponse } from "@/actions/interview";
import ThinkingScreen from "@/components/thinking-screen";
import NoticeScreen from "@/components/notice-screen";
import Interview, { type InterviewActions } from "./interview";

type View =
  | { kind: "loading" }
  | { kind: "failed"; error: string }
  | { kind: "question"; turnId: string; text: string; answered: number };

/**
 * Shown when the session is active but no question is waiting — a request
 * died mid-step, or the next question is still being prepared. Calls the
 * idempotent `resume` action (engine `advance`) and continues the interview
 * in place; on failure offers a retry instead of a screen that never moves.
 */
export default function Resume({
  token,
  actions,
}: {
  token: string;
  actions?: InterviewActions;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: "loading" });
  const started = useRef(false);
  const resume = actions?.resume ?? resumeSession;

  const run = useCallback(async () => {
    setView({ kind: "loading" });
    let res: StepResponse;
    try {
      res = await resume(token);
    } catch {
      res = { ok: false, error: "That didn't go through — please try again." };
    }
    if (!res.ok) setView({ kind: "failed", error: res.error });
    else if (res.kind === "done") router.replace(`/i/${token}/done`);
    else setView({ kind: "question", turnId: res.turnId, text: res.text, answered: res.answered });
  }, [resume, router, token]);

  useEffect(() => {
    if (started.current) return; // StrictMode double-mount; resume is idempotent anyway
    started.current = true;
    void run();
  }, [run]);

  if (view.kind === "question")
    return (
      <Interview
        token={token}
        initialTurnId={view.turnId}
        initialQuestion={view.text}
        initialAnswered={view.answered}
        actions={actions}
      />
    );
  if (view.kind === "failed")
    return (
      <NoticeScreen
        eyebrow="Still preparing"
        title="Your next question isn't ready yet"
        body={`${view.error} Your answers so far are saved.`}
        tone="error"
      >
        <button
          type="button"
          onClick={() => void run()}
          className="rounded-full bg-primary px-8 py-3 text-label-sm font-semibold text-on-primary shadow-elevation-1 transition-colors hover:brightness-95"
        >
          Try again
        </button>
      </NoticeScreen>
    );
  return <ThinkingScreen label="Preparing your next question…" />;
}
