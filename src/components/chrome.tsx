/**
 * Verity chrome — the calm frame shared across the invitee experience.
 * Server-safe (no hooks): pure presentational structure.
 *
 * Warm Paper Calm: quiet sentence-case wordmark, soft neutral telemetry, a
 * single blue dot for status. No atmospheric grid or scanline.
 */
import ThemeToggle from "@/components/theme-toggle";

/** Quiet wordmark, centered at the top of the viewport. */
export function BrandHeader() {
  return (
    <header className="pointer-events-none fixed top-0 z-50 flex h-16 w-full items-center justify-center">
      <span className="text-sm font-semibold tracking-tight text-on-surface-variant">
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

/** Context tag: blue dot + quiet label. e.g. "Decision matrix // 04". */
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

/** Quiet status footer. `protocol` is the real skill-prompt fingerprint. */
export function TelemetryFooter({
  protocol,
  status = "Secure",
}: {
  protocol?: string;
  status?: string;
}) {
  return (
    <footer className="pointer-events-none fixed bottom-0 z-50 flex h-14 w-full items-center justify-between px-margin-mobile text-xs text-on-surface-variant md:px-margin-desktop">
      <div className="flex items-center gap-6">
        <span className="flex items-center gap-2">
          <span className="text-on-surface-variant">Status</span>
          <span className="text-on-surface">{status}</span>
        </span>
        {protocol && (
          <span className="hidden items-center gap-2 sm:flex">
            <span className="text-on-surface-variant">Protocol</span>
            <span className="font-mono text-on-surface">V-{protocol}</span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-4">
        <ThemeToggle />
        <span className="text-on-surface-variant">Verity</span>
      </div>
    </footer>
  );
}
