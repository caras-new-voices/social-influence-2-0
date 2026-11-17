import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { Db, Row } from "./db";
import { getDb } from "./db";
import { loadCatalog, loadPacks, syncCatalog } from "./catalog";
import { classifyPosts } from "./themes";

/**
 * Tables holding the social-listening dataset plus app state. The dataset lives in *_raw tables;
 * queries read it through views (SCOPED_VIEWS) that filter to a dashboard's brands and period.
 */
export const DDL = `
CREATE TABLE IF NOT EXISTS segments_raw (
  id integer PRIMARY KEY,
  name text, brand text, role text, scan_start_date timestamptz,
  insight_headline text, insight_framing text, insight_assess text, insight_act text, insight_anticipate text,
  insights_by_platform jsonb, comment_insights jsonb,
  total_emv double precision, total_engagement double precision, estimated_impressions double precision,
  total_unique_influencers double precision, invested_budget_min double precision, invested_budget_max double precision,
  industry text, description text, owner text, kind text, aliases jsonb, source_posts integer
);
CREATE TABLE IF NOT EXISTS industries (
  id text PRIMARY KEY, name text NOT NULL, category text, region text, summary text, suggested_focal text,
  pack text, sort integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS theme_rules (
  industry text NOT NULL, kind text NOT NULL, label text NOT NULL, pattern text NOT NULL, sort integer NOT NULL DEFAULT 0,
  PRIMARY KEY (industry, kind, label)
);
CREATE TABLE IF NOT EXISTS post_labels_raw (
  segment_id integer NOT NULL, post_id bigint NOT NULL, brand text, kind text NOT NULL, label text NOT NULL,
  PRIMARY KEY (segment_id, post_id, kind, label)
);
CREATE INDEX IF NOT EXISTS post_labels_brand_idx ON post_labels_raw (brand, kind);
CREATE TABLE IF NOT EXISTS posts_raw (
  post_id bigint, segment_id integer, brand text, influencer_id bigint, username text,
  platform text, post_type text, url text, title text, text text, published_at timestamptz,
  likes double precision, comments double precision, shares double precision, views double precision, saves double precision,
  engagement double precision, is_paid boolean, tier text, country text, language text, sentiment text,
  emv double precision, followers double precision, budget_min double precision, budget_max double precision,
  image_url text, video_url text,
  PRIMARY KEY (segment_id, post_id)
);
CREATE TABLE IF NOT EXISTS comments_raw (
  comment_id bigint, segment_id integer, brand text, post_id bigint, username text, text text,
  likes double precision, reply_count double precision, published_at timestamptz,
  sentiment text, sentiment_score double precision, emotion text, language text, topics text[], keywords text[],
  toxicity double precision, spam_rate double precision, moderation text, automated_response boolean,
  authenticity_score double precision, authenticity_flag text,
  purchase_intent_type text, purchase_intent_score double precision, purchase_blocker text,
  objection_category text, objection_context text, objection_phrase text,
  competitor_name text, competitor_favored text, competitor_mention_type text,
  loyalty_type text, loyalty_phrase text, repeat_buyer boolean,
  faq_topic text, faq_phrase text, feature_request_type text, feature_request text,
  safety_complaint_type text, safety_severity text, crisis_risk_type text, crisis_urgency text, crisis_phrase text,
  partnership_perception text, partnership_intensity text, brand_affinity_name text, brand_affinity_category text,
  use_case text, use_case_segment text, caption_relevance double precision,
  PRIMARY KEY (segment_id, comment_id)
);
CREATE TABLE IF NOT EXISTS influencers_raw (
  segment_id integer, brand text, influencer_id bigint, username text, fullname text, network text, url text, picture text,
  followers double precision, engagements double precision, engagement_rate double precision, avg_views double precision,
  is_verified boolean, imai_score double precision, country text, language text, ai_summary text, has_report boolean,
  audience_female double precision, audience_male double precision, audience_ages jsonb, audience_countries jsonb,
  audience_credibility double precision, brand_safety_score double precision, avg_comment_sentiment double precision,
  PRIMARY KEY (segment_id, influencer_id)
);
CREATE INDEX IF NOT EXISTS posts_brand_idx ON posts_raw (brand);
CREATE INDEX IF NOT EXISTS posts_published_idx ON posts_raw (published_at);
CREATE INDEX IF NOT EXISTS comments_brand_idx ON comments_raw (brand);
CREATE INDEX IF NOT EXISTS comments_post_idx ON comments_raw (post_id);
CREATE INDEX IF NOT EXISTS comments_published_idx ON comments_raw (published_at);

CREATE TABLE IF NOT EXISTS dashboards (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  widgets jsonb NOT NULL DEFAULT '[]'::jsonb,
  period jsonb,
  onboarding jsonb,
  scope jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id bigserial PRIMARY KEY,
  dashboard_id text NOT NULL,
  role text NOT NULL,
  content text NOT NULL DEFAULT '',
  proposals jsonb,
  api_content jsonb,
  followups jsonb,
  usage jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_dash_idx ON chat_messages (dashboard_id, id);
CREATE TABLE IF NOT EXISTS app_meta (key text PRIMARY KEY, value text);
CREATE TABLE IF NOT EXISTS imports (
  id bigserial PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now(),
  source text,
  covers_from date,
  covers_to date,
  posts_added integer NOT NULL DEFAULT 0,
  posts_updated integer NOT NULL DEFAULT 0,
  comments_added integer NOT NULL DEFAULT 0,
  comments_updated integer NOT NULL DEFAULT 0,
  influencers_added integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'done',
  notes text
);
CREATE TABLE IF NOT EXISTS usage_events (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  dashboard_id text,
  kind text NOT NULL,
  label text,
  provider text NOT NULL,
  model text NOT NULL,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cached_tokens bigint NOT NULL DEFAULT 0,
  total_tokens bigint NOT NULL DEFAULT 0,
  rounds integer NOT NULL DEFAULT 1,
  tool_calls integer NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 0,
  estimated boolean NOT NULL DEFAULT false,
  automatic boolean NOT NULL DEFAULT false,
  cost_usd double precision NOT NULL DEFAULT 0,
  message_id bigint
);
CREATE INDEX IF NOT EXISTS usage_events_created_idx ON usage_events (created_at);
CREATE INDEX IF NOT EXISTS usage_events_dash_idx ON usage_events (dashboard_id, created_at);
CREATE TABLE IF NOT EXISTS token_ledger (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,
  tokens bigint NOT NULL,
  usage_event_id bigint,
  note text,
  balance_after bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS period_events (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  import_id bigint,
  summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

/**
 * How queries see the dataset. Two transaction-local settings scope every read:
 *  - app.brands (brand names joined by chr(31)) and app.focal_brand: the dashboard's brands and
 *    which one is "us". posts_all, comments_all, influencers, segments, post_themes and post_hooks
 *    are views over the raw tables filtered to those brands, so a saved query can never reach
 *    another dashboard's brands.
 *  - app.period_start / app.period_end: posts and comments are views over posts_all and
 *    comments_all filtered to that window. Queries that look outside the period use the _all views.
 * With no setting the views return everything. The views list columns at creation: after adding a
 * column to a raw table, bump VIEWS_VERSION so they are rebuilt.
 */
const SEGMENT_COLUMNS = "id, name, brand, scan_start_date, insight_headline, insight_framing, insight_assess, insight_act, insight_anticipate, insights_by_platform, comment_insights, total_emv, total_engagement, estimated_impressions, total_unique_influencers, invested_budget_min, invested_budget_max, industry, description, owner, kind, source_posts";
const PERIOD_FILTER = (t: string) => `SELECT * FROM ${t}
  WHERE (published_at >= coalesce(nullif(current_setting('app.period_start', true), '')::timestamptz, '-infinity'::timestamptz)
     AND published_at <  coalesce(nullif(current_setting('app.period_end', true), '')::timestamptz, 'infinity'::timestamptz))
     OR (published_at IS NULL AND nullif(current_setting('app.period_start', true), '') IS NULL AND nullif(current_setting('app.period_end', true), '') IS NULL)`;
export const SCOPED_VIEWS = `
CREATE OR REPLACE FUNCTION in_scope(b text) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('app.brands', true), '') IS NULL OR b = ANY(string_to_array(current_setting('app.brands', true), chr(31))) $f$;
CREATE OR REPLACE FUNCTION focal_brand() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT coalesce(nullif(current_setting('app.focal_brand', true), ''), (SELECT brand FROM segments_raw WHERE role = 'focal' ORDER BY id LIMIT 1), (SELECT brand FROM segments_raw ORDER BY id LIMIT 1)) $f$;
CREATE OR REPLACE FUNCTION period_start() RETURNS timestamptz LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('app.period_start', true), '')::timestamptz $f$;
CREATE OR REPLACE FUNCTION period_end() RETURNS timestamptz LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('app.period_end', true), '')::timestamptz $f$;
CREATE VIEW posts_all AS SELECT * FROM posts_raw WHERE in_scope(brand);
CREATE VIEW comments_all AS SELECT * FROM comments_raw WHERE in_scope(brand);
CREATE VIEW influencers AS SELECT * FROM influencers_raw WHERE in_scope(brand);
CREATE VIEW post_themes AS SELECT segment_id, post_id, brand, label AS theme FROM post_labels_raw WHERE kind = 'theme' AND in_scope(brand);
CREATE VIEW post_hooks AS SELECT segment_id, post_id, brand, label AS hook FROM post_labels_raw WHERE kind = 'hook' AND in_scope(brand);
CREATE VIEW segments AS SELECT ${SEGMENT_COLUMNS}, CASE WHEN brand = focal_brand() THEN 'focal' ELSE 'competitor' END AS role FROM segments_raw WHERE in_scope(brand);
CREATE OR REPLACE FUNCTION is_competitor(b text) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT b IS DISTINCT FROM focal_brand() AND EXISTS (SELECT 1 FROM segments s WHERE s.brand = b) $f$;
CREATE OR REPLACE FUNCTION is_self_mention(t text) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT t ILIKE '%' || focal_brand() || '%' OR EXISTS (SELECT 1 FROM segments_raw s, jsonb_array_elements_text(coalesce(s.aliases, '[]'::jsonb)) a WHERE s.brand = focal_brand() AND t ILIKE '%' || a || '%') $f$;
CREATE VIEW posts AS ${PERIOD_FILTER("posts_all")};
CREATE VIEW comments AS ${PERIOD_FILTER("comments_all")};
`;
const VIEWS_VERSION = "scoped-2";

/** Columns added to the raw tables after their first version (run before the views are built). */
const RAW_COLUMNS = `
ALTER TABLE segments_raw DROP COLUMN IF EXISTS brandwatch_query;
ALTER TABLE segments_raw ADD COLUMN IF NOT EXISTS industry text;
ALTER TABLE segments_raw ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE segments_raw ADD COLUMN IF NOT EXISTS owner text;
ALTER TABLE segments_raw ADD COLUMN IF NOT EXISTS kind text;
ALTER TABLE segments_raw ADD COLUMN IF NOT EXISTS aliases jsonb;
ALTER TABLE segments_raw ADD COLUMN IF NOT EXISTS source_posts integer;
`;

/** Idempotent changes applied to databases created by earlier versions. */
const MIGRATIONS = `
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS followups jsonb;
ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS period jsonb;
ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS onboarding jsonb;
ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS scope jsonb;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS usage jsonb;
ALTER TABLE imports ADD COLUMN IF NOT EXISTS influencers_updated integer NOT NULL DEFAULT 0;
ALTER TABLE imports ADD COLUMN IF NOT EXISTS segments_upserted integer NOT NULL DEFAULT 0;
ALTER TABLE imports ADD COLUMN IF NOT EXISTS finished_at timestamptz;
CREATE INDEX IF NOT EXISTS period_events_kind_idx ON period_events (kind, period_start);
CREATE INDEX IF NOT EXISTS imports_received_idx ON imports (received_at DESC);
`;

async function relkind(db: Db, name: string): Promise<string | null> {
  const rows = await db.query<{ relkind: string }>(
    `SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = $1`,
    [name],
  );
  return rows[0]?.relkind ?? null;
}

/** Raw table for each dataset table, with the names earlier versions gave the physical table. */
const RAW_TABLES: Array<[raw: string, earlier: string[]]> = [
  ["posts_raw", ["posts_all", "posts"]],
  ["comments_raw", ["comments_all", "comments"]],
  ["segments_raw", ["segments"]],
  ["influencers_raw", ["influencers"]],
];
const VIEW_NAMES = ["posts", "comments", "posts_all", "comments_all", "segments", "influencers", "post_themes", "post_hooks"];

/**
 * Brings the dataset tables to the current layout and (re)builds the views. Databases created by
 * earlier versions keep their data: the physical table is renamed to its *_raw name. Every step is
 * conditional, so a run that was interrupted is finished by the next one.
 */
async function migrateToScopedViews(db: Db) {
  const meta = await db.query<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'views_version'`);
  let pending = meta[0]?.value !== VIEWS_VERSION;
  for (const [, earlier] of RAW_TABLES) for (const old of earlier) if ((await relkind(db, old)) === "r") pending = true;
  for (const v of VIEW_NAMES) if ((await relkind(db, v)) !== "v") pending = true;
  if (!pending) return;
  for (const v of VIEW_NAMES) if ((await relkind(db, v)) === "v") await db.exec(`DROP VIEW IF EXISTS ${v} CASCADE`);
  for (const [raw, earlier] of RAW_TABLES) {
    for (const old of earlier) {
      if ((await relkind(db, old)) !== "r") continue;
      // DDL just created an empty raw table; the earlier table carries the data and its indexes.
      const [{ n }] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${raw}`);
      if (Number(n) > 0) throw new Error(`Cannot migrate ${old}: ${raw} already holds rows`);
      await db.exec(`DROP TABLE ${raw}`);
      await db.exec(`ALTER TABLE ${old} RENAME TO ${raw}`);
    }
  }
  await db.exec(RAW_COLUMNS);
  await db.exec(SCOPED_VIEWS);
  await db.query(`INSERT INTO app_meta (key, value) VALUES ('views_version', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [VIEWS_VERSION]);
}

const SEED_VERSION = "2026-11-11.1";

function seedDir() {
  return process.env.SEED_DIR ?? path.join(process.cwd(), "data", "seed");
}

function readSeed(name: string): Row[] {
  const file = path.join(seedDir(), `${name}.json.gz`);
  const buf = zlib.gunzipSync(fs.readFileSync(file));
  return JSON.parse(buf.toString("utf8")) as Row[];
}

export const COLUMNS: Record<string, string[]> = {
  segments: ["id","name","brand","role","scan_start_date","insight_headline","insight_framing","insight_assess","insight_act","insight_anticipate","insights_by_platform","comment_insights","total_emv","total_engagement","estimated_impressions","total_unique_influencers","invested_budget_min","invested_budget_max"],
  posts: ["post_id","segment_id","brand","influencer_id","username","platform","post_type","url","title","text","published_at","likes","comments","shares","views","saves","engagement","is_paid","tier","country","language","sentiment","emv","followers","budget_min","budget_max","image_url","video_url"],
  comments: ["comment_id","segment_id","brand","post_id","username","text","likes","reply_count","published_at","sentiment","sentiment_score","emotion","language","topics","keywords","toxicity","spam_rate","moderation","automated_response","authenticity_score","authenticity_flag","purchase_intent_type","purchase_intent_score","purchase_blocker","objection_category","objection_context","objection_phrase","competitor_name","competitor_favored","competitor_mention_type","loyalty_type","loyalty_phrase","repeat_buyer","faq_topic","faq_phrase","feature_request_type","feature_request","safety_complaint_type","safety_severity","crisis_risk_type","crisis_urgency","crisis_phrase","partnership_perception","partnership_intensity","brand_affinity_name","brand_affinity_category","use_case","use_case_segment","caption_relevance"],
  influencers: ["segment_id","brand","influencer_id","username","fullname","network","url","picture","followers","engagements","engagement_rate","avg_views","is_verified","imai_score","country","language","ai_summary","has_report","audience_female","audience_male","audience_ages","audience_countries","audience_credibility","brand_safety_score","avg_comment_sentiment"],
};
const LOGICAL: Record<string, string> = { posts_raw: "posts", comments_raw: "comments", segments_raw: "segments", influencers_raw: "influencers" };
export const JSON_COLUMNS = new Set(["insights_by_platform", "comment_insights", "audience_ages", "audience_countries"]);
export const ARRAY_COLUMNS = new Set(["topics", "keywords"]);

export function toParam(col: string, v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (JSON_COLUMNS.has(col)) return JSON.stringify(v);
  if (ARRAY_COLUMNS.has(col)) return Array.isArray(v) ? v.map(String) : [];
  return v;
}

/** Physical table behind each logical dataset table. */
export const PHYSICAL: Record<string, string> = { posts: "posts_raw", comments: "comments_raw", segments: "segments_raw", influencers: "influencers_raw" };

/** The bundled seed counts as the first import so coverage and period events have a baseline. */
async function recordSeedImport(db: Db) {
  const [{ n }] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM imports`);
  if (Number(n) > 0) return;
  const [{ p }] = await db.query<{ p: number }>(`SELECT count(*)::int AS p FROM posts_raw`);
  if (Number(p) === 0) return;
  const [d] = await db.query<{ from: string | null; to: string | null; posts: number; comments: number; inf: number }>(`
    SELECT least((SELECT min(published_at) FROM posts_raw), (SELECT min(published_at) FROM comments_raw))::date::text AS "from",
           greatest((SELECT max(published_at) FROM posts_raw), (SELECT max(published_at) FROM comments_raw))::date::text AS "to",
           (SELECT count(*)::int FROM posts_raw) AS posts, (SELECT count(*)::int FROM comments_raw) AS comments, (SELECT count(*)::int FROM influencers_raw) AS inf`);
  await db.query(
    `INSERT INTO imports (source, covers_from, covers_to, posts_added, comments_added, influencers_added, notes) VALUES ('seed', $1, $2, $3, $4, $5, 'Bundled dataset')`,
    [d.from, d.to, d.posts, d.comments, d.inf],
  );
}

export async function insertRows(db: Db, table: string, rows: Row[], batch: number, log: (m: string) => void) {
  const cols = COLUMNS[LOGICAL[table] ?? table];
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
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
    await db.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${values} ON CONFLICT DO NOTHING`, params);
    if ((i / batch) % 20 === 0) log(`${table}: ${Math.min(i + batch, rows.length)}/${rows.length}`);
  }
}

export async function seedDatabase(db: Db, log: (m: string) => void = () => {}) {
  await db.exec(DDL);
  await migrateToScopedViews(db);
  for (const table of ["segments", "posts", "comments", "influencers"]) {
    const physical = PHYSICAL[table] ?? table;
    const [{ n }] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${physical}`);
    if (Number(n) > 0) {
      log(`${table}: already has ${n} rows, skipping`);
      continue;
    }
    const rows = readSeed(table);
    log(`${table}: inserting ${rows.length} rows`);
    await insertRows(db, physical, rows, table === "comments" ? 250 : 200, log);
  }
  await recordSeedImport(db);
  await db.query(
    `INSERT INTO app_meta (key, value) VALUES ('seed_version', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [SEED_VERSION],
  );
}

const g = globalThis as unknown as { __siReady?: Promise<void>; __siPacks?: Promise<void>; __siPacksDone?: boolean };

async function prepare() {
  const db = await getDb();
  await db.exec(DDL);
  await migrateToScopedViews(db);
  await db.exec(MIGRATIONS);
  const rows = await db.query<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'seed_version'`);
  if (rows[0]?.value !== SEED_VERSION) {
    await seedDatabase(db, (m) => console.log("[seed]", m));
  }
  await recordSeedImport(db);
  await syncCatalog(db);
  // Every account starts with a token allowance (see usage.ts).
  const starting = Number(process.env.STARTING_TOKENS ?? 1_000_000) || 1_000_000;
  await db.query(
    `INSERT INTO token_ledger (kind, tokens, note, balance_after) SELECT 'grant', $1::bigint, 'Starting allowance', $1::bigint WHERE NOT EXISTS (SELECT 1 FROM token_ledger)`,
    [starting],
  );
  await loadCatalog(db);
}

/**
 * The industry packs load after the base dataset, a few seconds at a time, so the first requests
 * after a deploy are not held for the whole load. Each call continues where the last one stopped.
 */
function ensurePacks(): Promise<void> {
  if (g.__siPacksDone) return Promise.resolve();
  if (!g.__siPacks) {
    g.__siPacks = (async () => {
      const db = await getDb();
      const { pending, loaded } = await loadPacks(db, Number(process.env.PACK_LOAD_BUDGET_MS ?? 6000) || 6000, (m) => console.log("[packs]", m));
      if (loaded) await loadCatalog(db);
      // Themes and hooks are assigned once the posts are in, in the same resumable way.
      const labels = pending ? { pending: 1 } : await classifyPosts(db, Number(process.env.PACK_LOAD_BUDGET_MS ?? 6000) || 6000, (m) => console.log("[themes]", m));
      if (!pending && !labels.pending) g.__siPacksDone = true;
    })()
      .catch((err) => console.error("[packs] load failed:", (err as Error).message))
      .finally(() => {
        g.__siPacks = undefined;
      });
  }
  return g.__siPacks;
}

/** Ensures tables exist and the dataset is loaded. The base setup runs once per process. */
export function ensureReady(): Promise<void> {
  if (!g.__siReady) {
    g.__siReady = prepare().catch(async () => {
      // Two instances starting at once can collide on a migration step; every step is idempotent, so try once more.
      await new Promise((r) => setTimeout(r, 1500));
      return prepare();
    }).catch((err) => {
      g.__siReady = undefined;
      throw err;
    });
  }
  return g.__siReady.then(ensurePacks);
}
