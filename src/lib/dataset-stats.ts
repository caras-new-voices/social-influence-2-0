import { getDb, type Row } from "./db";
import { ensureReady } from "./schema";

export const ANALYSIS_FIELDS: Array<{ col: string; label: string; kind: "label" | "free" }> = [
  { col: "sentiment", label: "Sentiment", kind: "label" },
  { col: "emotion", label: "Emotion", kind: "label" },
  { col: "purchase_intent_type", label: "Purchase intent", kind: "label" },
  { col: "objection_category", label: "Objection", kind: "label" },
  { col: "competitor_favored", label: "Competitor mention (who is favoured)", kind: "label" },
  { col: "loyalty_type", label: "Loyalty signal", kind: "label" },
  { col: "faq_topic", label: "Unanswered question (FAQ gap)", kind: "free" },
  { col: "feature_request_type", label: "Feature request", kind: "label" },
  { col: "safety_complaint_type", label: "Safety complaint", kind: "free" },
  { col: "crisis_risk_type", label: "Backlash flag", kind: "free" },
  { col: "partnership_perception", label: "Partnership perception", kind: "label" },
  { col: "brand_affinity_name", label: "Brand affinity", kind: "free" },
  { col: "use_case_segment", label: "Use case", kind: "free" },
  { col: "moderation", label: "Moderation flag", kind: "label" },
];

export interface DatasetStats {
  counts: { posts: number; comments: number; influencers: number; segments: number; creators: number };
  dates: { firstPost: string; lastPost: string; firstComment: string; lastComment: string; exported: string };
  platforms: Array<{ platform: string; posts: number; video: number; image: number; comments: number }>;
  brands: Array<{
    brand: string; role: string; posts: number; creators: number; comments: number; tiktok: number; instagram: number; youtube: number;
    first: string; last: string;
  }>;
  monthly: Array<{ month: string; posts: number; comments: number }>;
  tiers: Array<{ tier: string; posts: number; creators: number; minFollowers: number; maxFollowers: number }>;
  countries: Array<{ country: string; posts: number }>;
  languages: { posts: Array<{ language: string; n: number }>; comments: Array<{ language: string; n: number }> };
  commentsPerPost: Array<{ bucket: string; posts: number }>;
  analysis: Array<{ col: string; label: string; kind: "label" | "free"; filled: number; values: Array<{ value: string; n: number }>; distinct: number; example: { text: string; value: string; brand: string } | null }>;
  segmentOutputs: Array<{ brand: string; insightFields: string[]; platforms: string[]; commentPayloadKeys: string[]; model: string | null }>;
  samples: { posts: Row[]; comments: Row[] };
  caveats: { viewsFilled: number; languageKnown: number; audienceCoverage: number; reportCoverage: number; smallBrands: Array<{ brand: string; posts: number }>; crossSegmentPosts: number };
}

const CACHE_MS = 10 * 60 * 1000;
const g = globalThis as unknown as { __siStats?: { at: number; value: Promise<DatasetStats> } };

/** The dataset is static, so the page statistics are memoised per server instance. */
export function getDatasetStats(): Promise<DatasetStats> {
  const now = Date.now();
  if (!g.__siStats || now - g.__siStats.at > CACHE_MS) {
    const value = computeDatasetStats().catch((err) => {
      g.__siStats = undefined;
      throw err;
    });
    g.__siStats = { at: now, value };
  }
  return g.__siStats.value;
}

async function computeDatasetStats(): Promise<DatasetStats> {
  await ensureReady();
  const db = await getDb();
  const q = <T extends Row = Row>(sql: string) => db.query<T>(sql);

  const [c] = await q<{ posts: number; comments: number; influencers: number; segments: number; creators: number }>(`
    SELECT (SELECT count(*)::int FROM posts_all) AS posts, (SELECT count(*)::int FROM comments_all) AS comments,
           (SELECT count(*)::int FROM influencers) AS influencers, (SELECT count(*)::int FROM segments) AS segments,
           (SELECT count(DISTINCT influencer_id)::int FROM influencers) AS creators`);
  const [d] = await q<{ fp: string; lp: string; fc: string; lc: string }>(`
    SELECT (SELECT min(published_at) FROM posts_all) AS fp, (SELECT max(published_at) FROM posts_all) AS lp,
           (SELECT min(published_at) FROM comments_all) AS fc, (SELECT max(published_at) FROM comments_all) AS lc`);

  const platforms = await q<DatasetStats["platforms"][number]>(`
    SELECT p.platform, count(*)::int AS posts, count(*) FILTER (WHERE post_type='video')::int AS video, count(*) FILTER (WHERE post_type='image')::int AS image,
           (SELECT count(*)::int FROM comments_all c JOIN posts_all p2 ON p2.post_id=c.post_id AND p2.segment_id=c.segment_id WHERE p2.platform=p.platform) AS comments
    FROM posts_all p GROUP BY 1 ORDER BY 2 DESC`);

  const brands = await q<DatasetStats["brands"][number]>(`
    SELECT s.brand, s.role, count(p.post_id)::int AS posts, count(DISTINCT p.influencer_id)::int AS creators,
           (SELECT count(*)::int FROM comments_all c WHERE c.segment_id = s.id) AS comments,
           count(*) FILTER (WHERE p.platform='tiktok')::int AS tiktok, count(*) FILTER (WHERE p.platform='instagram')::int AS instagram, count(*) FILTER (WHERE p.platform='youtube')::int AS youtube,
           min(p.published_at) AS first, max(p.published_at) AS last
    FROM segments s LEFT JOIN posts_all p ON p.segment_id = s.id GROUP BY s.id, s.brand, s.role ORDER BY posts DESC`);

  const monthly = await q<DatasetStats["monthly"][number]>(`
    SELECT m.month, coalesce(p.n, 0)::int AS posts, coalesce(c.n, 0)::int AS comments FROM
      (SELECT DISTINCT to_char(date_trunc('month', published_at), 'YYYY-MM') AS month FROM posts_all WHERE published_at IS NOT NULL
       UNION SELECT DISTINCT to_char(date_trunc('month', published_at), 'YYYY-MM') FROM comments_all WHERE published_at IS NOT NULL) m
      LEFT JOIN (SELECT to_char(date_trunc('month', published_at), 'YYYY-MM') AS month, count(*) AS n FROM posts_all GROUP BY 1) p ON p.month = m.month
      LEFT JOIN (SELECT to_char(date_trunc('month', published_at), 'YYYY-MM') AS month, count(*) AS n FROM comments_all GROUP BY 1) c ON c.month = m.month
    ORDER BY 1`);

  const tiers = await q<DatasetStats["tiers"][number]>(`
    SELECT tier, count(*)::int AS posts, count(DISTINCT influencer_id)::int AS creators, min(followers) AS "minFollowers", max(followers) AS "maxFollowers"
    FROM posts_all WHERE tier IS NOT NULL AND followers > 0 GROUP BY 1
    ORDER BY array_position(ARRAY['nano','micro','mid','macro','mega'], tier)`);

  const countries = await q<DatasetStats["countries"][number]>(`SELECT country, count(*)::int AS posts FROM posts_all WHERE country IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);
  const postLang = await q<{ language: string; n: number }>(`SELECT coalesce(language,'unknown') AS language, count(*)::int AS n FROM posts_all GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);
  const commentLang = await q<{ language: string; n: number }>(`SELECT coalesce(language,'unknown') AS language, count(*)::int AS n FROM comments_all GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);

  const commentsPerPost = await q<DatasetStats["commentsPerPost"][number]>(`
    SELECT bucket, count(*)::int AS posts FROM (
      SELECT CASE WHEN n = 0 THEN '0' WHEN n <= 5 THEN '1 to 5' WHEN n <= 20 THEN '6 to 20' WHEN n <= 100 THEN '21 to 100' ELSE 'over 100' END AS bucket,
             CASE WHEN n = 0 THEN 0 WHEN n <= 5 THEN 1 WHEN n <= 20 THEN 2 WHEN n <= 100 THEN 3 ELSE 4 END AS ord
      FROM (SELECT p.post_id, p.segment_id, (SELECT count(*) FROM comments_all c WHERE c.post_id = p.post_id AND c.segment_id = p.segment_id) AS n FROM posts_all p) t
    ) b GROUP BY bucket, ord ORDER BY ord`);

  const analysis: DatasetStats["analysis"] = [];
  for (const f of ANALYSIS_FIELDS) {
    const [agg] = await q<{ filled: number; distinct: number }>(`SELECT count(${f.col})::int AS filled, count(DISTINCT ${f.col})::int AS distinct FROM comments_all`);
    const values = await q<{ value: string; n: number }>(`SELECT ${f.col} AS value, count(*)::int AS n FROM comments_all WHERE ${f.col} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT ${f.kind === "label" ? 10 : 8}`);
    const [ex] = await q<{ text: string; value: string; brand: string }>(`
      SELECT left(text, 200) AS text, ${f.col} AS value, brand FROM comments_all
      WHERE ${f.col} IS NOT NULL AND length(text) BETWEEN 25 AND 180 AND language = 'en'
      ORDER BY likes DESC NULLS LAST LIMIT 1`);
    analysis.push({ ...f, filled: Number(agg.filled), distinct: Number(agg.distinct), values, example: ex ?? null });
  }

  const segRows = await q<{ brand: string; insights_by_platform: unknown; comment_insights: unknown; has_headline: boolean; has_assess: boolean; has_act: boolean; has_anticipate: boolean }>(`
    SELECT brand, insights_by_platform, comment_insights, insight_headline IS NOT NULL AS has_headline, insight_assess IS NOT NULL AS has_assess,
           insight_act IS NOT NULL AS has_act, insight_anticipate IS NOT NULL AS has_anticipate FROM segments ORDER BY brand`);
  const segmentOutputs = segRows.map((r) => {
    const ibp = (typeof r.insights_by_platform === "string" ? JSON.parse(r.insights_by_platform) : r.insights_by_platform) as Record<string, unknown> | null;
    const ci = (typeof r.comment_insights === "string" ? JSON.parse(r.comment_insights) : r.comment_insights) as Record<string, { model?: string; payload?: Record<string, unknown> }> | null;
    const firstPlat = ci ? Object.values(ci)[0] : undefined;
    return {
      brand: r.brand,
      insightFields: ["headline", "assess", "act", "anticipate"].filter((k, i) => [r.has_headline, r.has_assess, r.has_act, r.has_anticipate][i]),
      platforms: ibp ? Object.keys(ibp) : [],
      commentPayloadKeys: firstPlat?.payload ? Object.keys(firstPlat.payload) : [],
      model: firstPlat?.model ?? null,
    };
  });

  const samplePosts = await q(`SELECT post_id, brand, platform, post_type, username, left(text, 140) AS text, published_at, likes, comments, shares, views, saves, engagement, is_paid, tier, country, language, sentiment, emv, followers FROM posts_all WHERE text IS NOT NULL AND length(text) > 40 ORDER BY post_id LIMIT 3`);
  const sampleComments = await q(`SELECT comment_id, brand, post_id, left(text, 140) AS text, likes, published_at, sentiment, sentiment_score, emotion, language, topics, purchase_intent_type, objection_category, competitor_name, loyalty_type FROM comments_all WHERE language = 'en' AND length(text) > 30 AND (purchase_intent_type IS NOT NULL OR objection_category IS NOT NULL OR loyalty_type IS NOT NULL) ORDER BY comment_id LIMIT 3`);

  const smallBrands = (await q<{ brand: string; posts: number }>(`SELECT brand, count(*)::int AS posts FROM posts_all GROUP BY 1 HAVING count(*) < 50 ORDER BY 2`)).map((r) => ({ brand: r.brand, posts: Number(r.posts) }));
  const [cav] = await q<{ views: number; lang: number; aud: number; rep: number; cross: number }>(`
    SELECT (SELECT count(views)::int FROM posts_all) AS views, (SELECT count(*)::int FROM posts_all WHERE language IS NOT NULL AND language <> 'unknown') AS lang,
           (SELECT count(audience_female)::int FROM influencers) AS aud, (SELECT count(*)::int FROM influencers WHERE has_report) AS rep,
           (SELECT count(*)::int FROM (SELECT post_id FROM posts_all GROUP BY post_id HAVING count(*) > 1) x) AS cross`);

  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : "");
  return {
    counts: { posts: Number(c.posts), comments: Number(c.comments), influencers: Number(c.influencers), segments: Number(c.segments), creators: Number(c.creators) },
    dates: { firstPost: iso(d.fp), lastPost: iso(d.lp), firstComment: iso(d.fc), lastComment: iso(d.lc), exported: "2026-09-07" },
    platforms,
    brands: brands.map((b) => ({ ...b, first: iso(b.first), last: iso(b.last) })),
    monthly,
    tiers,
    countries,
    languages: { posts: postLang, comments: commentLang },
    commentsPerPost,
    analysis,
    segmentOutputs,
    samples: { posts: samplePosts, comments: sampleComments },
    caveats: { viewsFilled: Number(cav.views), languageKnown: Number(cav.lang), audienceCoverage: Number(cav.aud), reportCoverage: Number(cav.rep), smallBrands, crossSegmentPosts: Number(cav.cross) },
  };
}
