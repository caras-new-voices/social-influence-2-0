import { createHash } from "node:crypto";
import { getDb } from "./db";

/**
 * A stored answer for a box's query, so a dashboard opened a second time (by anyone, on any server
 * instance) does not run its queries again. An answer is kept under the query, its brands, period
 * and market, and is used only while the data stamp is the same: the stamp changes whenever data
 * is imported, a seed pack loads, the labels are corrected, the views are rebuilt or the app reads
 * new posts and comments itself.
 */
const DDL = `CREATE TABLE IF NOT EXISTS query_cache (key text PRIMARY KEY, stamp text NOT NULL, body text NOT NULL, at timestamptz NOT NULL DEFAULT now())`;
const STAMP_SQL = `SELECT md5(coalesce((SELECT string_agg(key || '=' || coalesce(value, ''), ';' ORDER BY key) FROM app_meta), '')
  || '|' || coalesce((SELECT max(id)::text || ':' || count(*) FILTER (WHERE finished_at IS NOT NULL)::text FROM imports), '')
  || '|' || (SELECT count(*)::text FROM live_post_labels) || ':' || (SELECT count(*)::text FROM live_comment_labels)) AS stamp`;

const g = globalThis as unknown as { __siQueryCache?: { ready?: Promise<void>; stamp?: { value: string; at: number } } };
const state = (g.__siQueryCache ??= {});
const off = () => process.env.QUERY_CACHE === "0";

async function ensure() {
  state.ready ??= (async () => { await (await getDb()).exec(DDL); })().catch((e) => { state.ready = undefined; throw e; });
  return state.ready;
}

/** The data stamp, read at most every 20 seconds per server instance. */
async function stamp(): Promise<string> {
  if (state.stamp && Date.now() - state.stamp.at < 20_000) return state.stamp.value;
  const rows = await (await getDb()).query<{ stamp: string }>(STAMP_SQL);
  state.stamp = { value: rows[0]?.stamp ?? "", at: Date.now() };
  return state.stamp.value;
}

export function cacheKey(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** The stored answer for a key, or null. Never throws: a cache that cannot be read is a miss. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  if (off()) return null;
  try {
    await ensure();
    const rows = await (await getDb()).query<{ body: string }>(`SELECT body FROM query_cache WHERE key = $1 AND stamp = $2`, [key, await stamp()]);
    return rows[0] ? (JSON.parse(rows[0].body) as T) : null;
  } catch {
    return null;
  }
}

/** Stores an answer under the current stamp. Answers from an older stamp are cleared now and then. */
export async function cachePut(key: string, value: unknown): Promise<void> {
  if (off()) return;
  try {
    await ensure();
    const body = JSON.stringify(value);
    if (body.length > 400_000) return;
    const db = await getDb();
    const s = await stamp();
    await db.query(`INSERT INTO query_cache (key, stamp, body) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET stamp = EXCLUDED.stamp, body = EXCLUDED.body, at = now()`, [key, s, body]);
    if (Math.random() < 0.02) await db.query(`DELETE FROM query_cache WHERE stamp <> $1`, [s]);
  } catch {
    // A box that could not be stored is simply worked out again next time.
  }
}
