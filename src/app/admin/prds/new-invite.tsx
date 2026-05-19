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
      className="rounded-lg bg-seed-accent px-4 py-2 text-sm font-semibold text-seed-bg disabled:opacity-40"
    >
      {pending ? "Creating…" : "Create invite"}
    </button>
  );
}

export default function NewInvite() {
  const [state, formAction] = useFormState(createInvite, {});
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-xl border border-white/10 p-4">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-seed-muted">Invitee name</label>
          <input
            name="name"
            className="mt-1 rounded-lg border border-white/10 bg-seed-bg p-2 text-sm outline-none focus:border-seed-accent/60"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-seed-muted">
            Note (optional)
          </label>
          <input
            name="note"
            className="mt-1 w-full rounded-lg border border-white/10 bg-seed-bg p-2 text-sm outline-none focus:border-seed-accent/60"
          />
        </div>
        <Submit />
      </form>

      {state?.error && (
        <p className="mt-3 text-sm text-red-400">{state.error}</p>
      )}

      {state?.url && (
        <div className="mt-3 flex items-center gap-3">
          <code className="flex-1 truncate rounded bg-seed-bg p-2 text-xs text-seed-accent">
            {state.url}
          </code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(state.url!).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="rounded-lg border border-white/10 px-3 py-2 text-xs hover:bg-white/5"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}
