"use client";

import { useFormState, useFormStatus } from "react-dom";
import { login } from "@/actions/admin";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-8 w-full rounded-full bg-primary py-3.5 text-label-sm font-semibold text-on-primary shadow-elevation-1 transition-colors hover:brightness-95 disabled:opacity-40"
    >
      {pending ? "Logging in…" : "Login"}
    </button>
  );
}

export default function LoginForm() {
  const [state, formAction] = useFormState(login, {});

  return (
    <form action={formAction} className="w-full max-w-sm">
      <div className="text-center">
        <h1 className="text-display-lg-mobile tracking-tight text-on-surface">
          Verity
        </h1>
        <p className="mt-3 text-label-sm text-on-surface-variant">Admin</p>
      </div>

      <input
        type="password"
        name="password"
        autoComplete="current-password"
        placeholder="Password"
        className="mt-10 w-full rounded-lg border border-hairline bg-surface-container-low px-4 py-3 text-body-md text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/50 focus:border-primary"
      />
      {state?.error && (
        <p className="mt-4 text-label-sm text-error">{state.error}</p>
      )}
      <SubmitButton />
    </form>
  );
}
