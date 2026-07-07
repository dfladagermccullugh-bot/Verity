import ThemeToggle from "@/components/theme-toggle";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default function AdminLoginPage() {
  return (
    <>
      <header className="flex h-16 items-center gap-3 px-margin-mobile md:px-margin-desktop">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
        <span className="text-sm font-semibold tracking-tight text-on-surface">
          Verity
        </span>
      </header>
      <main className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-margin-mobile md:px-margin-desktop">
        <div className="w-full max-w-sm">
          <LoginForm />
        </div>
      </main>
      <footer className="flex h-16 items-center justify-between px-margin-mobile text-label-sm text-on-surface-variant md:px-margin-desktop">
        <span>Operator console</span>
        <ThemeToggle />
      </footer>
    </>
  );
}
