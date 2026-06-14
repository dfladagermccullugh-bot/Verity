import { BrandHeader, Scanline, GridUnderlay, TelemetryFooter } from "@/components/chrome";

export default function Home() {
  return (
    <>
      <Scanline />
      <BrandHeader />
      <main className="relative flex min-h-screen items-center justify-center px-margin-mobile md:px-margin-desktop">
        <GridUnderlay />
        <div className="z-10 text-center">
          <h1 className="text-display-xl uppercase tracking-engrave text-on-surface">
            Verity
          </h1>
          <p className="mt-6 text-label-sm uppercase tracking-engrave text-on-surface-variant">
            Access is restricted
          </p>
          <p className="mx-auto mt-4 max-w-sm text-body-md text-on-surface-variant opacity-70">
            Present a valid credential to proceed. Open your invitation link
            directly.
          </p>
        </div>
      </main>
      <TelemetryFooter status="Standby" />
    </>
  );
}
