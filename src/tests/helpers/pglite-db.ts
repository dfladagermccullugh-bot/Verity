import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as schema from "@/lib/db/schema";

export type TestDb = PgliteDatabase<typeof schema> & { $client: PGlite };

export const MIGRATIONS_DIR = resolve(__dirname, "../../../drizzle");

/**
 * A migrations folder holding only the first `count` journal entries, so a
 * test can apply 0000..N, seed rows, then apply the rest.
 */
export function migrationsUpTo(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), "verity-migrations-"));
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  const journalPath = join(dir, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf-8"));
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

export function journalLength(): number {
  return JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf-8")).entries
    .length;
}

/** A fresh in-memory Postgres with the repo's real migrations applied. */
export async function makeTestDb(migrationsFolder = MIGRATIONS_DIR): Promise<TestDb> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as TestDb;
  await migrate(db, { migrationsFolder });
  return db;
}

export async function truncateAll(db: TestDb): Promise<void> {
  await db.$client.exec("truncate table turns, rounds, sessions, invites cascade");
}

/**
 * Swappable target for the `@/lib/db` mock: tests point `holder.db` at a
 * PGlite instance and the engine's `db` delegates to it.
 */
export const holder: { db: TestDb | null } = { db: null };

export const proxiedDb = new Proxy(
  {},
  {
    get(_t, prop) {
      if (!holder.db) throw new Error("test db not initialised");
      const value = (holder.db as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === "function" ? (value as Function).bind(holder.db) : value;
    },
  }
);
