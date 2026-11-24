/**
 * Database access.
 *
 * Two drivers, one interface:
 *   - `pg` against any Postgres server (Neon in production).
 *   - `@electric-sql/pglite` (Postgres compiled to WASM) for local development
 *     and the test suite, so the app can be exercised without a server.
 *
 * The connection pool and the schema bootstrap are cached on `globalThis`.
 * That cache is a *connection cache*, not application state: every piece of
 * paste data lives in Postgres, so a cold start, a new lambda instance or a
 * concurrent instance all behave identically.
 */

export interface QueryResult<T> {
  rows: T[];
}

export interface Db {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

const CACHE_KEY = Symbol.for('pastebin-lite.db');

interface Cache {
  db?: Promise<Db>;
  schema?: Promise<void>;
}

function cache(): Cache {
  const g = globalThis as unknown as Record<symbol, Cache | undefined>;
  if (!g[CACHE_KEY]) g[CACHE_KEY] = {};
  return g[CACHE_KEY]!;
}

async function connect(): Promise<Db> {
  if (process.env.USE_PGLITE === '1') {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = process.env.PGLITE_DIR;
    const pglite = await PGlite.create(dir ? dir : undefined);
    return {
      query: async (text, params) => {
        const result = await pglite.query(text, params as unknown[] | undefined);
        return { rows: result.rows as never[] };
      },
    };
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and point it at a Postgres database.',
    );
  }

  const { Pool } = await import('pg');
  // Honour sslmode from the connection string; Neon requires TLS, a plain
  // developer database usually does not offer it.
  const wantsSsl = /[?&]sslmode=(require|prefer|verify-ca|verify-full)/.test(connectionString);
  const pool = new Pool({
    connectionString,
    ssl: wantsSsl ? { rejectUnauthorized: true } : undefined,
    // One serverless invocation handles one request; a large pool only wastes
    // Postgres connections.
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
  });
  return pool;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS pastes (
    id          TEXT PRIMARY KEY,
    content     TEXT NOT NULL,
    max_views   INTEGER,
    views       INTEGER NOT NULL DEFAULT 0,
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

/**
 * Creates the schema if it is missing. Runs at most once per instance and is
 * idempotent, so the deployment needs no migration step or shell access.
 */
async function migrate(db: Db): Promise<void> {
  await db.query(SCHEMA);
  await db.query('CREATE INDEX IF NOT EXISTS pastes_expires_at_idx ON pastes (expires_at)');
}

export async function getDb(): Promise<Db> {
  const c = cache();
  if (!c.db) {
    c.db = connect().catch((error) => {
      c.db = undefined; // let the next request retry instead of caching a failure
      throw error;
    });
  }
  const db = await c.db;

  if (!c.schema) {
    c.schema = migrate(db).catch((error) => {
      c.schema = undefined;
      throw error;
    });
  }
  await c.schema;

  return db;
}

/** Cheap round trip used by the health check. */
export async function pingDb(): Promise<void> {
  const db = await getDb();
  await db.query('SELECT 1');
}
