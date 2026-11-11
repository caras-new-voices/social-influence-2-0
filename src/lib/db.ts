
/**
 * Database adapter. Uses Postgres (node-postgres) when DATABASE_URL is set
 * (Vercel Postgres / Neon / Supabase), otherwise an embedded PGlite database
 * persisted under data/pglite for local development.
 */
export type Row = Record<string, unknown>;

export interface Db {
  kind: "pg" | "pglite";
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs one or more statements without parameters (DDL). */
  exec(sql: string): Promise<void>;
  /** Runs a single statement inside a READ ONLY transaction with a statement timeout. */
  queryReadOnly<T extends Row = Row>(sql: string, timeoutMs?: number): Promise<T[]>;
}

const g = globalThis as unknown as { __siDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!g.__siDb) g.__siDb = createDb();
  return g.__siDb;
}

async function createDb(): Promise<Db> {
  // Vercel's Neon integration sets DATABASE_URL (pooled); older templates set POSTGRES_URL.
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (url) return createPg(url);
  return createPglite();
}

async function createPg(url: string): Promise<Db> {
  const pg = await import("pg");
  const { Pool, types } = pg.default ?? pg;
  // int8 and numeric arrive as strings by default; charts need numbers.
  types.setTypeParser(20, (v: string) => Number(v));
  types.setTypeParser(1700, (v: string) => Number(v));
  types.setTypeParser(701, (v: string) => Number(v));
  const needsSsl = !/localhost|127\.0\.0\.1/.test(url);
  const pool = new Pool({
    connectionString: url,
    max: 5,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });
  return {
    kind: "pg",
    async query<T extends Row>(sql: string, params: unknown[] = []) {
      const res = await pool.query(sql, params);
      return res.rows as T[];
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async queryReadOnly<T extends Row>(sql: string, timeoutMs = 8000) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN READ ONLY");
        await client.query(`SET LOCAL statement_timeout = ${Math.max(1000, Math.floor(timeoutMs))}`);
        const res = await client.query(sql);
        return res.rows as T[];
      } finally {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* ignore */
        }
        client.release();
      }
    },
  };
}

async function createPglite(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const path = await import("node:path");
  const dataDir = process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), "data", "pglite");
  const db = new PGlite(dataDir, {
    parsers: {
      20: (v: string) => Number(v),
      1700: (v: string) => Number(v),
      701: (v: string) => Number(v),
    },
  });
  await db.waitReady;
  return {
    kind: "pglite",
    async query<T extends Row>(sql: string, params: unknown[] = []) {
      const res = await db.query<T>(sql, params);
      return res.rows;
    },
    async exec(sql: string) {
      await db.exec(sql);
    },
    async queryReadOnly<T extends Row>(sql: string, timeoutMs = 8000) {
      return db.transaction(async (tx) => {
        await tx.query("SET TRANSACTION READ ONLY");
        await tx.query(`SET LOCAL statement_timeout = ${Math.max(1000, Math.floor(timeoutMs))}`);
        const res = await tx.query<T>(sql);
        return res.rows;
      });
    },
  };
}
