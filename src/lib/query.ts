import { getDb, type Row } from "./db";
import { ensureReady } from "./schema";
import { capRows, guardSql, MAX_ROWS } from "./sql-guard";

export interface QueryResult {
  ok: true;
  rows: Row[];
  columns: string[];
  truncated: boolean;
  ms: number;
}
export interface QueryFailure {
  ok: false;
  error: string;
}

function normalizeCell(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return Number(v);
  return v;
}

/** Runs read-only SQL with a row cap. Used both for saved widgets and the assistant's queries. */
export async function runWidgetQuery(sql: string, limit = MAX_ROWS): Promise<QueryResult | QueryFailure> {
  const guarded = guardSql(sql);
  if (!guarded.ok) return { ok: false, error: guarded.reason };
  await ensureReady();
  const db = await getDb();
  const started = Date.now();
  try {
    const rows = await db.queryReadOnly<Row>(capRows(guarded.sql, limit + 1));
    const truncated = rows.length > limit;
    const sliced = rows
      .slice(0, limit)
      .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, normalizeCell(v)])));
    const columns = sliced[0] ? Object.keys(sliced[0]) : [];
    return { ok: true, rows: sliced, columns, truncated, ms: Date.now() - started };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    return { ok: false, error: msg.replace(/\s+/g, " ").slice(0, 600) };
  }
}
