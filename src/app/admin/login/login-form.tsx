"use client";

import { useFormState, useFormStatus } from "react-dom";
import { login } from "@/actions/admin";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-4 w-full rounded-full bg-primary py-3 font-semibold text-on-primary transition active:scale-[0.98] disabled:opacity-40"
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

export default function LoginForm() {
  const [state, formAction] = useFormState(login, {});

  return (
    <form
      action={formAction}
      className="w-full max-w-sm rounded-md3-xl bg-surface-container-high p-7 shadow-md3-2"
    >
      <h1 className="text-center text-xl font-semibold text-primary">
        Idea Seeder — Admin
      </h1>
      <input
        type="password"
        name="password"
        autoComplete="current-password"
        placeholder="Password"
        className="mt-5 w-full rounded-md3-lg border border-outline-variant bg-surface-container-low p-3 text-on-surface outline-none focus:border-primary"
      />
      {state?.error && (
        <p className="mt-3 text-center text-sm text-error">{state.error}</p>
      )}
      <SubmitButton />
    </form>
  );
}
