export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="text-center">
        <h1
          className="font-display text-7xl font-bold tracking-tight text-on-surface sm:text-8xl"
          style={{ fontFeatureSettings: '"ss01"', fontVariationSettings: '"SOFT" 50, "opsz" 144' }}
        >
          Verity
        </h1>
        <p className="mt-4 text-sm text-on-surface-variant">
          is invite-only. If you have a link, open it directly.
        </p>
      </div>
    </main>
  );
}
