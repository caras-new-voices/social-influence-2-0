import { getDb, type Row } from "./db";
import { ensureReady } from "./schema";
import { ISO_DATE, type PeriodWindow } from "./period";
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

/** Transaction-local settings that make the posts and comments views filter to a window. */
export function periodSettings(window?: PeriodWindow | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (window?.start && ISO_DATE.test(window.start)) out["app.period_start"] = window.start;
  if (window?.end && ISO_DATE.test(window.end)) out["app.period_end"] = window.end;
  return out;
}

/**
 * Runs read-only SQL with a row cap. Used both for saved widgets and the assistant's queries.
 * `window` restricts the posts and comments views to [start, end); omit it for all time.
 * "Us" in a query is focal_brand(); competitors are is_competitor(brand).
 */
export async function runWidgetQuery(sql: string, limit = MAX_ROWS, window?: PeriodWindow | null, opts?: { focal?: string }): Promise<QueryResult | QueryFailure> {
  const guarded = guardSql(sql);
  if (!guarded.ok) return { ok: false, error: guarded.reason };
  await ensureReady();
  const db = await getDb();
  const started = Date.now();
  try {
    // opts.focal makes focal_brand() return another tracked brand for this query (template checks, per-dashboard focus).
    const settings = periodSettings(window);
    if (opts?.focal) settings["app.focal_brand"] = opts.focal;
    const rows = await db.queryReadOnly<Row>(capRows(guarded.sql, limit + 1), 8000, settings);
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
