import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { Db, Row } from "./db";
import { getDb } from "./db";

/** Tables holding the preloaded social-listening dataset plus app state. */
export const DDL = `
CREATE TABLE IF NOT EXISTS segments (
  id integer PRIMARY KEY,
  name text, brand text, role text, scan_start_date timestamptz,
  insight_headline text, insight_framing text, insight_assess text, insight_act text, insight_anticipate text,
  insights_by_platform jsonb, comment_insights jsonb,
  total_emv double precision, total_engagement double precision, estimated_impressions double precision,
  total_unique_influencers double precision, invested_budget_min double precision, invested_budget_max double precision
);
CREATE TABLE IF NOT EXISTS posts_all (
  post_id bigint, segment_id integer, brand text, influencer_id bigint, username text,
  platform text, post_type text, url text, title text, text text, published_at timestamptz,
  likes double precision, comments double precision, shares double precision, views double precision, saves double precision,
  engagement double precision, is_paid boolean, tier text, country text, language text, sentiment text,
  emv double precision, followers double precision, budget_min double precision, budget_max double precision,
  image_url text, video_url text,
  PRIMARY KEY (segment_id, post_id)
);
CREATE TABLE IF NOT EXISTS comments_all (
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
CREATE TABLE IF NOT EXISTS influencers (
  segment_id integer, brand text, influencer_id bigint, username text, fullname text, network text, url text, picture text,
  followers double precision, engagements double precision, engagement_rate double precision, avg_views double precision,
  is_verified boolean, imai_score double precision, country text, language text, ai_summary text, has_report boolean,
  audience_female double precision, audience_male double precision, audience_ages jsonb, audience_countries jsonb,
  audience_credibility double precision, brand_safety_score double precision, avg_comment_sentiment double precision,
  PRIMARY KEY (segment_id, influencer_id)
);
CREATE INDEX IF NOT EXISTS posts_brand_idx ON posts_all (brand);
CREATE INDEX IF NOT EXISTS posts_published_idx ON posts_all (published_at);
CREATE INDEX IF NOT EXISTS comments_brand_idx ON comments_all (brand);
CREATE INDEX IF NOT EXISTS comments_post_idx ON comments_all (post_id);
CREATE INDEX IF NOT EXISTS comments_published_idx ON comments_all (published_at);

CREATE TABLE IF NOT EXISTS dashboards (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  widgets jsonb NOT NULL DEFAULT '[]'::jsonb,
  period jsonb,
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
 * posts and comments are views over the physical tables, filtered by two transaction-local
 * settings (app.period_start, app.period_end). With no setting the views return everything, so
 * every saved query is period-aware without being rewritten. Queries that need to look outside
 * the current period use posts_all and comments_all.
 */
export const PERIOD_VIEWS = `
CREATE OR REPLACE FUNCTION period_start() RETURNS timestamptz LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('app.period_start', true), '')::timestamptz $f$;
CREATE OR REPLACE FUNCTION period_end() RETURNS timestamptz LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('app.period_end', true), '')::timestamptz $f$;
CREATE OR REPLACE VIEW posts AS
  SELECT * FROM posts_all
  WHERE (published_at >= coalesce(nullif(current_setting('app.period_start', true), '')::timestamptz, '-infinity'::timestamptz)
     AND published_at <  coalesce(nullif(current_setting('app.period_end', true), '')::timestamptz, 'infinity'::timestamptz))
     OR (published_at IS NULL AND nullif(current_setting('app.period_start', true), '') IS NULL AND nullif(current_setting('app.period_end', true), '') IS NULL);
CREATE OR REPLACE VIEW comments AS
  SELECT * FROM comments_all
  WHERE (published_at >= coalesce(nullif(current_setting('app.period_start', true), '')::timestamptz, '-infinity'::timestamptz)
     AND published_at <  coalesce(nullif(current_setting('app.period_end', true), '')::timestamptz, 'infinity'::timestamptz))
     OR (published_at IS NULL AND nullif(current_setting('app.period_start', true), '') IS NULL AND nullif(current_setting('app.period_end', true), '') IS NULL);
`;

/** Idempotent changes applied to databases created by earlier versions. */
const MIGRATIONS = `
ALTER TABLE segments DROP COLUMN IF EXISTS brandwatch_query;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS followups jsonb;
ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS period jsonb;
`;

/** Databases created before the period views have physical tables named posts and comments: rename them. */
async function migrateToPeriodViews(db: Db) {
  for (const t of ["posts", "comments"]) {
    const rows = await db.query<{ relkind: string }>(
      `SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = $1`,
      [t],
    );
    if (rows[0]?.relkind !== "r") continue;
    // DDL just created an empty <t>_all; the old table carries the data and its indexes.
    await db.exec(`DROP TABLE IF EXISTS ${t}_all`);
    await db.exec(`ALTER TABLE ${t} RENAME TO ${t}_all`);
  }
  await db.exec(PERIOD_VIEWS);
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
const LOGICAL: Record<string, string> = { posts_all: "posts", comments_all: "comments" };
export const JSON_COLUMNS = new Set(["insights_by_platform", "comment_insights", "audience_ages", "audience_countries"]);
export const ARRAY_COLUMNS = new Set(["topics", "keywords"]);

export function toParam(col: string, v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (JSON_COLUMNS.has(col)) return JSON.stringify(v);
  if (ARRAY_COLUMNS.has(col)) return Array.isArray(v) ? v.map(String) : [];
  return v;
}

/** Physical table behind each logical dataset table. */
export const PHYSICAL: Record<string, string> = { posts: "posts_all", comments: "comments_all" };

/** The bundled seed counts as the first import so coverage and period events have a baseline. */
async function recordSeedImport(db: Db) {
  const [{ n }] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM imports`);
  if (Number(n) > 0) return;
  const [{ p }] = await db.query<{ p: number }>(`SELECT count(*)::int AS p FROM posts_all`);
  if (Number(p) === 0) return;
  const [d] = await db.query<{ from: string | null; to: string | null; posts: number; comments: number; inf: number }>(`
    SELECT least((SELECT min(published_at) FROM posts_all), (SELECT min(published_at) FROM comments_all))::date::text AS "from",
           greatest((SELECT max(published_at) FROM posts_all), (SELECT max(published_at) FROM comments_all))::date::text AS "to",
           (SELECT count(*)::int FROM posts_all) AS posts, (SELECT count(*)::int FROM comments_all) AS comments, (SELECT count(*)::int FROM influencers) AS inf`);
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
  await db.exec(PERIOD_VIEWS);
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

const g = globalThis as unknown as { __siReady?: Promise<void> };

/** Ensures tables exist and the dataset is loaded. Runs once per process. */
export function ensureReady(): Promise<void> {
  if (!g.__siReady) {
    g.__siReady = (async () => {
      const db = await getDb();
      await db.exec(DDL);
      await db.exec(MIGRATIONS);
      await migrateToPeriodViews(db);
      const rows = await db.query<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'seed_version'`);
      if (rows[0]?.value !== SEED_VERSION) {
        await seedDatabase(db, (m) => console.log("[seed]", m));
      }
      await recordSeedImport(db);
    })().catch((err) => {
      g.__siReady = undefined;
      throw err;
    });
  }
  return g.__siReady;
}
