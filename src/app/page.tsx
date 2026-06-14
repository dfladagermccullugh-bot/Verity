import { GridUnderlay } from "@/components/chrome";

export default function Home() {
  return (
    <main className="relative flex min-h-screen items-center justify-center px-margin-mobile md:px-margin-desktop">
      <GridUnderlay />
      <div className="z-10 text-center">
        <h1 className="text-display-xl uppercase tracking-engrave text-on-surface">
          Verity
        </h1>
        <p className="mt-6 text-body-md text-on-surface-variant opacity-70">
          Verity is invite-only. Open your invitation link directly.
        </p>
      </div>
    </main>
  );
}
