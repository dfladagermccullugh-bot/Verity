import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Production builds inline `.md` skill files via webpack (see next.config.mjs).
// Vitest uses vite, which doesn't know about that loader — this plugin replays
// the same "import a .md file as a default-exported string" contract.
const mdAsString = {
  name: "md-as-string",
  transform(code: string, id: string) {
    if (id.endsWith(".md")) {
      return {
        code: `export default ${JSON.stringify(code)};`,
        map: null,
      };
    }
    return null;
  },
};

export default defineConfig({
  plugins: [mdAsString],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      // server-only is a Next.js build-time marker; under vitest it has no
      // runtime equivalent, so stub it to an empty module.
      "server-only": resolve(__dirname, "src/tests/server-only-shim.ts"),
    },
  },
  test: {
    include: ["src/tests/**/*.test.ts"],
    environment: "node",
  },
});
