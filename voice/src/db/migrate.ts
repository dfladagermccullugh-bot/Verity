/** Applies numbered .sql migrations once each, in order, each in its own transaction. */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Sql } from "./sql.js";

const DIR = fileURLToPath(new URL("./migrations/", import.meta.url));

export function migrationFiles(): string[] {
  return readdirSync(DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();
}

export async function migrate(sql: Sql): Promise<string[]> {
  await sql.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await sql.query<{ name: string }>("select name from schema_migrations")).map((r) => r.name));
  const applied: string[] = [];
  for (const name of migrationFiles()) {
    if (done.has(name)) continue;
    const text = readFileSync(DIR + name, "utf8");
    await sql.tx(async (tx) => {
      for (const statement of splitStatements(text)) await tx.query(statement);
      await tx.query("insert into schema_migrations (name) values ($1)", [name]);
    });
    applied.push(name);
  }
  return applied;
}

/** Split a migration into statements on semicolons, leaving $$-quoted function bodies whole. */
export function splitStatements(text: string): string[] {
  const out: string[] = [];
  let current = "";
  let inBody = false;
  for (const line of text.split("\n")) {
    if (!inBody && line.trim().startsWith("--")) continue;
    current += line + "\n";
    if ((line.match(/\$\$/g) ?? []).length % 2 === 1) inBody = !inBody;
    if (!inBody && line.trim().endsWith(";")) {
      const s = current.trim().replace(/;$/, "");
      if (s !== "") out.push(s);
      current = "";
    }
  }
  if (current.trim() !== "") out.push(current.trim());
  return out;
}
