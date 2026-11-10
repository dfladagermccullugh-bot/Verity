import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import { migrate } from "../src/db/migrate.js";
import { pgliteSql, postgresSql, type Sql } from "../src/db/sql.js";

/**
 * A fresh, migrated database for one test. In-process Postgres (PGlite) by default; set
 * TEST_DATABASE_URL to run the same tests against a real Postgres server, each in its own schema.
 */
export async function testDb(): Promise<Sql> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const sql = pgliteSql(new PGlite() as never);
    await migrate(sql);
    return sql;
  }
  const schema = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create schema ${schema}`);
  await admin.end();
  const client = postgres(url, { max: 20, onnotice: () => {}, connection: { search_path: schema } });
  const sql = postgresSql(client as never);
  await migrate(sql);
  return sql;
}
