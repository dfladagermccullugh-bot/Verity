/**
 * ThinkingScreen — the full-screen "processing" state: a soft pulsing blue
 * "eye" (concentric rings) over a calm label. Used for route-level loading
 * and while a fresh round's first question is being prepared.
 *
 * Server-safe; motion is pure CSS (animate-pulse-dot / pulse-ring), gated by
 * the global prefers-reduced-motion reset in globals.css.
 */
import { BrandHeader, SiteFooter } from "@/components/chrome";

export default function ThinkingScreen({
  label = "Thinking…",
}: {
  label?: string;
}) {
  return (
    <>
      <BrandHeader />
      <main
        className="relative flex min-h-screen flex-col items-center justify-center gap-6 px-margin-mobile md:px-margin-desktop"
        role="status"
        aria-live="polite"
      >
        <span className="relative flex h-20 w-20 items-center justify-center">
          <span className="absolute inline-flex h-full w-full animate-pulse-dot rounded-full bg-primary/15" />
          <span className="absolute inline-flex h-12 w-12 animate-pulse-dot rounded-full bg-primary/25" />
          <span className="relative inline-flex h-4 w-4 rounded-full bg-primary" />
        </span>
        <span className="text-body-md text-on-surface-variant">{label}</span>
      </main>
      <SiteFooter />
    </>
  );
}
