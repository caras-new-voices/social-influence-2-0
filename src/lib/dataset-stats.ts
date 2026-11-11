import { getDb, type Row } from "./db";
import { COLUMNS, ensureReady } from "./schema";

/** Short, non-interpretive definitions shown on the Dataset page. */
export const FIELD_DOCS: Record<string, Record<string, string>> = {
  posts: {
    post_id: "Post identifier from the listening platform",
    segment_id: "Brand segment the post was collected for",
    brand: "Brand name of the segment",
    influencer_id: "Creator identifier",
    username: "Creator handle",
    platform: "tiktok, instagram or youtube",
    post_type: "video or image",
    url: "Link to the post",
    title: "Post title (YouTube mostly)",
    text: "Caption text",
    published_at: "Publication timestamp",
    likes: "Like count at collection time",
    comments: "Comment count at collection time",
    shares: "Share count",
    views: "View or play count",
    saves: "Save count",
    engagement: "likes + comments + shares + saves",
    is_paid: "Paid or sponsored disclosure detected",
    tier: "Creator size band by followers: nano, micro, mid, macro, mega",
    country: "Creator country",
    language: "Detected caption language (ISO code)",
    sentiment: "Post sentiment: positive, neutral, negative",
    emv: "Earned media value estimate, USD",
    followers: "Creator followers at collection time",
    budget_min: "Estimated creator fee, low end, USD",
    budget_max: "Estimated creator fee, high end, USD",
    image_url: "Thumbnail",
    video_url: "Video file link",
  },
  comments: {
    comment_id: "Comment identifier",
    segment_id: "Brand segment of the post",
    brand: "Brand of the post the comment is on",
    post_id: "Post the comment belongs to",
    username: "Commenter handle",
    text: "Comment text",
    likes: "Comment likes",
    reply_count: "Replies to the comment",
    published_at: "Comment timestamp",
    sentiment: "AI label: positive, neutral, negative",
    sentiment_score: "AI score 0 to 1",
    emotion: "AI label: happy, surprised, sad, angry, disgusted, fearful, other",
    language: "Detected comment language",
    topics: "AI free-form topic tags",
    keywords: "AI extracted keywords",
    toxicity: "AI toxicity score 0 to 1",
    spam_rate: "AI spam likelihood 0 to 1",
    moderation: "AI moderation flag: spam, sexual, hate, violence, other",
    automated_response: "Looks like a bot reply",
    authenticity_score: "AI engagement authenticity 0 to 1",
    authenticity_flag: "Reason when authenticity is low",
    purchase_intent_type: "AI label: explicit, aspirational, conditional",
    purchase_intent_score: "AI intent strength 0 to 1",
    purchase_blocker: "AI free text: what stops the purchase",
    objection_category: "AI label: quality, price, shipping_availability, trust_credibility, comparison_based, ethics, ingredients_composition, fit_sizing",
    objection_context: "AI free text: product context of the objection",
    objection_phrase: "Verbatim objection",
    competitor_name: "Other brand named in the comment",
    competitor_favored: "AI label: competitor, focal_brand, neither, unclear",
    competitor_mention_type: "AI label: preference, comparison, rhetorical_putdown",
    loyalty_type: "AI label: advocacy, long_term_use, repeat_buyer, other",
    loyalty_phrase: "Verbatim loyalty statement",
    repeat_buyer: "Repeat purchase mentioned",
    faq_topic: "AI free text: topic of an unanswered question",
    faq_phrase: "Verbatim question",
    feature_request_type: "AI label: variant, feature, color, format, size, modification, other",
    feature_request: "Verbatim request",
    safety_complaint_type: "AI free text: type of safety complaint",
    safety_severity: "AI label: low, med, high",
    crisis_risk_type: "AI free text: backlash risk type",
    crisis_urgency: "AI label: low, med, high",
    crisis_phrase: "Verbatim backlash phrase",
    partnership_perception: "AI label: how the sponsorship is perceived",
    partnership_intensity: "AI label: low, med, high",
    brand_affinity_name: "Other brand the commenter expresses affinity for",
    brand_affinity_category: "Category of that brand",
    use_case: "AI free text: non-standard product use described",
    use_case_segment: "AI free text: audience segment implied by the use case",
    caption_relevance: "AI score: how much the comment relates to the caption",
  },
  influencers: {
    segment_id: "Brand segment the creator was collected for",
    brand: "Brand name",
    influencer_id: "Creator identifier",
    username: "Handle",
    fullname: "Display name",
    network: "tiktok, instagram or youtube",
    url: "Profile link",
    picture: "Avatar",
    followers: "Followers",
    engagements: "Average engagements per post",
    engagement_rate: "Engagements divided by followers",
    avg_views: "Average views per post",
    is_verified: "Verified badge",
    imai_score: "IMAI quality score 0 to 100",
    country: "Creator country from the profile report",
    language: "Creator language from the profile report",
    ai_summary: "Short profile summary from the report",
    has_report: "A full audience report exists",
    audience_female: "Female share of audience (from report)",
    audience_male: "Male share of audience (from report)",
    audience_ages: "Audience age bands with shares (from report)",
    audience_countries: "Top audience countries with shares (from report)",
    audience_credibility: "Audience credibility score (from report)",
    brand_safety_score: "Brand safety score 0 to 100 (from report)",
    avg_comment_sentiment: "Average sentiment of the creator's comments (from report)",
  },
};

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
    first: string; last: string; query: string | null;
  }>;
  fill: Record<string, Array<{ col: string; filled: number; total: number; doc: string }>>;
  monthly: Array<{ month: string; posts: number; comments: number }>;
  tiers: Array<{ tier: string; posts: number; creators: number; minFollowers: number; maxFollowers: number }>;
  countries: Array<{ country: string; posts: number }>;
  languages: { posts: Array<{ language: string; n: number }>; comments: Array<{ language: string; n: number }> };
  commentsPerPost: Array<{ bucket: string; posts: number }>;
  analysis: Array<{ col: string; label: string; kind: "label" | "free"; filled: number; values: Array<{ value: string; n: number }>; distinct: number; example: { text: string; value: string; brand: string } | null }>;
  segmentOutputs: Array<{ brand: string; insightFields: string[]; platforms: string[]; commentPayloadKeys: string[]; model: string | null }>;
  samples: { posts: Row[]; comments: Row[] };
  caveats: { viewsFilled: number; languageKnown: number; audienceCoverage: number; reportCoverage: number; mercadonaPosts: number; crossSegmentPosts: number };
}

const TABLE_NAMES = ["posts", "comments", "influencers"] as const;

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
    SELECT (SELECT count(*)::int FROM posts) AS posts, (SELECT count(*)::int FROM comments) AS comments,
           (SELECT count(*)::int FROM influencers) AS influencers, (SELECT count(*)::int FROM segments) AS segments,
           (SELECT count(DISTINCT influencer_id)::int FROM influencers) AS creators`);
  const [d] = await q<{ fp: string; lp: string; fc: string; lc: string }>(`
    SELECT (SELECT min(published_at) FROM posts) AS fp, (SELECT max(published_at) FROM posts) AS lp,
           (SELECT min(published_at) FROM comments) AS fc, (SELECT max(published_at) FROM comments) AS lc`);

  const platforms = await q<DatasetStats["platforms"][number]>(`
    SELECT p.platform, count(*)::int AS posts, count(*) FILTER (WHERE post_type='video')::int AS video, count(*) FILTER (WHERE post_type='image')::int AS image,
           (SELECT count(*)::int FROM comments c JOIN posts p2 ON p2.post_id=c.post_id AND p2.segment_id=c.segment_id WHERE p2.platform=p.platform) AS comments
    FROM posts p GROUP BY 1 ORDER BY 2 DESC`);

  const brands = await q<DatasetStats["brands"][number]>(`
    SELECT s.brand, s.role, count(p.post_id)::int AS posts, count(DISTINCT p.influencer_id)::int AS creators,
           (SELECT count(*)::int FROM comments c WHERE c.segment_id = s.id) AS comments,
           count(*) FILTER (WHERE p.platform='tiktok')::int AS tiktok, count(*) FILTER (WHERE p.platform='instagram')::int AS instagram, count(*) FILTER (WHERE p.platform='youtube')::int AS youtube,
           min(p.published_at) AS first, max(p.published_at) AS last, s.brandwatch_query AS query
    FROM segments s LEFT JOIN posts p ON p.segment_id = s.id GROUP BY s.id, s.brand, s.role, s.brandwatch_query ORDER BY posts DESC`);

  const fill: DatasetStats["fill"] = {};
  for (const t of TABLE_NAMES) {
    const cols = COLUMNS[t];
    const sel = cols.map((col) => `count(${col})::int AS "${col}"`).join(", ");
    const [row] = await q(`SELECT count(*)::int AS __total, ${sel} FROM ${t}`);
    const total = Number(row.__total);
    fill[t] = cols.map((col) => ({ col, filled: Number(row[col]), total, doc: FIELD_DOCS[t]?.[col] ?? "" }));
  }

  const monthly = await q<DatasetStats["monthly"][number]>(`
    SELECT m.month, coalesce(p.n, 0)::int AS posts, coalesce(c.n, 0)::int AS comments FROM
      (SELECT DISTINCT to_char(date_trunc('month', published_at), 'YYYY-MM') AS month FROM posts WHERE published_at IS NOT NULL
       UNION SELECT DISTINCT to_char(date_trunc('month', published_at), 'YYYY-MM') FROM comments WHERE published_at IS NOT NULL) m
      LEFT JOIN (SELECT to_char(date_trunc('month', published_at), 'YYYY-MM') AS month, count(*) AS n FROM posts GROUP BY 1) p ON p.month = m.month
      LEFT JOIN (SELECT to_char(date_trunc('month', published_at), 'YYYY-MM') AS month, count(*) AS n FROM comments GROUP BY 1) c ON c.month = m.month
    ORDER BY 1`);

  const tiers = await q<DatasetStats["tiers"][number]>(`
    SELECT tier, count(*)::int AS posts, count(DISTINCT influencer_id)::int AS creators, min(followers) AS "minFollowers", max(followers) AS "maxFollowers"
    FROM posts WHERE tier IS NOT NULL AND followers > 0 GROUP BY 1
    ORDER BY array_position(ARRAY['nano','micro','mid','macro','mega'], tier)`);

  const countries = await q<DatasetStats["countries"][number]>(`SELECT country, count(*)::int AS posts FROM posts WHERE country IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);
  const postLang = await q<{ language: string; n: number }>(`SELECT coalesce(language,'unknown') AS language, count(*)::int AS n FROM posts GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);
  const commentLang = await q<{ language: string; n: number }>(`SELECT coalesce(language,'unknown') AS language, count(*)::int AS n FROM comments GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);

  const commentsPerPost = await q<DatasetStats["commentsPerPost"][number]>(`
    SELECT bucket, count(*)::int AS posts FROM (
      SELECT CASE WHEN n = 0 THEN '0' WHEN n <= 5 THEN '1 to 5' WHEN n <= 20 THEN '6 to 20' WHEN n <= 100 THEN '21 to 100' ELSE 'over 100' END AS bucket,
             CASE WHEN n = 0 THEN 0 WHEN n <= 5 THEN 1 WHEN n <= 20 THEN 2 WHEN n <= 100 THEN 3 ELSE 4 END AS ord
      FROM (SELECT p.post_id, p.segment_id, (SELECT count(*) FROM comments c WHERE c.post_id = p.post_id AND c.segment_id = p.segment_id) AS n FROM posts p) t
    ) b GROUP BY bucket, ord ORDER BY ord`);

  const analysis: DatasetStats["analysis"] = [];
  for (const f of ANALYSIS_FIELDS) {
    const [agg] = await q<{ filled: number; distinct: number }>(`SELECT count(${f.col})::int AS filled, count(DISTINCT ${f.col})::int AS distinct FROM comments`);
    const values = await q<{ value: string; n: number }>(`SELECT ${f.col} AS value, count(*)::int AS n FROM comments WHERE ${f.col} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT ${f.kind === "label" ? 10 : 8}`);
    const [ex] = await q<{ text: string; value: string; brand: string }>(`
      SELECT left(text, 200) AS text, ${f.col} AS value, brand FROM comments
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

  const samplePosts = await q(`SELECT post_id, brand, platform, post_type, username, left(text, 140) AS text, published_at, likes, comments, shares, views, saves, engagement, is_paid, tier, country, language, sentiment, emv, followers FROM posts WHERE text IS NOT NULL AND length(text) > 40 ORDER BY post_id LIMIT 3`);
  const sampleComments = await q(`SELECT comment_id, brand, post_id, left(text, 140) AS text, likes, published_at, sentiment, sentiment_score, emotion, language, topics, purchase_intent_type, objection_category, competitor_name, loyalty_type FROM comments WHERE language = 'en' AND length(text) > 30 AND (purchase_intent_type IS NOT NULL OR objection_category IS NOT NULL OR loyalty_type IS NOT NULL) ORDER BY comment_id LIMIT 3`);

  const [cav] = await q<{ views: number; lang: number; aud: number; rep: number; merc: number; cross: number }>(`
    SELECT (SELECT count(views)::int FROM posts) AS views, (SELECT count(*)::int FROM posts WHERE language IS NOT NULL AND language <> 'unknown') AS lang,
           (SELECT count(audience_female)::int FROM influencers) AS aud, (SELECT count(*)::int FROM influencers WHERE has_report) AS rep,
           (SELECT count(*)::int FROM posts WHERE brand = 'Mercadona') AS merc,
           (SELECT count(*)::int FROM (SELECT post_id FROM posts GROUP BY post_id HAVING count(*) > 1) x) AS cross`);

  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : "");
  return {
    counts: { posts: Number(c.posts), comments: Number(c.comments), influencers: Number(c.influencers), segments: Number(c.segments), creators: Number(c.creators) },
    dates: { firstPost: iso(d.fp), lastPost: iso(d.lp), firstComment: iso(d.fc), lastComment: iso(d.lc), exported: "2026-09-07" },
    platforms,
    brands: brands.map((b) => ({ ...b, first: iso(b.first), last: iso(b.last) })),
    fill,
    monthly,
    tiers,
    countries,
    languages: { posts: postLang, comments: commentLang },
    commentsPerPost,
    analysis,
    segmentOutputs,
    samples: { posts: samplePosts, comments: sampleComments },
    caveats: { viewsFilled: Number(cav.views), languageKnown: Number(cav.lang), audienceCoverage: Number(cav.aud), reportCoverage: Number(cav.rep), mercadonaPosts: Number(cav.merc), crossSegmentPosts: Number(cav.cross) },
  };
}
