"use client";

import { useFormState, useFormStatus } from "react-dom";
import { openRound, completeSession } from "@/actions/admin";

function Submit({
  idle,
  busy,
  variant,
}: {
  idle: string;
  busy: string;
  variant: "primary" | "ghost";
}) {
  const { pending } = useFormStatus();
  const className =
    variant === "primary"
      ? "rounded bg-primary px-6 py-3 text-label-sm font-bold uppercase tracking-engrave text-surface-container-lowest transition-all hover:brightness-110 disabled:opacity-30"
      : "rounded border border-hairline px-6 py-3 text-label-sm uppercase tracking-engrave text-on-surface-variant transition-colors hover:border-on-surface-variant hover:text-on-surface disabled:opacity-30";
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? busy : idle}
    </button>
  );
}

/**
 * Operator controls for a session that is awaiting review: open another round
 * (the respondent resumes via their existing link) or close the session out.
 */
export default function RoundActions({ sessionId }: { sessionId: string }) {
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
    <div className="mt-10 border border-primary/40 bg-surface-container-low p-6">
      <p className="text-label-sm uppercase tracking-engrave text-primary">
        Awaiting review
      </p>
      <p className="mt-3 text-body-md text-on-surface-variant">
        Read the brief above, then either probe further or close the session.
        Opening another round lets the respondent continue from their existing
        link; completing it consumes the invite.
      </p>
      <div className="mt-5 flex flex-wrap gap-4">
        <form action={openAction}>
          <Submit idle="Open another round" busy="Opening…" variant="primary" />
        </form>
        <form action={doneAction}>
          <Submit idle="Mark complete" busy="Completing…" variant="ghost" />
        </form>
      </div>
      {error && (
        <p className="mt-4 text-label-sm uppercase tracking-engrave text-error">
          {error}
        </p>
      )}
    </div>
  );
}
