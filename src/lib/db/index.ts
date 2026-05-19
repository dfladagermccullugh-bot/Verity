import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DB = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
  _pg?: ReturnType<typeof postgres>;
  _db?: DB;
};

function init(): DB {
  if (globalForDb._db) return globalForDb._db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const client =
    globalForDb._pg ?? postgres(connectionString, { max: 1, prepare: false });
  if (process.env.NODE_ENV !== "production") globalForDb._pg = client;

  const instance = drizzle(client, { schema });
  if (process.env.NODE_ENV !== "production") globalForDb._db = instance;
  return instance;
}

// Lazy proxy: the connection is only created on first query, not at import.
export const db = new Proxy({} as DB, {
  get(_t, prop) {
    const real = init();
    const value = (real as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
}) as DB;
