/**
 * Incremental imports of the four IMAI social-listening exports (segments, posts, comments,
 * influencers). Loading is idempotent: rows are upserted on their natural keys, so re-exporting a
 * month refreshes engagement numbers instead of duplicating rows. Every import is logged in
 * `imports` and followed by period detection (see period-events.ts).
 */
import type { Row } from "./db";
import { getDb } from "./db";
import { getCoverage } from "./coverage";
import { detectPeriodEvents, notifyWebhook, type PeriodEvent } from "./period-events";
import { ARRAY_COLUMNS, COLUMNS, JSON_COLUMNS, PHYSICAL, ensureReady, toParam } from "./schema";

export type DatasetTable = "segments" | "posts" | "comments" | "influencers";
export const DATASET_TABLES: DatasetTable[] = ["segments", "posts", "comments", "influencers"];

export interface ImportInput {
  segments?: Row[];
  posts?: Row[];
  comments?: Row[];
  influencers?: Row[];
  /** Export's own date range (ISO dates, inclusive). Defaults to the min / max published_at of the batch. */
  coversFrom?: string | null;
  coversTo?: string | null;
  source: string;
}

export type ImportRecord = {
  id: number;
  received_at: string;
  finished_at: string | null;
  source: string | null;
  covers_from: string | null;
  covers_to: string | null;
  posts_added: number;
  posts_updated: number;
  comments_added: number;
  comments_updated: number;
  influencers_added: number;
  influencers_updated: number;
  segments_upserted: number;
  status: string;
  notes: string | null;
};

export interface ImportResult {
  import: ImportRecord;
  events: PeriodEvent[];
}

/** Natural keys used for the upserts. */
const KEYS: Record<DatasetTable, string[]> = {
  segments: ["id"],
  posts: ["segment_id", "post_id"],
  comments: ["segment_id", "comment_id"],
  influencers: ["segment_id", "influencer_id"],
};

/** Columns refreshed when a row already exists. */
const COMMENT_ANALYSIS_START = COLUMNS.comments.indexOf("sentiment");
const UPDATE_COLUMNS: Record<DatasetTable, string[]> = {
  segments: COLUMNS.segments.filter((c) => c !== "id"),
  posts: ["likes", "comments", "shares", "views", "saves", "engagement", "emv", "followers", "text", "title", "url", "image_url", "video_url", "sentiment", "is_paid"],
  comments: ["likes", "reply_count", ...COLUMNS.comments.slice(COMMENT_ANALYSIS_START)],
  influencers: COLUMNS.influencers.filter((c) => c !== "segment_id" && c !== "influencer_id"),
};

const BATCH: Record<DatasetTable, number> = { segments: 50, posts: 200, comments: 250, influencers: 200 };

/* ---------------------------------------------------------------- */
/* Value coercion (CSV cells and loosely typed JSON)                  */
/* ---------------------------------------------------------------- */

const BOOL_COLUMNS = new Set(["is_paid", "automated_response", "repeat_buyer", "is_verified", "has_report"]);
const NUMBER_COLUMNS = new Set([
  "id", "post_id", "segment_id", "influencer_id", "comment_id",
  "likes", "comments", "shares", "views", "saves", "engagement", "emv", "followers", "budget_min", "budget_max",
  "reply_count", "sentiment_score", "toxicity", "spam_rate", "authenticity_score", "purchase_intent_score", "caption_relevance",
  "engagements", "engagement_rate", "avg_views", "imai_score", "audience_female", "audience_male", "audience_credibility",
  "brand_safety_score", "avg_comment_sentiment",
  "total_emv", "total_engagement", "estimated_impressions", "total_unique_influencers", "invested_budget_min", "invested_budget_max",
]);

function coerce(col: string, v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "" || /^(null|nan|none)$/i.test(s)) return null;
    if (NUMBER_COLUMNS.has(col)) {
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }
    if (BOOL_COLUMNS.has(col)) return /^(true|t|1|yes)$/i.test(s);
    if (JSON_COLUMNS.has(col)) {
      try { return JSON.parse(s); } catch { return null; }
    }
    if (ARRAY_COLUMNS.has(col)) {
      if (s.startsWith("[")) {
        try { return (JSON.parse(s) as unknown[]).map(String); } catch { /* fall through */ }
      }
      const inner = s.startsWith("{") && s.endsWith("}") ? s.slice(1, -1) : s;
      return inner.split(/[;,|]/).map((t) => t.trim().replace(/^"|"$/g, "")).filter(Boolean);
    }
    return v;
  }
  if (typeof v === "number" && !Number.isFinite(v)) return null;
  return v;
}

/** Normalises one row of a dataset table: known columns only, typed values. */
export function coerceRow(table: DatasetTable, row: Row): Row {
  const out: Row = {};
  for (const c of COLUMNS[table]) if (c in row) out[c] = coerce(c, row[c]);
  return out;
}

/* ---------------------------------------------------------------- */
/* Upsert                                                             */
/* ---------------------------------------------------------------- */

interface UpsertCount { added: number; updated: number; skipped: number }

async function upsert(table: DatasetTable, rows: Row[], brands: Map<number, string>): Promise<UpsertCount> {
  const db = await getDb();
  const physical = PHYSICAL[table] ?? table;
  const cols = COLUMNS[table];
  const keys = KEYS[table];
  const updates = UPDATE_COLUMNS[table];
  // Keep the last occurrence of each key: ON CONFLICT cannot touch the same row twice in one statement.
  const byKey = new Map<string, Row>();
  let skipped = 0;
  for (const raw of rows) {
    const r = coerceRow(table, raw);
    if (keys.some((k) => r[k] === null || r[k] === undefined)) { skipped++; continue; }
    if (table !== "segments" && !r.brand) r.brand = brands.get(Number(r.segment_id)) ?? null;
    byKey.set(keys.map((k) => String(r[k])).join("|"), r);
  }
  const list = [...byKey.values()];
  const count: UpsertCount = { added: 0, updated: 0, skipped };
  const batch = BATCH[table];
  for (let i = 0; i < list.length; i += batch) {
    const chunk = list.slice(i, i + batch);
    const params: unknown[] = [];
    const values = chunk
      .map((r) => {
        const ph = cols.map((c) => {
          params.push(toParam(c, r[c]));
          const n = params.length;
          if (JSON_COLUMNS.has(c)) return `$${n}::jsonb`;
          if (ARRAY_COLUMNS.has(c)) return `$${n}::text[]`;
          return `$${n}`;
        });
        return `(${ph.join(",")})`;
      })
      .join(",");
    // Columns absent from every row of the batch keep their stored value on update.
    const present = updates.filter((c) => chunk.some((r) => c in r));
    const set = present.length ? present.map((c) => `${c} = EXCLUDED.${c}`).join(", ") : `${keys[0]} = EXCLUDED.${keys[0]}`;
    const res = await db.query<{ inserted: boolean }>(
      `INSERT INTO ${physical} (${cols.join(",")}) VALUES ${values} ON CONFLICT (${keys.join(",")}) DO UPDATE SET ${set} RETURNING (xmax = 0) AS inserted`,
      params,
    );
    for (const r of res) {
      if (r.inserted) count.added++;
      else count.updated++;
    }
  }
  return count;
}

function batchRange(input: ImportInput): { from: string | null; to: string | null } {
  let from: string | null = null;
  let to: string | null = null;
  for (const r of [...(input.posts ?? []), ...(input.comments ?? [])]) {
    const v = r.published_at;
    if (v === null || v === undefined || v === "") continue;
    const d = new Date(String(v));
    if (Number.isNaN(d.getTime())) continue;
    const iso = d.toISOString().slice(0, 10);
    if (!from || iso < from) from = iso;
    if (!to || iso > to) to = iso;
  }
  return { from, to };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Loads one export batch. Idempotent; returns the `imports` row and the period events it produced.
 * Throws (after marking the import failed) when a statement fails.
 */
export async function importBatch(input: ImportInput): Promise<ImportResult> {
  await ensureReady();
  const db = await getDb();
  for (const k of ["coversFrom", "coversTo"] as const) {
    const v = input[k];
    if (v && !ISO.test(v)) throw new Error(`${k} must be an ISO date (YYYY-MM-DD)`);
  }
  const range = batchRange(input);
  const coversFrom = input.coversFrom || range.from;
  const coversTo = input.coversTo || range.to;
  if (coversFrom && coversTo && coversFrom > coversTo) throw new Error("covers_from is after covers_to");

  const before = await getCoverage();
  const [row] = await db.query<{ id: number }>(
    `INSERT INTO imports (source, covers_from, covers_to, status) VALUES ($1, $2, $3, 'running') RETURNING id`,
    [input.source, coversFrom, coversTo],
  );
  const importId = Number(row.id);
  try {
    // Segments first so posts and comments without a brand can borrow it.
    const segs = await upsert("segments", input.segments ?? [], new Map());
    const brandRows = await db.query<{ id: number; brand: string }>(`SELECT id, brand FROM segments`);
    const brands = new Map(brandRows.map((b) => [Number(b.id), b.brand]));
    const posts = await upsert("posts", input.posts ?? [], brands);
    const comments = await upsert("comments", input.comments ?? [], brands);
    const infl = await upsert("influencers", input.influencers ?? [], brands);
    const skipped = posts.skipped + comments.skipped + infl.skipped + segs.skipped;
    const notes = [
      `segments ${segs.added + segs.updated}, posts +${posts.added}/~${posts.updated}, comments +${comments.added}/~${comments.updated}, influencers +${infl.added}/~${infl.updated}`,
      skipped ? `${skipped} rows skipped (missing key columns)` : "",
    ].filter(Boolean).join("; ");
    await db.query(
      `UPDATE imports SET status = 'done', finished_at = now(), posts_added = $2, posts_updated = $3, comments_added = $4, comments_updated = $5,
         influencers_added = $6, influencers_updated = $7, segments_upserted = $8, notes = $9 WHERE id = $1`,
      [importId, posts.added, posts.updated, comments.added, comments.updated, infl.added, infl.updated, segs.added + segs.updated, notes],
    );
  } catch (e) {
    await db
      .query(`UPDATE imports SET status = 'failed', finished_at = now(), notes = $2 WHERE id = $1`, [importId, (e as Error).message.slice(0, 2000)])
      .catch(() => {});
    throw e;
  }
  const after = await getCoverage();
  const events = await detectPeriodEvents(before, after, importId);
  for (const ev of events) notifyWebhook(ev);
  const [rec] = await db.query<ImportRecord>(`${IMPORT_SELECT} WHERE id = $1`, [importId]);
  return { import: rec, events };
}

const IMPORT_SELECT = `SELECT id::int AS id, received_at, finished_at, source, covers_from::text AS covers_from, covers_to::text AS covers_to,
  posts_added, posts_updated, comments_added, comments_updated, influencers_added, influencers_updated, segments_upserted, status, notes FROM imports`;

export async function listImports(limit = 20): Promise<ImportRecord[]> {
  await ensureReady();
  const db = await getDb();
  return db.query<ImportRecord>(`${IMPORT_SELECT} ORDER BY id DESC LIMIT $1`, [Math.max(1, Math.min(100, limit))]);
}

/* ---------------------------------------------------------------- */
/* Route protection                                                   */
/* ---------------------------------------------------------------- */

/**
 * Imports and the coverage cron are open locally. When IMPORT_TOKEN is set they require
 * `Authorization: Bearer <IMPORT_TOKEN>`; Vercel cron calls carry CRON_SECRET, accepted too.
 */
export function isAuthorized(req: Request): boolean {
  const tokens = [process.env.IMPORT_TOKEN, process.env.CRON_SECRET].filter((t): t is string => !!t);
  if (!process.env.IMPORT_TOKEN) return true;
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return !!m && tokens.includes(m[1].trim());
}
