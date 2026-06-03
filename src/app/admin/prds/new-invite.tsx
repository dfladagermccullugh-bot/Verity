"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useState } from "react";
import { createInvite } from "@/actions/admin";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-40"
    >
      {pending ? "Creating…" : "Create invite"}
    </button>
  );
}

export default function NewInvite() {
  const [state, formAction] = useFormState(createInvite, {});
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-md3-lg border border-outline-variant bg-surface-container-low p-4">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-on-surface-variant">Invitee name</label>
          <input
            name="name"
            className="mt-1 rounded-md3 border border-outline-variant bg-surface p-2 text-sm text-on-surface outline-none focus:border-primary"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-on-surface-variant">
            Note (optional)
          </label>
          <input
            name="note"
            className="mt-1 w-full rounded-md3 border border-outline-variant bg-surface p-2 text-sm text-on-surface outline-none focus:border-primary"
          />
        </div>
        <Submit />
      </form>

      {state?.error && (
        <p className="mt-3 text-sm text-error">{state.error}</p>
      )}

      {state?.url && (
        <div className="mt-3 flex items-center gap-3">
          <code className="flex-1 truncate rounded bg-surface-container p-2 text-xs text-primary">
            {state.url}
          </code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(state.url!).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="rounded-full border border-outline-variant px-3 py-2 text-xs text-on-surface hover:bg-surface-container"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}
