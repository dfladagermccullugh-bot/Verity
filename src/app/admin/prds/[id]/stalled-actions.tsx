"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { closeStalled, resumeStalled } from "@/actions/admin";

function Submit({ idle, busy, danger }: { idle: string; busy: string; danger?: boolean }) {
  const { pending } = useFormStatus();
  const base =
    "rounded-md px-6 py-2.5 text-label-sm font-semibold transition-colors disabled:opacity-40";
  return (
    <button
      type="submit"
      disabled={pending}
      className={
        danger
          ? `${base} bg-error text-on-error shadow-elevation-1 hover:brightness-95`
          : `${base} bg-primary text-on-primary shadow-elevation-1 hover:brightness-95`
      }
    >
      {pending ? busy : idle}
    </button>
  );
}

/**
 * Operator controls for a stalled session: active, but no question is
 * waiting (a request died between the answer and the next question). Resume
 * runs the same idempotent step the respondent's link runs; Close ends the
 * open round as `abandoned` and consumes the invite (confirmed first).
 */
export default function StalledActions({ sessionId }: { sessionId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [last, setLast] = useState<"resume" | "close" | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);
  const [resumeState, resumeAction] = useFormState(
    async () => resumeStalled(sessionId),
    {} as { error?: string }
  );
  const [closeState, closeAction] = useFormState(
    async () => closeStalled(sessionId),
    {} as { error?: string }
  );
  const error =
    last === "resume" ? resumeState?.error : last === "close" ? closeState?.error : undefined;

  return (
    <div className="mt-10 rounded-lg border border-error/40 bg-surface-container-low p-6 shadow-elevation-1">
      <p className="text-label-sm font-semibold text-error">Stalled</p>
      <p className="mt-3 text-body-md text-on-surface-variant">
        The session is active but no question is waiting for the respondent. If
        they are not mid-answer right now, a step was interrupted. Resume
        prepares the next question (the respondent&rsquo;s link also resumes it
        on its own), or close the session.
      </p>

      {!confirming ? (
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <form action={resumeAction} onSubmit={() => setLast("resume")}>
            <Submit idle="Resume" busy="Resuming…" />
          </form>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-md border border-hairline px-6 py-2.5 text-label-sm font-medium text-on-surface-variant transition-colors hover:border-on-surface-variant hover:text-on-surface"
          >
            Close session…
          </button>
        </div>
      ) : (
        <div
          className="mt-5 rounded-md border border-error/40 bg-surface p-4"
          role="group"
          aria-label="Confirm closing"
        >
          <p className="text-label-sm font-semibold text-on-surface">
            Close this stalled session?
          </p>
          <p className="mt-2 text-body-md text-on-surface-variant">
            The open round ends as abandoned without a new PRD, the single-use
            invite is consumed, and the respondent&rsquo;s link shows the closing
            screen. This cannot be undone.
          </p>
          <div className="mt-4 flex flex-wrap gap-4">
            <button
              ref={cancelRef}
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-hairline px-6 py-2.5 text-label-sm font-semibold text-on-surface transition-colors hover:border-on-surface-variant"
            >
              Cancel
            </button>
            <form action={closeAction} onSubmit={() => setLast("close")}>
              <Submit idle="Yes, close session" busy="Closing…" danger />
            </form>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 text-label-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
