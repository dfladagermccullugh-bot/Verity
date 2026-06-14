"use client";

import { useFormState, useFormStatus } from "react-dom";
import { login } from "@/actions/admin";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-8 w-full rounded bg-primary py-4 text-label-sm font-bold uppercase tracking-engrave text-surface-container-lowest transition-all hover:brightness-110 disabled:opacity-30"
    >
      {pending ? "Authenticating…" : "Authenticate"}
    </button>
  );
}

export default function LoginForm() {
  const [state, formAction] = useFormState(login, {});

  return (
    <form action={formAction} className="w-full max-w-sm">
      <div className="flex items-center gap-3">
        <span className="inline-block h-1.5 w-1.5 bg-primary-container" />
        <span className="text-label-sm uppercase tracking-engrave text-on-surface-variant">
          Verity // Admin
        </span>
      </div>
      <h1 className="mt-8 text-headline-md text-on-surface">Restricted access</h1>

      <input
        type="password"
        name="password"
        autoComplete="current-password"
        placeholder="CREDENTIAL"
        className="mt-8 w-full border-b border-hairline bg-transparent pb-3 text-body-lg text-on-surface outline-none transition-colors placeholder:text-label-sm placeholder:uppercase placeholder:tracking-engrave placeholder:text-on-surface-variant/40 focus:border-primary"
      />
      {state?.error && (
        <p className="mt-4 text-label-sm uppercase tracking-engrave text-error">
          {state.error}
        </p>
      )}
      <SubmitButton />
    </form>
  );
}
