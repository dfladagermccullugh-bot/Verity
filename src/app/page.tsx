import { SiteFooter } from "@/components/chrome";

export default function Home() {
  return (
    <>
      <main className="relative flex min-h-screen items-center justify-center px-margin-mobile md:px-margin-desktop">
        <div className="z-10 w-full max-w-3xl text-center">
          <h1 className="text-display-lg-mobile font-extrabold tracking-tight text-on-surface md:text-display-xl">
            Verity
          </h1>
          <p className="mx-auto mt-6 max-w-md border-l-2 border-hairline pl-6 text-left text-body-md text-on-surface-variant">
            Verity is invite-only. Open your secure invitation link directly.
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
