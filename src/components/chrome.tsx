/**
 * Verity chrome — the calm frame shared across the invitee experience.
 * Server-safe (no hooks): pure presentational structure.
 *
 * Warm Paper Calm, plain language: a quiet sentence-case wordmark and a single
 * blue dot for status. No instrument/telemetry motif — no uppercase eyebrows,
 * no "STATUS // …" / "PROTOCOL // …" footer.
 */
import ThemeToggle from "@/components/theme-toggle";

/** Quiet wordmark, centered at the top of the viewport, over a hairline. */
export function BrandHeader() {
  return (
    <header className="pointer-events-none fixed top-0 z-50 flex h-16 w-full items-center justify-center border-b border-hairline bg-surface/80 backdrop-blur-sm">
      <span className="text-sm font-semibold tracking-tight text-on-surface">
        Verity
      </span>
    </header>
  );
}

/** Small 6px status dot. Blue = active, neutral = inactive. */
export function StatusDot({ active = true }: { active?: boolean }) {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 rounded-full ${
        active ? "bg-primary" : "bg-outline-variant"
      }`}
    />
  );
}

/** Eyebrow: blue dot + a short, plain sentence-case label. e.g. "Question 4". */
export function ContextTag({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <StatusDot />
      <span className="text-label-sm font-medium text-on-surface-variant">
        {label}
      </span>
    </div>
  );
}

/**
 * Quiet footer — just the wordmark and the theme toggle. No telemetry.
 * The theme toggle is the one interactive control, so the footer accepts
 * pointer events while staying visually minimal.
 */
export function SiteFooter() {
  return (
    <footer className="fixed bottom-0 z-50 flex h-14 w-full items-center justify-between border-t border-hairline bg-surface/80 px-margin-mobile text-xs text-on-surface-variant backdrop-blur-sm md:px-margin-desktop">
      <span>Verity</span>
      <ThemeToggle />
    </footer>
  );
}
