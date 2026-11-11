import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { Db, Row } from "./db";
import { getDb } from "./db";

/** Tables holding the preloaded social-listening dataset plus app state. */
export const DDL = `
CREATE TABLE IF NOT EXISTS segments (
  id integer PRIMARY KEY,
  name text, brand text, role text, brandwatch_query text, scan_start_date timestamptz,
  insight_headline text, insight_framing text, insight_assess text, insight_act text, insight_anticipate text,
  insights_by_platform jsonb, comment_insights jsonb,
  total_emv double precision, total_engagement double precision, estimated_impressions double precision,
  total_unique_influencers double precision, invested_budget_min double precision, invested_budget_max double precision
);
CREATE TABLE IF NOT EXISTS posts (
  post_id bigint, segment_id integer, brand text, influencer_id bigint, username text,
  platform text, post_type text, url text, title text, text text, published_at timestamptz,
  likes double precision, comments double precision, shares double precision, views double precision, saves double precision,
  engagement double precision, is_paid boolean, tier text, country text, language text, sentiment text,
  emv double precision, followers double precision, budget_min double precision, budget_max double precision,
  image_url text, video_url text,
  PRIMARY KEY (segment_id, post_id)
);
CREATE TABLE IF NOT EXISTS comments (
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
CREATE INDEX IF NOT EXISTS posts_brand_idx ON posts (brand);
CREATE INDEX IF NOT EXISTS posts_published_idx ON posts (published_at);
CREATE INDEX IF NOT EXISTS comments_brand_idx ON comments (brand);
CREATE INDEX IF NOT EXISTS comments_post_idx ON comments (post_id);
CREATE INDEX IF NOT EXISTS comments_published_idx ON comments (published_at);

CREATE TABLE IF NOT EXISTS dashboards (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  widgets jsonb NOT NULL DEFAULT '[]'::jsonb,
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
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_dash_idx ON chat_messages (dashboard_id, id);
CREATE TABLE IF NOT EXISTS app_meta (key text PRIMARY KEY, value text);
`;

const SEED_VERSION = "2026-11-11.1";

function seedDir() {
  return process.env.SEED_DIR ?? path.join(process.cwd(), "data", "seed");
}

function readSeed(name: string): Row[] {
  const file = path.join(seedDir(), `${name}.json.gz`);
  const buf = zlib.gunzipSync(fs.readFileSync(file));
  return JSON.parse(buf.toString("utf8")) as Row[];
}

const COLUMNS: Record<string, string[]> = {
  segments: ["id","name","brand","role","brandwatch_query","scan_start_date","insight_headline","insight_framing","insight_assess","insight_act","insight_anticipate","insights_by_platform","comment_insights","total_emv","total_engagement","estimated_impressions","total_unique_influencers","invested_budget_min","invested_budget_max"],
  posts: ["post_id","segment_id","brand","influencer_id","username","platform","post_type","url","title","text","published_at","likes","comments","shares","views","saves","engagement","is_paid","tier","country","language","sentiment","emv","followers","budget_min","budget_max","image_url","video_url"],
  comments: ["comment_id","segment_id","brand","post_id","username","text","likes","reply_count","published_at","sentiment","sentiment_score","emotion","language","topics","keywords","toxicity","spam_rate","moderation","automated_response","authenticity_score","authenticity_flag","purchase_intent_type","purchase_intent_score","purchase_blocker","objection_category","objection_context","objection_phrase","competitor_name","competitor_favored","competitor_mention_type","loyalty_type","loyalty_phrase","repeat_buyer","faq_topic","faq_phrase","feature_request_type","feature_request","safety_complaint_type","safety_severity","crisis_risk_type","crisis_urgency","crisis_phrase","partnership_perception","partnership_intensity","brand_affinity_name","brand_affinity_category","use_case","use_case_segment","caption_relevance"],
  influencers: ["segment_id","brand","influencer_id","username","fullname","network","url","picture","followers","engagements","engagement_rate","avg_views","is_verified","imai_score","country","language","ai_summary","has_report","audience_female","audience_male","audience_ages","audience_countries","audience_credibility","brand_safety_score","avg_comment_sentiment"],
};
const JSON_COLUMNS = new Set(["insights_by_platform", "comment_insights", "audience_ages", "audience_countries"]);
const ARRAY_COLUMNS = new Set(["topics", "keywords"]);

function toParam(col: string, v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (JSON_COLUMNS.has(col)) return JSON.stringify(v);
  if (ARRAY_COLUMNS.has(col)) return Array.isArray(v) ? v.map(String) : [];
  return v;
}

async function insertRows(db: Db, table: string, rows: Row[], batch: number, log: (m: string) => void) {
  const cols = COLUMNS[table];
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
  for (const table of ["segments", "posts", "comments", "influencers"]) {
    const [{ n }] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
    if (Number(n) > 0) {
      log(`${table}: already has ${n} rows, skipping`);
      continue;
    }
    const rows = readSeed(table);
    log(`${table}: inserting ${rows.length} rows`);
    await insertRows(db, table, rows, table === "comments" ? 250 : 200, log);
  }
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
      const rows = await db.query<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'seed_version'`);
      if (rows[0]?.value !== SEED_VERSION) {
        await seedDatabase(db, (m) => console.log("[seed]", m));
      }
    })().catch((err) => {
      g.__siReady = undefined;
      throw err;
    });
  }
  return g.__siReady;
}
