"use client";

import { useFormState, useFormStatus } from "react-dom";
import { login } from "@/actions/admin";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-4 w-full rounded-xl bg-seed-accent py-3 font-semibold text-seed-bg transition active:scale-[0.98] disabled:opacity-40"
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
      className="w-full max-w-sm rounded-2xl bg-seed-card p-7 shadow-xl"
    >
      <h1 className="text-center text-xl font-semibold text-seed-accent">
        Idea Seeder — Admin
      </h1>
      <input
        type="password"
        name="password"
        autoComplete="current-password"
        placeholder="Password"
        className="mt-5 w-full rounded-xl border border-white/10 bg-seed-bg p-3 outline-none focus:border-seed-accent/60"
      />
      {state?.error && (
        <p className="mt-3 text-center text-sm text-red-400">{state.error}</p>
      )}
      <SubmitButton />
    </form>
  );
}
