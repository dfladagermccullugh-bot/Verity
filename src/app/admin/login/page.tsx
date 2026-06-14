import { GridUnderlay } from "@/components/chrome";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default function AdminLoginPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center px-margin-mobile md:px-margin-desktop">
      <GridUnderlay />
      <div className="z-10 w-full max-w-sm">
        <LoginForm />
      </div>
    </main>
  );
}
