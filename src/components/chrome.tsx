/**
 * Midnight Precision chrome — the instrument frame shared across the invitee
 * experience. Server-safe (no hooks): pure presentational structure.
 *
 * Depth is tonal and flat: faint hairline grid, a single drifting scanline,
 * engraved-uppercase telemetry. Signal Gold appears only as small status dots.
 */

/** Tracked-uppercase wordmark, centered at the top of the viewport. */
export function BrandHeader() {
  return (
    <header className="pointer-events-none fixed top-0 z-50 flex h-20 w-full items-center justify-center">
      <span className="text-label-sm uppercase tracking-engrave text-on-surface-variant opacity-60">
        Verity
      </span>
    </header>
  );
}

/** Faint 12-column hairline underlay — structure without bulk. */
export function GridUnderlay() {
  return (
    <div className="pointer-events-none absolute inset-0 grid grid-cols-12 opacity-[0.04]">
      {Array.from({ length: 11 }).map((_, i) => (
        <div key={i} className="h-full border-r border-hairline" />
      ))}
      <div className="h-full" />
    </div>
  );
}

/** Single gold-tinted line drifting down the viewport. Atmospheric only. */
export function Scanline() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[100] h-px w-full animate-scanline bg-primary/5"
    />
  );
}

/** Small 6px status dot. Gold = active, charcoal = inactive. */
export function StatusDot({ active = true }: { active?: boolean }) {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 ${
        active ? "bg-primary-container" : "bg-hairline"
      }`}
    />
  );
}

/** Context tag: gold dot + engraved label. e.g. "INTERROGATION SEQUENCE // 04". */
export function ContextTag({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <StatusDot />
      <span className="text-label-sm uppercase tracking-engrave text-on-surface-variant">
        {label}
      </span>
    </div>
  );
}

/** Industrial telemetry footer. `protocol` is the real skill-prompt fingerprint. */
export function TelemetryFooter({
  protocol,
  status = "Secure",
}: {
  protocol?: string;
  status?: string;
}) {
  return (
    <footer className="pointer-events-none fixed bottom-0 z-50 flex h-20 w-full items-center justify-between px-margin-mobile opacity-30 md:px-margin-desktop">
      <div className="flex items-center gap-10 text-[10px] uppercase tracking-engrave text-on-surface-variant">
        <span className="flex items-center gap-2">
          <span>Status</span>
          <span className="text-on-surface">{status}</span>
        </span>
        {protocol && (
          <span className="hidden items-center gap-2 sm:flex">
            <span>Protocol</span>
            <span className="font-mono text-on-surface">V-{protocol}</span>
          </span>
        )}
      </div>
      <div className="text-[10px] uppercase tracking-engrave text-on-surface-variant">
        Verity // Midnight Precision
      </div>
    </footer>
  );
}
