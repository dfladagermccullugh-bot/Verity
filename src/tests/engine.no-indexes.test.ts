import { vi } from "vitest";
import { journalLength, migrationsUpTo } from "./helpers/pglite-db";
import { modelController } from "./helpers/engine-fixture";
import { engineSuite } from "./helpers/engine-suite";

const mocks = vi.hoisted(() => ({
  model: null as unknown as ReturnType<typeof modelController>,
  oneShot: null as unknown as ReturnType<typeof vi.fn>,
  email: null as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock("@/lib/db", async () => {
  const h = await import("./helpers/pglite-db");
  return { db: h.proxiedDb };
});
vi.mock("@/lib/anthropic", async () => {
  const { modelController } = await import("./helpers/engine-fixture");
  mocks.model = modelController();
  mocks.oneShot = vi.fn();
  return {
    callModel: mocks.model.fn,
    callModelOneShot: mocks.oneShot,
    getModelName: () => "test-model",
    MAX_TOKENS: 4096,
  };
});
vi.mock("@/lib/email", () => {
  mocks.email = vi.fn(async () => {});
  return { sendPrdEmail: mocks.email };
});
vi.mock("@/lib/construct-brief", () => ({ buildConstructBrief: vi.fn(async () => null) }));

// The application-level claims must hold even where migration 0006 could
// not create its unique indexes: run the same suite on the 0000–0005 schema.
engineSuite("without the 0006 indexes", () => migrationsUpTo(journalLength() - 1), {
  get model() {
    return mocks.model;
  },
  get oneShot() {
    return mocks.oneShot;
  },
  get email() {
    return mocks.email;
  },
} as never);
