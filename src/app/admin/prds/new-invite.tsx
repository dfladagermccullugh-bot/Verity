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
      className="rounded bg-primary px-6 py-3 text-label-sm font-bold uppercase tracking-engrave text-surface-container-lowest transition-all hover:brightness-110 disabled:opacity-30"
    >
      {pending ? "Issuing…" : "Issue invite"}
    </button>
  );
}

const fieldClass =
  "mt-2 w-full border-b border-hairline bg-transparent pb-2 text-body-md text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/40 focus:border-primary";

const labelClass =
  "block text-label-sm uppercase tracking-engrave text-on-surface-variant";

export default function NewInvite() {
  const [state, formAction] = useFormState(createInvite, {});
  const [copied, setCopied] = useState(false);

  return (
    <div className="border border-hairline p-6">
      <form action={formAction} className="flex flex-wrap items-end gap-6">
        <div>
          <label className={labelClass}>Invitee name</label>
          <input name="name" className={fieldClass} />
        </div>
        <div className="flex-1">
          <label className={labelClass}>Note (optional)</label>
          <input name="note" className={fieldClass} />
        </div>
        <Submit />
      </form>

      {state?.error && (
        <p className="mt-4 text-label-sm uppercase tracking-engrave text-error">
          {state.error}
        </p>
      )}

      {state?.url && (
        <div className="mt-5 flex items-center gap-4">
          <code className="flex-1 truncate border border-hairline bg-surface-container-low p-3 font-mono text-body-md text-primary">
            {state.url}
          </code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(state.url!).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="rounded border border-hairline px-4 py-3 text-label-sm uppercase tracking-engrave text-on-surface-variant transition-colors hover:border-on-surface-variant hover:text-on-surface"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}
