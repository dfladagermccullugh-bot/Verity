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
      {pending ? "Logging in…" : "Login"}
    </button>
  );
}

export default function LoginForm() {
  const [state, formAction] = useFormState(login, {});

  return (
    <form action={formAction} className="w-full max-w-sm">
      <div className="text-center">
        <h1 className="text-display-lg-mobile uppercase tracking-engrave text-on-surface">
          Verity
        </h1>
        <p className="mt-3 text-label-sm uppercase tracking-engrave text-on-surface-variant opacity-70">
          Admin
        </p>
      </div>

      <input
        type="password"
        name="password"
        autoComplete="current-password"
        placeholder="Password"
        className="mt-10 w-full border-b border-hairline bg-transparent pb-3 text-body-lg text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/40 focus:border-primary"
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
