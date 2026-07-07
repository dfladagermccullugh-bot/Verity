"use client";

import { useFormState, useFormStatus } from "react-dom";
import { ContextTag } from "@/components/chrome";
import { login } from "@/actions/admin";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-8 flex w-full items-center justify-center gap-2 rounded-full bg-primary px-8 py-3 text-label-sm font-semibold text-on-primary shadow-elevation-1 transition-colors hover:brightness-95 disabled:opacity-40 sm:w-auto"
    >
      <span>{pending ? "Signing in…" : "Sign in"}</span>
      <span aria-hidden className="text-base leading-none">
        →
      </span>
    </button>
  );
}

export default function LoginForm() {
  const [state, formAction] = useFormState(login, {});

  return (
    <form
      action={formAction}
      className="w-full sm:rounded-xl sm:border sm:border-hairline sm:bg-surface-container-lowest sm:p-8 sm:shadow-elevation-1"
    >
      <ContextTag label="Operator" />
      <h1 className="mt-6 text-headline-md tracking-tight text-on-surface">
        Sign in
      </h1>

      <label
        htmlFor="password"
        className="mt-8 block text-label-sm font-medium text-on-surface-variant"
      >
        Passphrase
      </label>
      <input
        id="password"
        type="password"
        name="password"
        autoComplete="current-password"
        className="mt-2 w-full rounded-xs border border-hairline bg-surface-container-low px-4 py-3 text-body-md text-on-surface transition-colors focus:border-primary"
      />
      {state?.error && (
        <p role="alert" className="mt-4 text-label-sm text-error">
          {state.error}
        </p>
      )}
      <SubmitButton />
    </form>
  );
}
