import type { StarterCondition, StarterSection } from "./starter";

/**
 * Tom's Default Template: five questions (which conversations are winning, where is the white
 * space, what do people say, which creators win, what should we build or fix), opened by eight
 * measures that are calculated the same way everywhere. See docs/toms-template-plan.md.
 *
 * The measures are SQL fragments defined once here, so every element computes them one way:
 *  - share of voice: a brand's posts as a share of all tracked brands' posts;
 *  - engagement versus norm: actual engagement divided by expected, where expected is the post's
 *    reach (views; followers for Instagram image posts and posts without views) times the tracked
 *    brands' engagement rate for that platform and creator size. 1.0 is the norm, 1.2 is outperforming;
 *  - momentum: posts in the period against the period before, minus 1;
 *  - organic share: posts with no paid disclosure (the data has no brand-owned flag, so this
 *    stands in for Tom's earned share);
 *  - purchase intent, praise and objections: comments per 1,000 comments;
 *  - content gap: a theme's share of audience comments minus its share of posts.
 * A theme is a hashtag in the caption, with brand names and platform filler removed.
 *
 * Like the starter, it names no brand or category, and parts that need a signal the brands do not
 * have (comments, history, paid posts, fees, audience data) carry a `when` condition.
 */

/* ------------------------------------------------------------------ */
/* Measure fragments                                                     */
/* ------------------------------------------------------------------ */

const NOT_SELF = (col: string) => `NOT is_self_mention(${col})`;

/** Current window [s, e) and the start of the one before (ps). With no period: the last 90 days of tracked activity and the 90 before. */
const BOUNDS = `b0 AS MATERIALIZED (
  SELECT coalesce(period_start(), (SELECT max(published_at) FROM posts_all) - interval '90 days') AS s,
         coalesce(period_end(), (SELECT max(published_at) FROM posts_all) + interval '1 second') AS e
), b AS MATERIALIZED (
  SELECT s, e, CASE WHEN s = date_trunc('month', s) AND e = s + interval '1 month' THEN s - interval '1 month' ELSE s - (e - s) END AS ps FROM b0
)`;
/** Posts of both windows, flagged cur for the current one. Needs BOUNDS. */
const WINDOW_POSTS = `w AS (
  SELECT p.*, (p.published_at >= b.s) AS cur FROM posts_all p, b WHERE p.published_at >= b.ps AND p.published_at < b.e
)`;
const VERSUS = "This period against the one before (the last 90 days against the 90 before, when viewing all time)";

const REACH_BASIS = (a: string) => `CASE WHEN (${a}.platform = 'instagram' AND ${a}.post_type = 'image') OR coalesce(${a}.views, 0) = 0 THEN 'f' ELSE 'v' END`;
const REACH = (a: string) => `CASE WHEN (${a}.platform = 'instagram' AND ${a}.post_type = 'image') OR coalesce(${a}.views, 0) = 0 THEN ${a}.followers ELSE ${a}.views END`;
/**
 * norms: the tracked brands' engagement rate per platform, creator size and reach basis, over all
 * time. sp: every post of `src` with `expected` (its expected engagement) and `eng_s` (its
 * engagement), both null when the post cannot be scored (no reach, or no norm for its cell).
 */
const SCORED = (src = "posts") => `norms AS MATERIALIZED (
  SELECT a.platform, coalesce(a.tier, '') AS tier_k, ${REACH_BASIS("a")} AS basis, sum(a.engagement) / NULLIF(sum(${REACH("a")}), 0) AS rate
  FROM posts_all a WHERE coalesce(${REACH("a")}, 0) > 0 GROUP BY 1, 2, 3
), sp AS (
  SELECT p.*, CASE WHEN coalesce(${REACH("p")}, 0) > 0 AND n.rate > 0 THEN ${REACH("p")} * n.rate END AS expected,
         CASE WHEN coalesce(${REACH("p")}, 0) > 0 AND n.rate > 0 THEN p.engagement END AS eng_s
  FROM ${src} p LEFT JOIN norms n ON n.platform = p.platform AND n.tier_k = coalesce(p.tier, '') AND n.basis = ${REACH_BASIS("p")}
)`;
/** Engagement versus norm of a group of scored posts, optionally of the rows matching `filter`. */
const vs = (filter?: string) => (filter ? `sum(eng_s) FILTER (WHERE ${filter}) / NULLIF(sum(expected) FILTER (WHERE ${filter}), 0)` : `sum(eng_s) / NULLIF(sum(expected), 0)`);
const NORM_NOTE = "1.0 is the norm for the platform and creator size across the tracked brands; 1.2 and above is outperforming";

/** Hashtags that describe the platform, not the conversation. */
const FILLER = ["fyp", "fy", "foryou", "foryoupage", "foryourpage", "fypage", "viral", "explore", "explorepage", "trending", "trend", "shorts", "short", "reels", "reel", "video", "videos", "views", "tiktok", "instagram", "youtube", "parati", "capcut", "like", "follow", "love", "instagood", "xyzbca", "ad", "anzeige", "werbung", "sponsored", "new", "usa", "ads", "adv", "pub", "publi", "publicidad", "pubblicita", "reklame", "reklama", "gifted", "collab", "partner", "partnership", "pr"];
/**
 * tags: one row per post of `src` and hashtag in its caption, carrying the post's columns, so a
 * theme can be aggregated in one pass. Filter the aggregated themes with THEME_OK.
 */
const HASH_TAGS = (src = "posts") => `tags AS (
  SELECT DISTINCT ON (p.segment_id, p.post_id, m[1]) p.*, m[1] AS theme
  FROM ${src} p, LATERAL regexp_matches(lower(p.text), '#([[:alnum:]_]{3,30})', 'g') AS m
  WHERE p.text LIKE '%#%'
)`;
/** True for a hashtag that is a conversation: not platform filler, not a number, not a tracked brand's name. Apply after grouping by theme. */
const HASH_OK = (col = "theme") => `${col} NOT IN (${FILLER.map((f) => `'${f}'`).join(", ")}) AND ${col} !~ '^(fyp|foryou|viral|explore)' AND ${col} !~ '^[0-9_]+$'
    AND NOT EXISTS (SELECT 1 FROM segments bk WHERE length(regexp_replace(lower(bk.brand), '[^a-z0-9]', '', 'g')) >= 3
      AND (${col} LIKE '%' || regexp_replace(lower(bk.brand), '[^a-z0-9]', '', 'g') || '%' OR (length(${col}) >= 6 AND regexp_replace(lower(bk.brand), '[^a-z0-9]', '', 'g') LIKE '%' || ${col} || '%')))
    AND NOT EXISTS (SELECT 1 FROM segments bw, regexp_split_to_table(lower(bw.brand), '[^a-z0-9]+') AS word WHERE length(word) >= 6 AND ${col} LIKE '%' || word || '%')`;
/** A hashtag only one brand's creators use is that brand's campaign, not a conversation. True when at least two brands share it (or only one brand is tracked). */
const HASH_SHARED = (brands = "brands") => `(${brands} >= 2 OR (SELECT count(*) FROM segments) < 2)`;
/** The smallest number of posts a theme needs to be shown, scaled to how much there is in view. Needs a CTE of posts named in `src`. */
const MIN_POSTS = (src: string, where = "TRUE") => `mn AS MATERIALIZED (SELECT CASE WHEN count(*) >= 3000 THEN 30 WHEN count(*) >= 600 THEN 12 ELSE 5 END AS n FROM ${src} WHERE ${where})`;
const HASH_NOTE = "A theme is a caption hashtag, with brand names and platform filler removed";

/**
 * The same shape from classified posts: one row per post of `src` and theme it was given (see
 * themes.ts). Themes come from a fixed list per industry, so they need no name check and are
 * shared by definition.
 */
const LABEL_TAGS = (src = "posts") => `tags AS (
  SELECT p.*, pt.theme FROM ${src} p JOIN post_themes pt ON pt.segment_id = p.segment_id AND pt.post_id = p.post_id AND pt.is_primary
  WHERE pt.theme NOT IN ('Other', 'Unknown')
    AND NOT EXISTS (SELECT 1 FROM post_about pa WHERE pa.segment_id = p.segment_id AND pa.post_id = p.post_id AND pa.about = 'no')
)`;
const LABEL_NOTE = "A theme is what the caption is about, from a fixed list for the industry. Posts judged not to be about the brand are left out";

const r2 = (expr: string) => `round((${expr})::numeric, 2)`;
const r1 = (expr: string) => `round((${expr})::numeric, 1)`;
const r0 = (expr: string) => `round((${expr})::numeric, 0)`;

/* ------------------------------------------------------------------ */
/* Conditions                                                            */
/* ------------------------------------------------------------------ */

const OUR_COMMENTS = { sql: `SELECT count(*)::int AS n FROM comments WHERE brand = focal_brand()`, min: 30, unit: "comments on our content" };
const N_COMMENTS: StarterCondition = { sql: `SELECT count(*)::int AS n FROM comments_all WHERE brand = focal_brand()`, min: 100, what: "audience comments on our content" };
const N_HISTORY: StarterCondition = { sql: `SELECT coalesce(extract(epoch FROM max(published_at) - min(published_at)) / 86400, 0)::int AS n FROM posts_all`, min: 45, what: "days of history to compare one period with the one before" };
const N_LONG_HISTORY: StarterCondition = { sql: `SELECT coalesce(extract(epoch FROM max(published_at) - min(published_at)) / 86400, 0)::int AS n FROM posts_all`, min: 120, what: "days of history to tell a spike from a normal month" };
const N_COMPETITORS: StarterCondition = { sql: `SELECT count(*)::int AS n FROM segments WHERE is_competitor(brand)`, min: 1, what: "competitor in the selection" };
const N_PAID: StarterCondition = { sql: `SELECT count(*)::int AS n FROM posts_all WHERE brand = focal_brand() AND is_paid`, min: 20, what: "disclosed paid posts" };
const N_FEES: StarterCondition = { sql: `SELECT count(*)::int AS n FROM posts_all WHERE brand = focal_brand() AND budget_min IS NOT NULL`, min: 50, what: "posts with an estimated creator fee" };
const N_AUDIENCE: StarterCondition = { sql: `SELECT count(*)::int AS n FROM influencers WHERE brand = focal_brand() AND audience_countries IS NOT NULL`, min: 20, what: "creators with audience data" };
const N_REQUESTS: StarterCondition = { sql: `SELECT count(*)::int AS n FROM comments_all WHERE brand = focal_brand() AND feature_request_type IS NOT NULL`, min: 30, what: "comments asking for a product change" };
const N_USE_CASES: StarterCondition = { sql: `SELECT count(*)::int AS n FROM comments_all WHERE brand = focal_brand() AND use_case_segment IS NOT NULL`, min: 20, what: "comments describing how the product is used" };
const N_OBJECTIONS: StarterCondition = { sql: `SELECT count(*)::int AS n FROM comments_all WHERE brand = focal_brand() AND objection_category IS NOT NULL`, min: 50, what: "comments raising an objection" };
const N_RIVAL_MENTIONS: StarterCondition = { sql: `SELECT count(*)::int AS n FROM comments_all WHERE brand = focal_brand() AND competitor_name IS NOT NULL AND ${NOT_SELF("competitor_name")}`, min: 20, what: "comments naming another brand" };
const N_BLOCKERS: StarterCondition = { sql: `SELECT count(*)::int AS n FROM comments_all WHERE brand = focal_brand() AND purchase_blocker IS NOT NULL`, min: 10, what: "comments naming what stops a purchase" };
const N_THEMED: StarterCondition = { sql: `SELECT count(*)::int AS n FROM post_themes`, min: 50, what: "posts with a theme" };
const N_ABOUT: StarterCondition = { sql: `SELECT count(*)::int AS n FROM post_about WHERE brand = focal_brand()`, min: 50, what: "of our posts checked for whether they are about us" };
const N_HOOKS: StarterCondition = { sql: `SELECT count(*)::int AS n FROM post_hooks WHERE brand = focal_brand()`, min: 20, what: "of our posts with a recognisable hook" };
const HAS_INSIGHT: StarterCondition = { sql: `SELECT count(*)::int AS n FROM segments WHERE brand = focal_brand() AND insight_headline IS NOT NULL`, min: 1, what: "a precomputed strategy insight" };

/**
 * Product attributes read from the comment analysis tags. The tags are free text, so they are
 * matched by pattern; reactions ("praise", "humor") match none and stay out of the grid.
 */
const ATTRIBUTES = `attr(name, pattern) AS (VALUES
  ('Price and value', 'price|pricing|cost|expens|cheap|afford|value|discount|deal'),
  ('Quality and results', 'quality|effective|efficacy|results|performance|durab|long.?last|reliab'),
  ('Ease of use', 'ease|easy|convenien|usab|how.?to|instructions|product.?use'),
  ('Safety and comfort', 'safety|safe|irritat|allerg|sensitiv|pain|comfort|side.?effect'),
  ('Availability', 'availab|stock|shipping|delivery|where.?to.?buy|restock'),
  ('Design and look', 'design|aesthetic|packaging|colou?r|style|look'),
  ('Ingredients and ethics', 'ingredient|formula|composition|natural|sustainab|eco|vegan|ethic|cruelty'),
  ('Service', 'customer.?service|customer.?support|refund|warranty|return')
)`;

/* ------------------------------------------------------------------ */
/* The template                                                          */
/* ------------------------------------------------------------------ */

/** Where themes come from: the hashtags in the caption, or the labels given to each post. */
type ThemeSource = "hashtags" | "labels";

function sections(source: ThemeSource): StarterSection[] {
  const labels = source === "labels";
  const TAGS = labels ? LABEL_TAGS : HASH_TAGS;
  const THEME_OK = labels ? () => "TRUE" : HASH_OK;
  const SHARED = labels ? () => "TRUE" : HASH_SHARED;
  const THEME_NOTE = labels ? LABEL_NOTE : HASH_NOTE;
  const all: StarterSection[] = [
  {
    title: "The eight measures",
    widgets: [
      {
        type: "kpi", w: 12, h: 3,
        title: "Our eight measures",
        subtitle: `${VERSUS}. Vs norm is engagement against the norm for the platform and creator size (1.0 is the norm). Intent, praise and objections are per 1,000 comments. Content gap is the largest in section 2, in points.`,
        sql: `WITH ${BOUNDS}, ${WINDOW_POSTS}, ${SCORED("w")}, ${TAGS("(SELECT * FROM w WHERE cur)")},
tot AS MATERIALIZED (SELECT count(*) FILTER (WHERE cur)::float AS cur, count(*) FILTER (WHERE NOT cur)::float AS prev, sum(coalesce(comments, 0)) FILTER (WHERE cur) AS comments FROM w),
us AS MATERIALIZED (
  SELECT count(*) FILTER (WHERE cur)::float AS cur, count(*) FILTER (WHERE NOT cur)::float AS prev,
         count(*) FILTER (WHERE cur AND NOT coalesce(is_paid, false))::float AS organic, count(*) FILTER (WHERE NOT cur AND NOT coalesce(is_paid, false))::float AS organic_prev,
         ${vs("cur")} AS vs_cur, ${vs("NOT cur")} AS vs_prev
  FROM sp WHERE brand = focal_brand()
), cm AS MATERIALIZED (
  SELECT count(*) FILTER (WHERE c.published_at >= b.s)::float AS n, count(*) FILTER (WHERE c.published_at < b.s)::float AS n_prev,
         count(*) FILTER (WHERE c.published_at >= b.s AND c.purchase_intent_type IS NOT NULL)::float AS intent, count(*) FILTER (WHERE c.published_at < b.s AND c.purchase_intent_type IS NOT NULL)::float AS intent_prev,
         count(*) FILTER (WHERE c.published_at >= b.s AND c.sentiment = 'positive')::float AS praise, count(*) FILTER (WHERE c.published_at < b.s AND c.sentiment = 'positive')::float AS praise_prev,
         count(*) FILTER (WHERE c.published_at >= b.s AND c.objection_category IS NOT NULL)::float AS obj, count(*) FILTER (WHERE c.published_at < b.s AND c.objection_category IS NOT NULL)::float AS obj_prev
  FROM comments_all c, b WHERE c.brand = focal_brand() AND c.published_at >= b.ps AND c.published_at < b.e
), ${MIN_POSTS("w", "cur")},
gap AS (SELECT theme, count(*)::float AS n, sum(coalesce(comments, 0)) AS comments, count(DISTINCT brand) AS brands FROM tags GROUP BY 1),
gap_c AS MATERIALIZED (
  SELECT gap.theme, 100.0 * gap.comments / NULLIF(tot.comments, 0) - 100.0 * gap.n / NULLIF(tot.cur, 0) AS pts
  FROM gap, tot, mn WHERE gap.n >= mn.n AND ${SHARED("gap.brands")} ORDER BY 2 DESC NULLS LAST LIMIT 40
), top_gap AS (SELECT theme, pts FROM gap_c WHERE ${THEME_OK("theme")} ORDER BY pts DESC NULLS LAST LIMIT 1)
SELECT 'Share of voice' AS label, us.cur / NULLIF(tot.cur, 0) AS value, us.prev / NULLIF(tot.prev, 0) AS compare, 'percent' AS fmt FROM us, tot
UNION ALL SELECT 'Vs norm', us.vs_cur, us.vs_prev, 'decimal' FROM us
UNION ALL SELECT 'Momentum', CASE WHEN us.prev >= 3 THEN us.cur / us.prev - 1 END, NULL, 'percent' FROM us
UNION ALL SELECT 'Organic share', us.organic / NULLIF(us.cur, 0), us.organic_prev / NULLIF(us.prev, 0), 'percent' FROM us
UNION ALL SELECT 'Intent per 1K', 1000 * cm.intent / NULLIF(cm.n, 0), 1000 * cm.intent_prev / NULLIF(cm.n_prev, 0), 'decimal' FROM cm WHERE cm.n + cm.n_prev > 0
UNION ALL SELECT 'Praise per 1K', 1000 * cm.praise / NULLIF(cm.n, 0), 1000 * cm.praise_prev / NULLIF(cm.n_prev, 0), 'decimal' FROM cm WHERE cm.n + cm.n_prev > 0
UNION ALL SELECT 'Objections per 1K', 1000 * cm.obj / NULLIF(cm.n, 0), 1000 * cm.obj_prev / NULLIF(cm.n_prev, 0), 'decimal' FROM cm WHERE cm.n + cm.n_prev > 0
UNION ALL SELECT 'Content gap', top_gap.pts, NULL, 'decimal' FROM top_gap WHERE top_gap.pts > 0.05`,
        rationale: "The same eight numbers every month, so a change is a change and not a new definition.",
      },
      {
        type: "table", w: 12, h: 5,
        title: "The same measures for every tracked brand",
        subtitle: `Share of voice, engagement versus norm, momentum and organic share, per brand. ${VERSUS}.`,
        sql: `WITH ${BOUNDS}, ${WINDOW_POSTS}, ${SCORED("w")},
a AS (
  SELECT brand, count(*) FILTER (WHERE cur)::float AS posts, count(*) FILTER (WHERE NOT cur)::float AS prev,
         count(DISTINCT influencer_id) FILTER (WHERE cur)::int AS creators, count(*) FILTER (WHERE cur AND NOT coalesce(is_paid, false))::float AS organic,
         ${vs("cur")} AS vs
  FROM sp GROUP BY 1
)
SELECT a.brand, CASE WHEN a.brand = focal_brand() THEN 'us' ELSE 'competitor' END AS role, a.posts::int AS posts, a.creators,
       ${r1("100.0 * a.posts / NULLIF((SELECT sum(posts) FROM a), 0)")} AS "share of voice %",
       ${r2("a.vs")} AS "vs norm",
       CASE WHEN a.prev >= 3 THEN ${r0("100.0 * (a.posts / a.prev - 1)")} END AS "momentum %",
       ${r0("100.0 * a.organic / NULLIF(a.posts, 0)")} AS "organic %"
FROM a WHERE a.posts > 0 ORDER BY (a.brand = focal_brand()) DESC, a.posts DESC`,
        rationale: "The rival read in one glance.",
      },
      {
        type: "table", w: 12, h: 5,
        title: "What the audience says, per tracked brand",
        subtitle: "Comments per 1,000 comments: buying signals, praise and objections (brands with 100+ comments)",
        when: N_COMMENTS,
        sql: `SELECT brand, CASE WHEN brand = focal_brand() THEN 'us' ELSE 'competitor' END AS role, count(*)::int AS comments,
       ${r1("1000.0 * count(*) FILTER (WHERE purchase_intent_type IS NOT NULL) / count(*)")} AS "intent per 1K",
       ${r0("1000.0 * count(*) FILTER (WHERE sentiment = 'positive') / count(*)")} AS "praise per 1K",
       ${r1("1000.0 * count(*) FILTER (WHERE objection_category IS NOT NULL) / count(*)")} AS "objections per 1K",
       ${r1("1000.0 * count(*) FILTER (WHERE sentiment = 'negative') / count(*)")} AS "negative per 1K"
FROM comments GROUP BY brand HAVING count(*) >= 100 OR brand = focal_brand() ORDER BY (brand = focal_brand()) DESC, count(*) DESC`,
        sample: OUR_COMMENTS,
        rationale: "Whether the conversation about us converts, pleases and objects more or less than about rivals.",
      },
    ],
  },
  {
    title: "1. Which conversations are winning?",
    widgets: [
      {
        type: "table", w: 12, h: 7,
        title: "Themes: growth and performance",
        subtitle: `${THEME_NOTE}${labels ? "" : "; themes only one brand uses are left out"}. Winning is growing 20% or more with engagement at 1.2 times the norm; an early signal is 1.5 times the norm without the growth yet; peaking is fast growth below the norm.`,
        sql: `WITH ${BOUNDS}, ${WINDOW_POSTS}, ${SCORED("w")}, ${TAGS("sp")}, ${MIN_POSTS("w", "cur")},
t AS (
  SELECT theme, count(*) FILTER (WHERE cur)::float AS posts, count(*) FILTER (WHERE NOT cur)::float AS before,
         count(DISTINCT brand) FILTER (WHERE cur)::int AS brands, ${vs("cur")} AS vs,
         count(*) FILTER (WHERE cur AND brand = focal_brand())::float AS ours
  FROM tags GROUP BY 1
), c AS MATERIALIZED (SELECT t.* FROM t, mn WHERE t.posts >= mn.n AND ${SHARED("t.brands")} ORDER BY t.posts DESC LIMIT 120)
SELECT theme, posts::int AS posts, brands, CASE WHEN before >= 3 THEN ${r0("100.0 * (posts / before - 1)")} END AS "momentum %", ${r2("vs")} AS "vs norm",
       ${r0("100.0 * ours / NULLIF(posts, 0)")} AS "our share %",
       CASE WHEN vs >= 1.2 AND before >= 3 AND posts >= 1.2 * before THEN 'winning'
            WHEN vs >= 1.5 THEN 'early signal'
            WHEN before >= 3 AND posts >= 1.5 * before AND vs < 1 THEN 'peaking'
            WHEN vs >= 1.2 THEN 'above norm' WHEN vs < 0.8 THEN 'below norm' ELSE 'steady' END AS status
FROM c WHERE ${THEME_OK("theme")} ORDER BY posts DESC LIMIT 25`,
        rationale: "Which conversations are growing and rewarded, which are just starting, and which are fading.",
      },
      {
        type: "table", w: 6, h: 6,
        title: "Where we are missing from themes that work",
        subtitle: "Themes above the norm where our share of the posts is furthest below our overall share of voice. The gap is in points.",
        when: N_COMPETITORS,
        sql: `WITH ${SCORED("posts")}, ${TAGS("sp")}, ${MIN_POSTS("posts")},
t AS (SELECT theme, count(*)::float AS posts, count(*) FILTER (WHERE brand = focal_brand())::float AS ours, ${vs()} AS vs, count(DISTINCT brand) AS brands FROM tags GROUP BY 1),
o AS MATERIALIZED (SELECT count(*) FILTER (WHERE brand = focal_brand())::float / NULLIF(count(*), 0) AS share FROM posts),
c AS MATERIALIZED (SELECT t.*, o.share FROM t, o, mn WHERE t.posts >= mn.n AND t.vs >= 1.1 AND t.ours / t.posts < o.share AND ${SHARED("t.brands")} ORDER BY t.ours / t.posts - o.share ASC, t.posts DESC LIMIT 80)
SELECT theme, posts::int AS posts, ${r2("vs")} AS "vs norm", ${r0("100.0 * ours / posts")} AS "our share %", ${r1("100.0 * (ours / posts - share)")} AS gap
FROM c WHERE ${THEME_OK("theme")} ORDER BY ours / posts - share ASC, posts DESC LIMIT 12`,
        rationale: "The rewarded conversations we are absent from are the cheapest ones to enter.",
      },
      {
        type: "table", w: 6, h: 6,
        title: "Conversations that sell, not just engage",
        subtitle: "Themes on our content by buying signals per 1,000 comments and engagement versus norm (themes with 5+ posts and 50+ comments). The score multiplies the two.",
        when: N_COMMENTS,
        sql: `WITH pc AS (SELECT segment_id, post_id, count(*)::float AS n, count(*) FILTER (WHERE purchase_intent_type IS NOT NULL)::float AS intent FROM comments WHERE brand = focal_brand() GROUP BY 1, 2),
ours AS (SELECT p.*, pc.n AS c_n, pc.intent AS c_intent FROM posts p LEFT JOIN pc ON pc.segment_id = p.segment_id AND pc.post_id = p.post_id WHERE p.brand = focal_brand()),
${SCORED("ours")}, ${TAGS("sp")},
t AS (SELECT theme, count(*)::int AS posts, sum(c_n) AS comments, sum(c_intent) AS intent, ${vs()} AS vs FROM tags GROUP BY 1)
SELECT theme, posts, comments::int AS comments, ${r1("1000.0 * intent / comments")} AS "intent per 1K", ${r2("vs")} AS "vs norm", ${r0("1000.0 * intent / comments * coalesce(vs, 1)")} AS score
FROM (SELECT * FROM t WHERE comments >= 50 AND posts >= 5 AND intent > 0 ORDER BY 1000.0 * intent / comments * coalesce(vs, 1) DESC LIMIT 80) c
WHERE ${THEME_OK("theme")} ORDER BY 1000.0 * intent / comments * coalesce(vs, 1) DESC LIMIT 12`,
        sample: OUR_COMMENTS,
        rationale: "Reach without intent is entertainment. These themes bring both.",
      },
      {
        type: "bar", w: 6, h: 5,
        title: "Formats that win",
        subtitle: `Engagement versus norm by platform and format, us against the tracked competitors (cells with 5+ posts). ${NORM_NOTE}.`,
        sql: `WITH ${SCORED("posts")},
f AS (
  SELECT platform || ' ' || post_type AS format,
         ${vs("brand = focal_brand()")} AS us, ${vs("brand <> focal_brand()")} AS competitors,
         count(*) FILTER (WHERE brand = focal_brand() AND expected IS NOT NULL) AS n_us, count(*) FILTER (WHERE expected IS NOT NULL) AS n
  FROM sp WHERE platform IS NOT NULL AND post_type IS NOT NULL GROUP BY 1
)
SELECT format, CASE WHEN n_us >= 5 THEN ${r2("us")} END AS us, ${r2("competitors")} AS competitors FROM f WHERE n >= 5 ORDER BY n DESC LIMIT 8`,
        x: "format", format: "decimal",
        rationale: "Where our content beats the norm, and where a rival's format works better.",
      },
      {
        type: "table", w: 6, h: 5,
        title: "Markets that lead",
        subtitle: `Creator countries across the tracked brands: volume, momentum and engagement versus norm (countries with 10+ posts). ${VERSUS}.`,
        sql: `WITH ${BOUNDS}, ${WINDOW_POSTS}, ${SCORED("w")},
c AS (
  SELECT country, count(*) FILTER (WHERE cur)::float AS posts, count(*) FILTER (WHERE NOT cur)::float AS before,
         count(*) FILTER (WHERE cur AND brand = focal_brand())::int AS ours, ${vs("cur")} AS vs
  FROM sp WHERE country IS NOT NULL AND country <> 'Unknown' GROUP BY 1
)
SELECT c.country, c.posts::int AS posts, c.ours AS "our posts", CASE WHEN c.before >= 3 THEN ${r0("100.0 * (c.posts / c.before - 1)")} END AS "momentum %", ${r2("c.vs")} AS "vs norm"
FROM c WHERE c.posts >= 10 ORDER BY c.posts DESC LIMIT 10`,
        rationale: "A market that grows and outperforms before the others is where a theme starts.",
      },
      {
        type: "table", w: 12, h: 5,
        title: "What spiked, and why",
        subtitle: "Brand months with at least twice the engagement of the three months before, with the post behind it. Ignores the period.",
        when: N_LONG_HISTORY,
        period: "all",
        sql: `WITH m AS (
  SELECT brand, date_trunc('month', published_at) AS mo, sum(engagement) AS eng, count(*)::int AS posts FROM posts_all WHERE published_at IS NOT NULL GROUP BY 1, 2
), r AS (
  SELECT *, avg(eng) OVER (PARTITION BY brand ORDER BY mo ROWS BETWEEN 3 PRECEDING AND 1 PRECEDING) AS base,
            count(*) OVER (PARTITION BY brand ORDER BY mo ROWS BETWEEN 3 PRECEDING AND 1 PRECEDING) AS months_before FROM m
), s AS (SELECT * FROM r WHERE months_before = 3 AND base > 0 AND eng >= 2 * base AND posts >= 5),
top AS (
  SELECT DISTINCT ON (s.brand, s.mo) s.brand, s.mo, p.username, p.platform, p.is_paid, p.engagement, p.url
  FROM s JOIN posts_all p ON p.brand = s.brand AND date_trunc('month', p.published_at) = s.mo ORDER BY s.brand, s.mo, p.engagement DESC NULLS LAST
)
SELECT to_char(s.mo, 'YYYY-MM') AS month, s.brand, ${r1("s.eng / s.base")} AS "times the usual", s.posts, top.username AS creator, top.platform,
       CASE WHEN top.is_paid THEN 'paid' ELSE 'organic' END AS kind, ${r0("100.0 * top.engagement / NULLIF(s.eng, 0)")} AS "top post share %", top.url AS post
FROM s JOIN top USING (brand, mo) ORDER BY s.mo DESC, s.eng / s.base DESC LIMIT 15`,
        rationale: "A spike made by one paid post is a purchase. A spike made by many organic posts is a conversation.",
      },
    ],
  },
  {
    title: "2. Where is the white space?",
    widgets: [
      {
        type: "table", w: 7, h: 6,
        title: "Rewarded, and nobody owns it",
        subtitle: `Themes at 1.2 times the norm or better where no tracked brand has more than half of the posts. ${THEME_NOTE}.`,
        when: N_COMPETITORS,
        sql: `WITH ${SCORED("posts")}, ${TAGS("sp")}, ${MIN_POSTS("posts")},
tb AS (SELECT theme, brand, count(*)::float AS n, sum(eng_s) AS eng_s, sum(expected) AS expected FROM tags GROUP BY 1, 2),
t AS (
  SELECT theme, sum(n) AS posts, sum(eng_s) / NULLIF(sum(expected), 0) AS vs, max(n) AS lead_n, count(*) AS brands,
         (array_agg(brand ORDER BY n DESC))[1] AS leader, coalesce(sum(n) FILTER (WHERE brand = focal_brand()), 0) AS ours
  FROM tb GROUP BY 1
), lim AS MATERIALIZED (SELECT greatest(0.5, 1.6 / NULLIF(count(*), 0)) AS share FROM segments),
c AS MATERIALIZED (SELECT t.* FROM t, mn, lim WHERE t.posts >= mn.n AND t.vs >= 1.2 AND t.lead_n / t.posts <= lim.share AND t.brands >= 2 ORDER BY t.vs DESC LIMIT 80)
SELECT theme, posts::int AS posts, ${r2("vs")} AS "vs norm", leader, ${r0("100.0 * lead_n / posts")} AS "leader share %", ${r0("100.0 * ours / posts")} AS "our share %"
FROM c WHERE ${THEME_OK("theme")} ORDER BY vs DESC LIMIT 15`,
        rationale: "The audience rewards these and no brand has claimed them. Each is a brief.",
      },
      {
        type: "bar", w: 5, h: 6,
        title: "Content gap",
        subtitle: "A theme's share of audience comments minus its share of posts, in points: where people talk more than creators post.",
        sql: `WITH ${TAGS("posts")}, ${MIN_POSTS("posts")},
tot AS MATERIALIZED (SELECT count(*)::float AS posts, NULLIF(sum(coalesce(comments, 0)), 0) AS comments FROM posts),
t AS (SELECT theme, count(*)::float AS posts, sum(coalesce(comments, 0)) AS comments, count(DISTINCT brand) AS brands FROM tags GROUP BY 1)
SELECT c.theme, ${r1("c.pts")} AS value
FROM (SELECT t.theme, 100.0 * t.comments / tot.comments - 100.0 * t.posts / tot.posts AS pts FROM t, tot, mn
      WHERE t.posts >= mn.n AND tot.comments IS NOT NULL AND ${SHARED("t.brands")} ORDER BY 2 DESC LIMIT 80) c
WHERE c.pts > 0.05 AND ${THEME_OK("c.theme")} ORDER BY c.pts DESC LIMIT 12`,
        x: "theme", y: "value", horizontal: true, format: "decimal",
        rationale: "Demand the creators are not meeting yet.",
      },
      {
        type: "table", w: 7, h: 6,
        title: "Questions nobody answered",
        subtitle: "Question topics on our content: how many were asked, how many got no reply, and the most-liked one",
        when: N_COMMENTS,
        sql: `WITH q AS (SELECT faq_topic AS topic, coalesce(faq_phrase, text) AS question, likes, coalesce(reply_count, 0) AS replies FROM comments WHERE brand = focal_brand() AND faq_topic IS NOT NULL),
top AS (SELECT DISTINCT ON (topic) topic, left(question, 150) AS example FROM q WHERE replies = 0 ORDER BY topic, likes DESC NULLS LAST)
SELECT q.topic, count(*)::int AS questions, count(*) FILTER (WHERE q.replies = 0)::int AS unanswered, coalesce(sum(q.likes) FILTER (WHERE q.replies = 0), 0)::int AS "likes on unanswered", top.example
FROM q JOIN top USING (topic) GROUP BY q.topic, top.example HAVING count(*) FILTER (WHERE q.replies = 0) >= 2 ORDER BY 3 DESC, 4 DESC LIMIT 12`,
        sample: OUR_COMMENTS,
        rationale: "Every unanswered question is a piece of content somebody already asked for.",
      },
      {
        type: "stacked_bar", w: 5, h: 6,
        title: "Platforms we under-use",
        subtitle: "Share of posts by platform: us against the tracked competitors",
        when: N_COMPETITORS,
        sql: `SELECT CASE WHEN brand = focal_brand() THEN 'Us' ELSE 'Competitors' END AS who, platform, count(*)::int AS value
FROM posts WHERE platform IS NOT NULL GROUP BY 1, 2 ORDER BY 1 DESC, 3 DESC`,
        x: "who", y: "value", series: "platform", colorBy: "platform", normalize: true,
        rationale: "A platform where rivals post and we do not is either a gap or a decision.",
      },
      {
        type: "table", w: 12, h: 5,
        title: "Audiences with more demand than creators",
        subtitle: "Creator countries across the tracked brands, ranked by audience comments per post (countries with 10+ posts)",
        sql: `WITH ${SCORED("posts")},
c AS (
  SELECT country, count(*)::int AS posts, count(DISTINCT influencer_id)::int AS creators, sum(coalesce(comments, 0)) AS comments,
         count(*) FILTER (WHERE brand = focal_brand())::int AS ours, ${vs()} AS vs
  FROM sp WHERE country IS NOT NULL AND country <> 'Unknown' GROUP BY 1
)
SELECT c.country, c.creators, c.posts, c.ours AS "our posts", ${r1("c.comments::float / c.posts")} AS "comments per post", ${r2("c.vs")} AS "vs norm"
FROM c WHERE c.posts >= 10 ORDER BY c.comments::float / c.posts DESC LIMIT 10`,
        rationale: "Where few creators serve an audience that talks back a lot, the next creator gets heard.",
      },
    ],
  },
  {
    title: "3. What do people say about us, our rivals and our products?",
    when: N_COMMENTS,
    widgets: [
      {
        type: "bar", w: 6, h: 5,
        title: "Buying signals, us and each rival",
        subtitle: "Comments signalling a purchase, per 1,000 comments (brands with 100+ comments)",
        sql: `SELECT brand, ${r1("1000.0 * count(*) FILTER (WHERE purchase_intent_type IS NOT NULL) / count(*)")} AS value
FROM comments GROUP BY brand HAVING count(*) >= 100 OR brand = focal_brand() ORDER BY value DESC`,
        x: "brand", y: "value", colorBy: "brand", format: "decimal", horizontal: true,
        sample: OUR_COMMENTS,
        rationale: "Whether our conversation converts better or worse than theirs.",
      },
      {
        type: "bar", w: 6, h: 5,
        title: "Objections, us against the rivals",
        subtitle: "Objections per 1,000 comments by kind: us and the average tracked competitor (competitors with 100+ comments)",
        when: N_OBJECTIONS,
        sql: `WITH tot AS MATERIALIZED (SELECT brand, count(*)::float AS n FROM comments GROUP BY 1 HAVING count(*) >= 100 OR brand = focal_brand()),
per AS (SELECT brand, objection_category AS objection, count(*)::float AS n FROM comments WHERE objection_category IS NOT NULL GROUP BY 1, 2),
cats AS (SELECT DISTINCT objection FROM per),
rates AS (SELECT t.brand, k.objection, 1000.0 * coalesce(p.n, 0) / t.n AS rate FROM tot t CROSS JOIN cats k LEFT JOIN per p ON p.brand = t.brand AND p.objection = k.objection)
SELECT replace(objection, '_', ' ') AS objection, ${r1("max(rate) FILTER (WHERE brand = focal_brand())")} AS us, ${r1("avg(rate) FILTER (WHERE brand <> focal_brand())")} AS competitors
FROM rates GROUP BY 1 ORDER BY 2 DESC NULLS LAST`,
        x: "objection", format: "decimal",
        sample: OUR_COMMENTS,
        rationale: "Where we are weaker than the category, and where they are.",
      },
      {
        type: "table", w: 7, h: 6,
        title: "Objections that matter most",
        subtitle: "Objections on our content, weighted by the likes they collected, with the most-liked one verbatim",
        when: N_OBJECTIONS,
        sql: `WITH o AS MATERIALIZED (SELECT objection_category AS objection, coalesce(objection_phrase, text) AS said, coalesce(likes, 0) AS likes FROM comments WHERE brand = focal_brand() AND objection_category IS NOT NULL),
top AS (SELECT DISTINCT ON (objection) objection, left(said, 160) AS example FROM o ORDER BY objection, likes DESC)
SELECT replace(o.objection, '_', ' ') AS objection, count(*)::int AS comments, sum(o.likes)::int AS likes, (count(*) + sum(o.likes))::int AS weight, top.example
FROM o JOIN top USING (objection) GROUP BY o.objection, top.example ORDER BY 4 DESC`,
        sample: OUR_COMMENTS,
        rationale: "An objection many people agree with costs more than one said often.",
      },
      {
        type: "table", w: 5, h: 6,
        title: "Where rivals are weak and we are strong",
        subtitle: "Objections per 1,000 comments: ours, the weakest rival's, and the gap (rivals with 100+ comments)",
        when: N_OBJECTIONS,
        sql: `WITH tot AS MATERIALIZED (SELECT brand, count(*)::float AS n FROM comments GROUP BY 1 HAVING count(*) >= 100 OR brand = focal_brand()),
per AS (SELECT brand, objection_category AS objection, count(*)::float AS n FROM comments WHERE objection_category IS NOT NULL GROUP BY 1, 2),
cats AS (SELECT DISTINCT objection FROM per),
rates AS (SELECT t.brand, k.objection, 1000.0 * coalesce(p.n, 0) / t.n AS rate FROM tot t CROSS JOIN cats k LEFT JOIN per p ON p.brand = t.brand AND p.objection = k.objection),
worst AS (SELECT DISTINCT ON (objection) objection, brand, rate FROM rates WHERE brand <> focal_brand() ORDER BY objection, rate DESC)
SELECT replace(r.objection, '_', ' ') AS objection, ${r1("r.rate")} AS ours, worst.brand AS "weakest rival", ${r1("worst.rate")} AS theirs, ${r1("worst.rate - r.rate")} AS gap
FROM rates r JOIN worst USING (objection) WHERE r.brand = focal_brand() ORDER BY worst.rate - r.rate DESC`,
        sample: OUR_COMMENTS,
        rationale: "A positive gap is a claim we can make and they cannot.",
      },
      {
        type: "table", w: 6, h: 6,
        title: "Who people compare us with",
        subtitle: "Other brands named in comments on our content, and who the commenter favoured",
        when: N_RIVAL_MENTIONS,
        sql: `SELECT initcap(lower(trim(competitor_name))) AS brand, count(*)::int AS mentions,
       count(*) FILTER (WHERE competitor_favored = 'focal_brand')::int AS "favour us", count(*) FILTER (WHERE competitor_favored = 'competitor')::int AS "favour them",
       count(*) FILTER (WHERE competitor_mention_type = 'preference')::int AS preferences, count(*) FILTER (WHERE competitor_mention_type = 'comparison')::int AS comparisons
FROM comments WHERE brand = focal_brand() AND competitor_name IS NOT NULL AND ${NOT_SELF("competitor_name")}
GROUP BY 1 HAVING count(*) >= 2 ORDER BY 2 DESC LIMIT 12`,
        sample: OUR_COMMENTS,
        rationale: "Who we are really compared with, in the audience's words, and who wins the comparison.",
      },
      {
        type: "table", w: 6, h: 6,
        title: "What stops people buying",
        subtitle: "Conditions people attach to buying, grouped, with an example",
        when: N_BLOCKERS,
        sql: `SELECT lower(trim(purchase_blocker)) AS blocker, count(*)::int AS comments, coalesce(sum(likes), 0)::int AS likes, left(min(text), 150) AS example
FROM comments WHERE brand = focal_brand() AND purchase_blocker IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT 12`,
        sample: OUR_COMMENTS,
        rationale: "Each one is a sale waiting on a fix or an answer.",
      },
      {
        type: "table", w: 12, h: 6,
        title: "What the copy should say",
        subtitle: "The most-liked things people say in our favour, verbatim: loyalty, advocacy and buying intent",
        sql: `SELECT CASE WHEN loyalty_type IS NOT NULL THEN replace(loyalty_type, '_', ' ') ELSE 'buying intent' END AS kind,
       left(coalesce(loyalty_phrase, text), 200) AS "in their words", coalesce(likes, 0)::int AS likes, username AS "said by"
FROM comments WHERE brand = focal_brand() AND sentiment = 'positive' AND (loyalty_type IS NOT NULL OR purchase_intent_type = 'explicit') AND length(coalesce(loyalty_phrase, text)) >= 20
ORDER BY likes DESC NULLS LAST LIMIT 12`,
        sample: OUR_COMMENTS,
        rationale: "The audience already wrote the best lines.",
      },
    ],
  },
  {
    title: "4. Which creators win in each conversation?",
    widgets: [
      {
        type: "table", w: 12, h: 7,
        title: "Who drives each theme",
        subtitle: `The three creators with the most views in each of the ten largest themes, across the tracked brands. ${THEME_NOTE}.`,
        sql: `WITH ${SCORED("posts")}, ${TAGS("sp")},
big0 AS MATERIALIZED (SELECT theme, count(*) AS n FROM tags GROUP BY 1 HAVING ${SHARED("count(DISTINCT brand)")} ORDER BY 2 DESC LIMIT 80),
big AS (SELECT theme, n FROM big0 WHERE ${THEME_OK("theme")} ORDER BY n DESC LIMIT 10),
c AS (
  SELECT t.theme, t.username AS creator, max(t.platform) AS platform, count(*)::int AS posts, sum(coalesce(t.views, 0)) AS views, sum(t.engagement) AS engagement,
         sum(t.eng_s) / NULLIF(sum(t.expected), 0) AS vs, string_agg(DISTINCT t.brand, ', ') AS brands
  FROM tags t JOIN big USING (theme) WHERE t.username IS NOT NULL GROUP BY 1, 2
), r AS (SELECT c.*, row_number() OVER (PARTITION BY theme ORDER BY views DESC, engagement DESC NULLS LAST) AS rk, sum(views) OVER (PARTITION BY theme) AS theme_views FROM c)
SELECT r.theme, r.creator, r.platform, r.posts, ${r0("100.0 * r.views / NULLIF(r.theme_views, 0)")} AS "share of theme views %", ${r2("r.vs")} AS "vs norm", r.brands AS "posts about"
FROM r JOIN big USING (theme) WHERE r.rk <= 3 ORDER BY big.n DESC, r.rk`,
        rationale: "A shortlist per conversation, with who they already work with.",
      },
      {
        type: "table", w: 6, h: 6,
        title: "Who drives buying",
        subtitle: "Creators of our content ranked by buying signals per 1,000 comments on their posts (30+ comments)",
        when: N_COMMENTS,
        sql: `WITH pc AS (SELECT segment_id, post_id, count(*)::float AS n, count(*) FILTER (WHERE purchase_intent_type IS NOT NULL)::float AS intent FROM comments WHERE brand = focal_brand() GROUP BY 1, 2),
avg_rate AS MATERIALIZED (SELECT 1000.0 * sum(intent) / NULLIF(sum(n), 0) AS rate FROM pc)
SELECT p.username AS creator, max(p.platform) AS platform, count(DISTINCT p.post_id)::int AS posts, sum(pc.n)::int AS comments,
       ${r1("1000.0 * sum(pc.intent) / sum(pc.n)")} AS "intent per 1K", ${r1("(1000.0 * sum(pc.intent) / sum(pc.n)) / NULLIF((SELECT rate FROM avg_rate), 0)")} AS "times our average"
FROM posts p JOIN pc ON pc.segment_id = p.segment_id AND pc.post_id = p.post_id
WHERE p.brand = focal_brand() AND p.username IS NOT NULL GROUP BY 1 HAVING sum(pc.n) >= 30 AND sum(pc.intent) > 0 ORDER BY 5 DESC LIMIT 12`,
        sample: OUR_COMMENTS,
        rationale: "Reach is easy to buy. These creators move people toward a purchase.",
      },
      {
        type: "table", w: 6, h: 6,
        title: "Who works with competitors",
        subtitle: "Creators who post about rivals, the ones we share first, ranked by engagement",
        when: N_COMPETITORS,
        sql: `WITH ${SCORED("posts")},
c AS (
  SELECT username AS creator, max(platform) AS platform, count(*) FILTER (WHERE brand = focal_brand())::int AS ours, count(*) FILTER (WHERE brand <> focal_brand())::int AS theirs,
         string_agg(DISTINCT brand, ', ') FILTER (WHERE brand <> focal_brand()) AS rivals, sum(engagement) AS engagement, ${vs()} AS vs
  FROM sp WHERE username IS NOT NULL GROUP BY 1
)
SELECT c.creator, c.platform, CASE WHEN c.ours > 0 THEN 'shared' ELSE 'rivals only' END AS relation, c.ours AS "our posts", c.theirs AS "rival posts", c.rivals, ${r2("c.vs")} AS "vs norm"
FROM c WHERE c.theirs > 0 ORDER BY (c.ours > 0) DESC, c.engagement DESC NULLS LAST LIMIT 15`,
        rationale: "Shared creators are a conflict or an opening. Rivals' best performers are a shortlist.",
      },
      {
        type: "bar", w: 5, h: 5,
        title: "Does performance hold when paid?",
        subtitle: `Engagement versus norm on paid and organic posts, us against the tracked competitors. ${NORM_NOTE}.`,
        when: N_PAID,
        sql: `WITH ${SCORED("posts")}
SELECT CASE WHEN is_paid THEN 'Paid' ELSE 'Organic' END AS kind,
       ${r2(vs("brand = focal_brand()"))} AS us, ${r2(vs("brand <> focal_brand()"))} AS competitors
FROM sp WHERE expected IS NOT NULL GROUP BY 1 ORDER BY 1`,
        x: "kind", format: "decimal",
        rationale: "If paid posts fall below the norm, the audience can tell.",
      },
      {
        type: "table", w: 7, h: 5,
        title: "Rising creators",
        subtitle: `Creators of our content whose views grew, with engagement at 1.2 times the norm or better now. ${VERSUS}.`,
        when: N_HISTORY,
        sql: `WITH ${BOUNDS}, ${WINDOW_POSTS}, ${SCORED("w")},
c AS (
  SELECT username AS creator, max(platform) AS platform, count(*) FILTER (WHERE cur)::int AS posts,
         coalesce(sum(views) FILTER (WHERE cur), 0) AS views_now, coalesce(sum(views) FILTER (WHERE NOT cur), 0) AS views_before, ${vs("cur")} AS vs
  FROM sp WHERE brand = focal_brand() AND username IS NOT NULL GROUP BY 1
)
SELECT c.creator, c.platform, c.posts, c.views_now::bigint AS "views now", c.views_before::bigint AS "views before", ${r2("c.vs")} AS "vs norm"
FROM c WHERE c.posts > 0 AND c.views_now > c.views_before AND c.vs >= 1.2 ORDER BY c.views_now - c.views_before DESC LIMIT 12`,
        rationale: "Worth a conversation before their price catches up.",
      },
      {
        type: "table", w: 6, h: 5,
        title: "Who is good value",
        subtitle: "Modelled creator fees on our content by creator size: cost per 1,000 views and per 100 engagements",
        when: N_FEES,
        sql: `WITH ${SCORED("posts")},
t AS (
  SELECT tier, count(*)::int AS posts, sum((budget_min + budget_max) / 2) AS fee, sum(coalesce(views, 0)) AS views, sum(engagement) AS engagement, ${vs()} AS vs
  FROM sp WHERE brand = focal_brand() AND budget_min IS NOT NULL AND tier IS NOT NULL GROUP BY 1
)
SELECT t.tier AS "creator size", t.posts, ${r0("t.fee / t.posts")} AS "fee per post", ${r2("1000.0 * t.fee / NULLIF(t.views, 0)")} AS "cost per 1K views",
       ${r2("100.0 * t.fee / NULLIF(t.engagement, 0)")} AS "cost per 100 engagements", ${r2("t.vs")} AS "vs norm"
FROM t ORDER BY 5 ASC NULLS LAST`,
        rationale: "The size of creator that buys the most attention for the money.",
      },
      {
        type: "table", w: 6, h: 5,
        title: "Who reaches our buyer",
        subtitle: "Creators of our content with audience data: where their audience is and who it is",
        when: N_AUDIENCE,
        sql: `SELECT i.username AS creator, i.network AS platform, i.followers::bigint AS followers,
       i.audience_countries->0->>'name' AS "top audience country", ${r0("100 * (i.audience_countries->0->>'weight')::float")} AS "share %",
       ${r0("100 * i.audience_female")} AS "women %", count(p.post_id)::int AS "posts about us", coalesce(sum(p.engagement), 0)::bigint AS engagement
FROM influencers i JOIN posts p ON p.segment_id = i.segment_id AND p.influencer_id = i.influencer_id
WHERE i.brand = focal_brand() AND i.audience_countries IS NOT NULL AND jsonb_typeof(i.audience_countries) = 'array'
GROUP BY 1, 2, 3, 4, 5, 6 ORDER BY 8 DESC LIMIT 12`,
        rationale: "Performance only matters if the audience is the buyer.",
      },
    ],
  },
  {
    title: "5. What should we build or fix?",
    when: N_COMMENTS,
    widgets: [
      {
        type: "table", w: 12, h: 6,
        title: "Product priority grid",
        subtitle: "Product attributes in our comments by how often they come up and how people feel about them. Fix first: talked about a lot, liked less than our average. Protect: talked about a lot and liked. Start talking about: liked but rarely mentioned.",
        sql: `WITH ${ATTRIBUTES},
c AS (SELECT comment_id, sentiment, topics FROM comments WHERE brand = focal_brand() AND sentiment IS NOT NULL),
base AS MATERIALIZED (SELECT count(*)::float AS n, (count(*) FILTER (WHERE sentiment = 'positive') - count(*) FILTER (WHERE sentiment = 'negative'))::float / NULLIF(count(*), 0) AS net FROM c),
hit AS (SELECT DISTINCT a.name, c.comment_id, c.sentiment FROM c, unnest(c.topics) AS t(topic), attr a WHERE lower(t.topic) ~ a.pattern),
g AS (
  SELECT name, count(*)::float AS mentions, (count(*) FILTER (WHERE sentiment = 'positive') - count(*) FILTER (WHERE sentiment = 'negative'))::float / count(*) AS net,
         count(*) FILTER (WHERE sentiment = 'negative')::int AS negative
  FROM hit GROUP BY 1 HAVING count(*) >= 5
), med AS MATERIALIZED (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY mentions) AS m FROM g)
SELECT g.name AS attribute, g.mentions::int AS mentions, ${r1("1000.0 * g.mentions / base.n")} AS "per 1K comments", ${r0("100 * g.net")} AS "net sentiment", ${r0("100 * (g.net - base.net)")} AS "against our average", g.negative,
       CASE WHEN g.mentions >= med.m AND g.net < base.net THEN 'Fix first' WHEN g.mentions >= med.m THEN 'Protect'
            WHEN g.net >= base.net THEN 'Start talking about' ELSE 'Watch' END AS priority
FROM g, base, med ORDER BY CASE WHEN g.mentions >= med.m AND g.net < base.net THEN 0 WHEN g.mentions >= med.m THEN 1 WHEN g.net >= base.net THEN 2 ELSE 3 END, g.mentions DESC`,
        sample: OUR_COMMENTS,
        rationale: "Four boxes: what to fix, what to protect, what to start saying, and what to leave.",
      },
      {
        type: "table", w: 7, h: 6,
        title: "What people wish existed",
        subtitle: "Requests for a product change by kind, with the most-liked one verbatim",
        when: N_REQUESTS,
        sql: `WITH q AS (SELECT feature_request_type AS kind, coalesce(feature_request, text) AS said, coalesce(likes, 0) AS likes FROM comments WHERE brand = focal_brand() AND feature_request_type IS NOT NULL),
top AS (SELECT DISTINCT ON (kind) kind, left(said, 160) AS example FROM q ORDER BY kind, likes DESC)
SELECT q.kind AS request, count(*)::int AS comments, sum(q.likes)::int AS likes, top.example FROM q JOIN top USING (kind) GROUP BY q.kind, top.example ORDER BY 2 DESC`,
        sample: OUR_COMMENTS,
        rationale: "The roadmap the audience would write.",
      },
      {
        type: "bar", w: 5, h: 6,
        title: "Requests, us against the rivals",
        subtitle: "Requests for a product change per 1,000 comments by kind: us and the average tracked competitor (competitors with 100+ comments)",
        when: N_REQUESTS,
        sql: `WITH tot AS MATERIALIZED (SELECT brand, count(*)::float AS n FROM comments GROUP BY 1 HAVING count(*) >= 100 OR brand = focal_brand()),
per AS (SELECT brand, feature_request_type AS kind, count(*)::float AS n FROM comments WHERE feature_request_type IS NOT NULL GROUP BY 1, 2),
kinds AS (SELECT DISTINCT kind FROM per),
rates AS (SELECT t.brand, k.kind, 1000.0 * coalesce(p.n, 0) / t.n AS rate FROM tot t CROSS JOIN kinds k LEFT JOIN per p ON p.brand = t.brand AND p.kind = k.kind)
SELECT kind AS request, ${r1("max(rate) FILTER (WHERE brand = focal_brand())")} AS us, ${r1("avg(rate) FILTER (WHERE brand <> focal_brand())")} AS competitors
FROM rates GROUP BY 1 ORDER BY 2 DESC NULLS LAST`,
        x: "request", format: "decimal",
        sample: OUR_COMMENTS,
        rationale: "What our audience asks for more than theirs does.",
      },
      {
        type: "line", w: 7, h: 5,
        title: "What is breaking, and is it getting worse?",
        subtitle: "Objections on our content per 1,000 comments, by month and kind. Ignores the period.",
        when: N_OBJECTIONS,
        period: "all",
        sql: `WITH m AS (SELECT to_char(date_trunc('month', published_at), 'YYYY-MM') AS month, count(*)::float AS n FROM comments_all WHERE brand = focal_brand() AND published_at IS NOT NULL GROUP BY 1 HAVING count(*) >= 50),
o AS MATERIALIZED (SELECT to_char(date_trunc('month', published_at), 'YYYY-MM') AS month, objection_category AS objection, count(*)::float AS n FROM comments_all WHERE brand = focal_brand() AND objection_category IS NOT NULL AND published_at IS NOT NULL GROUP BY 1, 2),
big AS (SELECT objection FROM o GROUP BY 1 ORDER BY sum(n) DESC LIMIT 5)
SELECT m.month, replace(o.objection, '_', ' ') AS objection, ${r1("1000.0 * o.n / m.n")} AS value
FROM m JOIN o USING (month) JOIN big USING (objection) ORDER BY 1`,
        x: "month", y: "value", series: "objection", format: "decimal",
        rationale: "A complaint that grows month after month is a product problem, not a comment.",
      },
      {
        type: "table", w: 5, h: 5,
        title: "How people actually use it",
        subtitle: "Uses people describe in our comments, grouped by who they are",
        when: N_USE_CASES,
        sql: `SELECT use_case_segment AS "who", count(*)::int AS comments, coalesce(sum(likes), 0)::int AS likes, left(min(use_case), 140) AS "an example"
FROM comments WHERE brand = focal_brand() AND use_case_segment IS NOT NULL GROUP BY 1 HAVING count(*) >= 2 ORDER BY 2 DESC LIMIT 12`,
        sample: OUR_COMMENTS,
        rationale: "Uses nobody designed for are the next variant or the next message.",
      },
      {
        type: "table", w: 12, h: 5,
        title: "Where competitor products are weak",
        subtitle: "Each rival's two most frequent objections, per 1,000 of its comments, with an example (rivals with 100+ comments)",
        when: N_COMPETITORS,
        sql: `WITH tot AS MATERIALIZED (SELECT brand, count(*)::float AS n FROM comments WHERE brand <> focal_brand() GROUP BY 1 HAVING count(*) >= 100),
o AS MATERIALIZED (SELECT brand, objection_category AS objection, count(*)::float AS n, max(coalesce(likes, 0)) AS top_likes FROM comments WHERE brand <> focal_brand() AND objection_category IS NOT NULL GROUP BY 1, 2),
r AS (SELECT o.*, row_number() OVER (PARTITION BY o.brand ORDER BY o.n DESC) AS rk FROM o JOIN tot USING (brand)),
ex AS (SELECT DISTINCT ON (brand, objection_category) brand, objection_category AS objection, left(coalesce(objection_phrase, text), 150) AS example FROM comments WHERE brand <> focal_brand() AND objection_category IS NOT NULL ORDER BY brand, objection_category, likes DESC NULLS LAST)
SELECT r.brand, replace(r.objection, '_', ' ') AS objection, r.n::int AS comments, ${r1("1000.0 * r.n / tot.n")} AS "per 1K comments", ex.example
FROM r JOIN tot USING (brand) JOIN ex ON ex.brand = r.brand AND ex.objection = r.objection WHERE r.rk <= 2 ORDER BY tot.n DESC, r.rk`,
        rationale: "Their weaknesses, in their own audience's words.",
      },
    ],
  },
  {
    title: "The monthly read",
    widgets: [
      {
        type: "insight", w: 12, h: 6,
        title: "Strategy insight",
        subtitle: "From the full analysis of posts and comments. Not specific to the selected period.",
        when: HAS_INSIGHT,
        period: "all",
        sql: `SELECT insight_headline AS headline, insight_act AS body FROM segments WHERE brand = focal_brand()`,
        rationale: "The read to check the numbers above against.",
      },
      {
        type: "text", w: 12, h: 3,
        title: "How to read this every month",
        content: `The eight measures at the top are calculated the same way every month. Set the period bar to a month and switch on Compare to see what moved. The Reports page keeps a written review for each month.\n\n- **Engagement versus norm** compares each post with what its platform and creator size normally earn across the tracked brands. 1.0 is the norm.\n- **Themes** ${labels ? "come from what each caption says, from a fixed list for the industry. Hashtags are not needed." : "are the hashtags creators use, with brand names removed."}\n- **Organic share** counts posts with no paid disclosure. The data does not mark brand-owned accounts.\n- Small samples are left out of every table.`,
      },
    ],
  },
];

  if (!labels) return all;

  // With a theme for every post, hooks (how a post is told) become available as well.
  const hooksThatWin: StarterSection["widgets"][number] = {
    type: "bar", w: 6, h: 6,
    title: "Hooks that win",
    subtitle: `Engagement versus norm by how the post is told, us against the tracked competitors (hooks with 5+ posts). ${NORM_NOTE}.`,
    when: N_HOOKS,
    sql: `WITH ${SCORED("posts")},
h AS (SELECT sp.*, ph.hook FROM sp JOIN post_hooks ph ON ph.segment_id = sp.segment_id AND ph.post_id = sp.post_id),
f AS (
  SELECT hook, ${vs("brand = focal_brand()")} AS us, ${vs("brand <> focal_brand()")} AS competitors,
         count(*) FILTER (WHERE brand = focal_brand() AND expected IS NOT NULL) AS n_us, count(*) FILTER (WHERE expected IS NOT NULL) AS n
  FROM h GROUP BY 1
)
SELECT hook, CASE WHEN n_us >= 5 THEN ${r2("us")} END AS us, ${r2("competitors")} AS competitors FROM f WHERE n >= 5 ORDER BY n DESC LIMIT 10`,
    x: "hook", format: "decimal", horizontal: true,
    rationale: "Whether a tutorial, a review or a routine earns more than its platform normally does.",
  };
  const hooksWeUnderUse: StarterSection["widgets"][number] = {
    type: "stacked_bar", w: 12, h: 5,
    title: "Hooks we under-use",
    subtitle: "Share of posts by how they are told: us against the tracked competitors. A post can use more than one hook.",
    when: N_HOOKS,
    sql: `SELECT CASE WHEN brand = focal_brand() THEN 'Us' ELSE 'Competitors' END AS who, hook, count(*)::int AS value
FROM post_hooks GROUP BY 1, 2 ORDER BY 1 DESC, 3 DESC`,
    x: "who", y: "value", series: "hook", normalize: true,
    rationale: "A way of telling the story that works for rivals and that we rarely use.",
  };
  const aboutUs: StarterSection["widgets"][number] = {
    type: "stacked_bar", w: 12, h: 5,
    title: "Is the tracked conversation really about each brand?",
    subtitle: "Share of each brand's tracked posts that are about it, mention it in passing, or are not about it at all, judged from the caption",
    when: N_ABOUT,
    sql: `SELECT brand, CASE about WHEN 'yes' THEN 'About the brand' WHEN 'passing' THEN 'Mentioned in passing' ELSE 'Not about the brand' END AS relevance, count(*)::int AS value
FROM post_about GROUP BY 1, 2 ORDER BY (brand = focal_brand()) DESC, 1, 2`,
    x: "brand", y: "value", series: "relevance", normalize: true, horizontal: true,
    rationale: "Share of voice counts every tracked post. This shows how much of it is real.",
  };
  // Theme elements need classified posts; an industry without them gets a note, not an empty table.
  const needsThemes = new Set(["Themes: growth and performance", "Content gap", "Who drives each theme"]);
  return all.map((sec) => {
    let widgets = sec.widgets.map((w) => (needsThemes.has(w.title) && !w.when ? { ...w, when: N_THEMED } : w));
    if (sec.title.startsWith("1.")) {
      const at = widgets.findIndex((w) => w.title === "Formats that win");
      widgets = [...widgets.slice(0, at + 1), hooksThatWin, ...widgets.slice(at + 1)];
    }
    if (sec.title.startsWith("2.")) widgets = [...widgets, hooksWeUnderUse];
    if (sec.title === "The eight measures") widgets = [...widgets, aboutUs];
    return { ...sec, widgets };
  });
}

/** Tom's Default Template: themes are caption hashtags. */
export const TOM_SECTIONS: StarterSection[] = sections("hashtags");
/** Toms No Hash: the same template with a theme for every post from its caption, plus hooks. */
export const TOM_NOHASH_SECTIONS: StarterSection[] = sections("labels");
