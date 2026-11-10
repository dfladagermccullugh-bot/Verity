/**
 * The one database interface the product uses, with two adapters: real Postgres (postgres.js) in
 * production and PGlite (Postgres compiled to run in-process) in tests. Same SQL for both.
 */

export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Run `fn` in one transaction; it commits when `fn` resolves and rolls back when it throws. */
  tx<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

interface PgliteLike {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  transaction<T>(fn: (tx: PgliteLike) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}

export function pgliteSql(db: PgliteLike): Sql {
  const wrap = (d: PgliteLike, top: boolean): Sql => ({
    query: async <T>(text: string, params: unknown[] = []) => (await d.query(text, params)).rows as T[],
    tx: <T>(fn: (sql: Sql) => Promise<T>) => (top ? d.transaction((t) => fn(wrap(t, false))) : fn(wrap(d, false))),
    close: async () => {
      if (top) await d.close?.();
    },
  });
  return wrap(db, true);
}

interface PostgresJsLike {
  unsafe(text: string, params?: unknown[]): Promise<unknown[]>;
  begin<T>(fn: (tx: PostgresJsLike) => Promise<T>): Promise<T>;
  end?(): Promise<void>;
}

export function postgresSql(client: PostgresJsLike): Sql {
  const wrap = (c: PostgresJsLike, top: boolean): Sql => ({
    query: async <T>(text: string, params: unknown[] = []) => [...(await c.unsafe(text, params as never[]))] as T[],
    tx: <T>(fn: (sql: Sql) => Promise<T>) => (top ? (c.begin((t) => fn(wrap(t, false))) as Promise<T>) : fn(wrap(c, false))),
    close: async () => {
      if (top) await c.end?.();
    },
  });
  return wrap(client, true);
}
