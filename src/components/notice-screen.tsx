/**
 * NoticeScreen — the shared centered message layout used by terminal/edge
 * states (invalid link, error, session complete). Server-safe and
 * presentational; pass an optional action via `children` (e.g. a client
 * "Try again" button).
 *
 * Plain language, no telemetry: a blue status dot + short eyebrow, a heavy
 * display heading, and a hairline-ruled body paragraph.
 */
import { BrandHeader, ContextTag, SiteFooter } from "@/components/chrome";

export default function NoticeScreen({
  eyebrow,
  title,
  body,
  tone = "neutral",
  children,
}: {
  eyebrow: string;
  title: string;
  body: string;
  tone?: "neutral" | "error";
  children?: React.ReactNode;
}) {
  return (
    <>
      <BrandHeader />
      <main className="relative flex min-h-screen items-center justify-center px-margin-mobile md:px-margin-desktop">
        <div className="z-10 w-full max-w-3xl">
          {tone === "error" ? (
            <div className="flex items-center gap-2.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-error" />
              <span className="text-label-sm font-medium text-on-surface-variant">
                {eyebrow}
              </span>
            </div>
          ) : (
            <ContextTag label={eyebrow} />
          )}

          <h1 className="mt-10 text-display-lg-mobile tracking-tight text-on-surface md:text-display-lg">
            {title}
          </h1>
          <p className="mt-5 max-w-2xl border-l-2 border-hairline pl-6 text-body-lg text-on-surface-variant">
            {body}
          </p>

          {children && <div className="mt-10">{children}</div>}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
