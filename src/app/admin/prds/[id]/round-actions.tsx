"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { openRound, completeSession } from "@/actions/admin";

function Submit({
  idle,
  busy,
  variant,
}: {
  idle: string;
  busy: string;
  variant: "primary" | "ghost" | "danger";
}) {
  const { pending } = useFormStatus();
  const base = "rounded-md px-6 py-2.5 text-label-sm font-semibold transition-colors disabled:opacity-40";
  const className =
    variant === "primary"
      ? `${base} bg-primary text-on-primary shadow-elevation-1 hover:brightness-95`
      : variant === "danger"
        ? `${base} bg-error text-on-error shadow-elevation-1 hover:brightness-95`
        : `${base} border border-hairline font-medium text-on-surface-variant hover:border-on-surface-variant hover:text-on-surface`;
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? busy : idle}
    </button>
  );
}

/**
 * Operator controls for a session that is awaiting review: open another round
 * (the respondent resumes via their existing link) or close the session out.
 *
 * "Mark complete" is irreversible — it consumes the single-use invite and
 * permanently closes the respondent's durable link — so it is gated behind an
 * explicit confirmation that names the consequence, with the safe (Cancel)
 * action first and the destructive confirm visually distinct and separated from
 * the non-destructive "Open another round" (source-of-truth §5 / Fitts).
 */
export default function RoundActions({ sessionId }: { sessionId: string }) {
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Move focus to the safe (Cancel) action when the confirm appears, so the
  // keyboard/SR user lands inside the prompt rather than on a removed button.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);
  const [openState, openAction] = useFormState(
    async () => openRound(sessionId),
    {} as { error?: string }
  );
  const [doneState, doneAction] = useFormState(
    async () => completeSession(sessionId),
    {} as { error?: string }
  );
  const error = openState?.error || doneState?.error;

  return (
    <div className="mt-10 rounded-lg border border-primary/30 bg-surface-container-low p-6 shadow-elevation-1">
      <p className="text-label-sm font-semibold text-primary">Awaiting review</p>
      <p className="mt-3 text-body-md text-on-surface-variant">
        Read the brief above, then either probe further or close the session.
        Opening another round lets the respondent continue from their existing
        link; completing it consumes the invite.
      </p>

      {!confirming ? (
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <form action={openAction}>
            <Submit idle="Open another round" busy="Opening…" variant="primary" />
          </form>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-md border border-hairline px-6 py-2.5 text-label-sm font-medium text-on-surface-variant transition-colors hover:border-on-surface-variant hover:text-on-surface"
          >
            Mark complete…
          </button>
        </div>
      ) : (
        <div
          className="mt-5 rounded-md border border-error/40 bg-surface p-4"
          role="group"
          aria-label="Confirm completion"
        >
          <p className="text-label-sm font-semibold text-on-surface">
            Complete and close this session?
          </p>
          <p className="mt-2 text-body-md text-on-surface-variant">
            This consumes the single-use invite and permanently closes the
            respondent&rsquo;s link — it cannot be reopened. The latest PRD
            becomes the final version.
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
            <form action={doneAction}>
              <Submit
                idle="Yes, complete & close"
                busy="Completing…"
                variant="danger"
              />
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
