import type { WidgetSpec } from "./widgets";

/**
 * The starter template: a first dashboard that works for any brand in any category.
 *
 * Rules it follows (see docs/starter-template-plan.md):
 *  - no brand, competitor or category words: "us" is focal_brand(), rivals are is_competitor(brand);
 *  - charts use only fixed vocabularies (sentiment, intent stage, objection category, platform,
 *    format, creator size); free text appears only as most-liked verbatims;
 *  - every number has a comparison: the previous period or the tracked competitors;
 *  - rates, not counts, when brands are compared;
 *  - elements and sections that need a signal some brands do not have carry a `when` condition and
 *    are left out at creation when the workspace's data does not reach the minimum.
 */

/** Included only when `sql` (one row, column n, run over all time) returns at least `min`. */
export interface StarterCondition {
  sql: string;
  min: number;
  /** What was missing, for the note to the person: "objection comments". */
  what: string;
}

export type StarterElement = Omit<WidgetSpec, "id" | "layout"> & { w: number; h: number; when?: StarterCondition };

export interface StarterSection {
  title: string;
  when?: StarterCondition;
  widgets: StarterElement[];
}

/** The current period, or the last 90 days of our activity when viewing all time, as (s, e). */
const WINDOW = `SELECT coalesce(period_start(), (SELECT max(published_at) FROM posts_all WHERE brand = focal_brand()) - interval '90 days') AS s,
         coalesce(period_end(), (SELECT max(published_at) FROM posts_all WHERE brand = focal_brand()) + interval '1 second') AS e`;
const VERSUS = "This period versus the one before (the last 90 days versus the 90 before, when viewing all time)";

/** Sample check for comment-based elements: how many analysed comments on our content are in the period. */
const OUR_COMMENTS = { sql: `SELECT count(*)::int AS n FROM comments WHERE brand = focal_brand()`, min: 30, unit: "comments on our content" };
const OUR_POSTS = { sql: `SELECT count(*)::int AS n FROM posts WHERE brand = focal_brand()`, min: 5, unit: "posts about us" };

const N_OBJECTIONS: StarterCondition = { sql: `SELECT count(*)::int AS n FROM comments_all WHERE brand = focal_brand() AND objection_category IS NOT NULL`, min: 50, what: "comments raising an objection" };
const N_REQUESTS: StarterCondition = { sql: `SELECT count(*)::int AS n FROM comments_all WHERE brand = focal_brand() AND feature_request_type IS NOT NULL`, min: 30, what: "comments asking for a product change" };
const N_RISK: StarterCondition = { sql: `SELECT count(*)::int AS n FROM comments_all WHERE brand = focal_brand() AND (safety_complaint_type IS NOT NULL OR crisis_risk_type IS NOT NULL)`, min: 40, what: "safety complaints or backlash flags" };
const N_PAID: StarterCondition = { sql: `SELECT count(*)::int AS n FROM posts_all WHERE brand = focal_brand() AND is_paid`, min: 20, what: "disclosed paid posts" };
const HAS_INSIGHT: StarterCondition = { sql: `SELECT count(*)::int AS n FROM segments WHERE brand = focal_brand() AND insight_headline IS NOT NULL`, min: 1, what: "a precomputed strategy insight" };

export const STARTER_SECTIONS: StarterSection[] = [
  {
    title: "1. How are we doing?",
    widgets: [
      {
        type: "kpi", w: 12, h: 3,
        title: "At a glance",
        subtitle: VERSUS,
        sql: `WITH b AS (${WINDOW}),
cur AS (
  SELECT count(*)::float AS posts, count(DISTINCT influencer_id)::float AS creators, sum(engagement) AS engagement, sum(views) AS views,
         1000.0 * sum(engagement) FILTER (WHERE followers > 0) / NULLIF(sum(followers) FILTER (WHERE followers > 0), 0) AS epf
  FROM posts_all p, b WHERE p.brand = focal_brand() AND p.published_at >= b.s AND p.published_at < b.e
), prev AS (
  SELECT count(*)::float AS posts, count(DISTINCT influencer_id)::float AS creators, sum(engagement) AS engagement, sum(views) AS views,
         1000.0 * sum(engagement) FILTER (WHERE followers > 0) / NULLIF(sum(followers) FILTER (WHERE followers > 0), 0) AS epf
  FROM posts_all p, b WHERE p.brand = focal_brand() AND p.published_at >= b.s - (b.e - b.s) AND p.published_at < b.s
), ci AS (
  SELECT 1000.0 * count(*) FILTER (WHERE purchase_intent_type IS NOT NULL) / NULLIF(count(*), 0) AS v
  FROM comments_all c, b WHERE c.brand = focal_brand() AND c.published_at >= b.s AND c.published_at < b.e
), pi AS (
  SELECT 1000.0 * count(*) FILTER (WHERE purchase_intent_type IS NOT NULL) / NULLIF(count(*), 0) AS v
  FROM comments_all c, b WHERE c.brand = focal_brand() AND c.published_at >= b.s - (b.e - b.s) AND c.published_at < b.s
)
SELECT 'Posts' AS label, cur.posts AS value, prev.posts AS compare, 'compact' AS fmt FROM cur, prev
UNION ALL SELECT 'Creators', cur.creators, prev.creators, 'compact' FROM cur, prev
UNION ALL SELECT 'Engagement', cur.engagement, prev.engagement, 'compact' FROM cur, prev
UNION ALL SELECT 'Views', cur.views, prev.views, 'compact' FROM cur, prev
UNION ALL SELECT 'Eng. per 1K followers', cur.epf, prev.epf, 'decimal' FROM cur, prev
UNION ALL SELECT 'Intent per 1K comments', ci.v, pi.v, 'decimal' FROM ci, pi`,
        rationale: "The headline numbers and whether each one is growing.",
      },
      {
        type: "bar", w: 5, h: 5,
        title: "Share of voice",
        subtitle: "Creator posts per tracked brand",
        sql: `SELECT brand, count(*)::int AS value FROM posts GROUP BY brand ORDER BY value DESC`,
        x: "brand", y: "value", colorBy: "brand", format: "compact", horizontal: true,
        rationale: "How much of the conversation is ours.",
      },
      {
        type: "line", w: 7, h: 5,
        title: "Engagement over time",
        subtitle: "Us against each tracked competitor: by month, or by week inside a short period. Periods with almost no posts are left out.",
        sql: `WITH m AS (
SELECT CASE WHEN period_start() IS NULL OR period_end() IS NULL OR period_end() - period_start() > interval '62 days'
              THEN to_char(date_trunc('month', published_at), 'YYYY-MM')
              ELSE to_char(date_trunc('week', published_at), 'YYYY-MM-DD') END AS bucket,
       brand, sum(engagement) AS value, count(*) AS n
FROM posts WHERE published_at IS NOT NULL GROUP BY 1, 2
), t AS (SELECT bucket, sum(n) AS n FROM m GROUP BY 1)
SELECT m.bucket, m.brand, m.value FROM m JOIN t USING (bucket) WHERE t.n >= 0.05 * (SELECT max(n) FROM t) ORDER BY 1`,
        x: "bucket", y: "value", series: "brand", colorBy: "brand", format: "compact",
        rationale: "Momentum, and who is gaining on whom.",
      },
    ],
  },
  {
    title: "2. What is working?",
    widgets: [
      {
        type: "bar", w: 5, h: 6,
        title: "Where our content lands",
        subtitle: "Engagement per 1,000 followers reached, by platform and format (3+ posts)",
        sql: `SELECT platform || ' · ' || post_type AS content,
       round((1000.0 * sum(engagement) / NULLIF(sum(followers), 0))::numeric, 1) AS value
FROM posts WHERE brand = focal_brand() AND followers > 0 AND platform IS NOT NULL AND post_type IS NOT NULL
GROUP BY 1 HAVING count(*) >= 3 ORDER BY 2 DESC NULLS LAST`,
        x: "content", y: "value", colorBy: "auto", format: "decimal", horizontal: true,
        sample: OUR_POSTS,
        rationale: "Which platform and format earn the most reaction for the audience they reach.",
      },
      {
        type: "table", w: 7, h: 6,
        title: "Creators driving our conversation",
        subtitle: "Ranked by engagement on their posts about us",
        sql: `SELECT username AS creator, platform, tier AS size, count(*)::int AS posts, sum(engagement) AS engagement, sum(views) AS views,
       CASE WHEN bool_or(is_paid) THEN 'paid' ELSE 'organic' END AS kind
FROM posts WHERE brand = focal_brand() AND username IS NOT NULL
GROUP BY 1, 2, 3 ORDER BY engagement DESC NULLS LAST LIMIT 15`,
        rationale: "Who is moving people, and whether we paid them.",
      },
      {
        type: "table", w: 12, h: 6,
        title: "Our top posts",
        subtitle: "The individual posts with the most engagement",
        sql: `SELECT username AS creator, platform, post_type AS format, to_char(published_at, 'YYYY-MM-DD') AS date, left(coalesce(text, title, ''), 90) AS caption,
       likes, comments, views, engagement, CASE WHEN is_paid THEN 'paid' ELSE 'organic' END AS kind, url
FROM posts WHERE brand = focal_brand() ORDER BY engagement DESC NULLS LAST LIMIT 15`,
        rationale: "The content itself: what was said and shown when it worked.",
      },
    ],
  },
  {
    title: "3. What does our audience say?",
    widgets: [
      {
        type: "stacked_bar", w: 6, h: 5,
        title: "Sentiment, us versus competitors",
        subtitle: "Share of analysed comments per brand (brands with 100+ comments)",
        sql: `SELECT brand, sentiment, count(*)::int AS value FROM comments
WHERE sentiment IS NOT NULL AND brand IN (SELECT brand FROM comments WHERE sentiment IS NOT NULL GROUP BY brand HAVING count(*) >= 100 OR brand = focal_brand())
GROUP BY 1, 2 ORDER BY 1`,
        x: "brand", y: "value", series: "sentiment", colorBy: "sentiment", normalize: true, format: "percent",
        sample: OUR_COMMENTS,
        rationale: "How the audience feels about us next to the brands we compete with.",
      },
      {
        type: "bar", w: 6, h: 5,
        title: "Intent to buy, us versus competitors",
        subtitle: "Comments signalling a purchase, per 1,000 comments (brands with 100+ comments)",
        sql: `SELECT brand, round(1000.0 * count(*) FILTER (WHERE purchase_intent_type IS NOT NULL) / NULLIF(count(*), 0), 1) AS value
FROM comments GROUP BY brand HAVING count(*) >= 100 OR brand = focal_brand() ORDER BY value DESC`,
        x: "brand", y: "value", colorBy: "brand", format: "decimal", horizontal: true,
        sample: OUR_COMMENTS,
        rationale: "Whether the conversation sells, as a rate so brand size does not matter.",
      },
      {
        type: "table", w: 12, h: 7,
        title: "In their own words",
        subtitle: "The most-liked comments on our content: loyalty, buying intent, questions and objections",
        sql: `WITH labelled AS (
  SELECT CASE WHEN c.purchase_intent_type IS NOT NULL THEN 'buying intent'
              WHEN c.objection_category IS NOT NULL THEN 'objection'
              WHEN c.faq_topic IS NOT NULL THEN 'question'
              WHEN c.loyalty_type IS NOT NULL THEN 'loyalty' END AS kind,
         left(c.text, 160) AS comment, c.likes, p.username AS on_post_by, p.platform
  FROM comments c JOIN posts_all p ON p.post_id = c.post_id AND p.segment_id = c.segment_id
  WHERE c.brand = focal_brand() AND c.text IS NOT NULL AND length(c.text) >= 12 AND coalesce(c.spam_rate, 0) < 0.5
), ranked AS (
  SELECT *, row_number() OVER (PARTITION BY kind ORDER BY likes DESC NULLS LAST) AS rn FROM labelled WHERE kind IS NOT NULL
)
SELECT kind, comment, likes, on_post_by, platform FROM ranked WHERE rn <= 5
ORDER BY array_position(ARRAY['loyalty', 'buying intent', 'question', 'objection'], kind), likes DESC NULLS LAST`,
        sample: OUR_COMMENTS,
        rationale: "The audience's exact words, the ones other people agreed with most.",
      },
    ],
  },
  {
    title: "4. What should we do next?",
    widgets: [
      {
        type: "table", w: 6, h: 6,
        title: "Questions nobody answered",
        subtitle: "Most-liked questions on our content that received no reply",
        sql: `SELECT left(coalesce(c.faq_phrase, c.text), 150) AS question, c.likes, p.username AS asked_under, p.platform
FROM comments c JOIN posts_all p ON p.post_id = c.post_id AND p.segment_id = c.segment_id
WHERE c.brand = focal_brand() AND c.faq_topic IS NOT NULL AND coalesce(c.reply_count, 0) = 0
ORDER BY c.likes DESC NULLS LAST LIMIT 12`,
        sample: OUR_COMMENTS,
        rationale: "Each one is a caption, a pinned reply or a FAQ entry waiting to be written.",
      },
      {
        type: "table", w: 6, h: 6,
        title: "Creators already talking about us",
        subtitle: "Creators we have never paid, ranked by engagement: a partnership shortlist",
        sql: `SELECT p.username AS creator, p.platform, p.tier AS size, max(p.followers) AS followers, count(*)::int AS posts, sum(p.engagement) AS engagement,
       round((1000.0 * sum(p.engagement) / NULLIF(sum(p.followers), 0))::numeric, 1) AS engagement_per_1k_followers
FROM posts p
WHERE p.brand = focal_brand() AND p.username IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM posts_all x WHERE x.brand = focal_brand() AND x.is_paid AND x.username = p.username)
GROUP BY 1, 2, 3 ORDER BY engagement DESC NULLS LAST LIMIT 15`,
        rationale: "People who talk about us for free and get a reaction.",
      },
      {
        type: "bar", w: 6, h: 6,
        title: "What they push back on",
        subtitle: "Objections per 1,000 comments: us against the average tracked competitor (competitors with 100+ comments)",
        when: N_OBJECTIONS,
        sql: `WITH per AS (
  SELECT brand, objection_category AS objection, count(*)::float AS n FROM comments WHERE objection_category IS NOT NULL GROUP BY 1, 2
), tot AS (
  SELECT brand, count(*)::float AS n FROM comments GROUP BY 1
), cats AS (SELECT DISTINCT objection FROM per),
rates AS (
  SELECT t.brand, k.objection, 1000.0 * coalesce(p.n, 0) / NULLIF(t.n, 0) AS rate, t.n AS comments
  FROM tot t CROSS JOIN cats k LEFT JOIN per p ON p.brand = t.brand AND p.objection = k.objection
)
SELECT objection, 'Us' AS who, round(rate::numeric, 1) AS value FROM rates WHERE brand = focal_brand()
UNION ALL
SELECT objection, 'Competitor average', round(avg(rate)::numeric, 1) FROM rates WHERE is_competitor(brand) AND comments >= 100 GROUP BY 1
ORDER BY 1, 2 DESC`,
        x: "objection", y: "value", series: "who", colorBy: "auto", format: "decimal", horizontal: true,
        sample: OUR_COMMENTS,
        rationale: "Where criticism of us is heavier than the category's, and where it is lighter.",
      },
      {
        type: "table", w: 6, h: 6,
        title: "What they ask us to make",
        subtitle: "Most-liked requests for a product change",
        when: N_REQUESTS,
        sql: `SELECT feature_request_type AS type, left(coalesce(feature_request, text), 150) AS request, likes
FROM comments WHERE brand = focal_brand() AND feature_request_type IS NOT NULL ORDER BY likes DESC NULLS LAST LIMIT 12`,
        rationale: "A product brief written by customers.",
      },
    ],
  },
  {
    title: "5. What changed?",
    widgets: [
      {
        type: "table", w: 12, h: 6,
        title: "Rising and falling creators",
        subtitle: `Engagement on posts about us, by creator. ${VERSUS}`,
        sql: `WITH b AS (${WINDOW}),
c AS (
  SELECT p.username AS creator, max(p.platform) AS platform,
         count(*) FILTER (WHERE p.published_at >= b.s)::int AS posts_now,
         coalesce(sum(p.engagement) FILTER (WHERE p.published_at >= b.s), 0) AS current,
         coalesce(sum(p.engagement) FILTER (WHERE p.published_at < b.s), 0) AS previous
  FROM posts_all p, b
  WHERE p.brand = focal_brand() AND p.username IS NOT NULL AND p.published_at >= b.s - (b.e - b.s) AND p.published_at < b.e
  GROUP BY 1
), r AS (
  SELECT *, current - previous AS change,
         row_number() OVER (ORDER BY current - previous DESC) AS up, row_number() OVER (ORDER BY current - previous ASC) AS down
  FROM c WHERE current <> previous
)
SELECT creator, platform, CASE WHEN change > 0 THEN 'rising' ELSE 'falling' END AS movement, posts_now, current, previous, change
FROM r WHERE (up <= 8 AND change > 0) OR (down <= 8 AND change < 0) ORDER BY change DESC`,
        rationale: "Who gained and who went quiet since the last period.",
      },
    ],
  },
  {
    title: "Is anything going wrong?",
    when: N_RISK,
    widgets: [
      {
        type: "line", w: 6, h: 5,
        title: "Safety complaints and backlash",
        subtitle: "Flagged comments on our content by month",
        sql: `SELECT to_char(date_trunc('month', published_at), 'YYYY-MM') AS month,
       count(*) FILTER (WHERE safety_complaint_type IS NOT NULL)::int AS safety_complaints,
       count(*) FILTER (WHERE crisis_risk_type IS NOT NULL)::int AS backlash_flags
FROM comments_all WHERE brand = focal_brand() AND published_at IS NOT NULL GROUP BY 1 ORDER BY 1`,
        x: "month", colorBy: "auto", format: "number", period: "all",
        rationale: "An early warning. Shown over all time so a rise is visible.",
      },
      {
        type: "table", w: 6, h: 5,
        title: "The complaints, verbatim",
        subtitle: "Most-liked safety complaints and backlash comments",
        sql: `SELECT coalesce(safety_complaint_type, crisis_risk_type) AS type, coalesce(safety_severity, crisis_urgency) AS severity, left(coalesce(crisis_phrase, text), 150) AS comment, likes
FROM comments WHERE brand = focal_brand() AND (safety_complaint_type IS NOT NULL OR crisis_risk_type IS NOT NULL) ORDER BY likes DESC NULLS LAST LIMIT 12`,
        rationale: "What exactly is being said, in case it needs an answer.",
      },
    ],
  },
  {
    title: "How do sponsorships land?",
    when: N_PAID,
    widgets: [
      {
        type: "bar", w: 6, h: 5,
        title: "Paid versus organic",
        subtitle: "Engagement per 1,000 followers reached on posts about us",
        sql: `SELECT CASE WHEN is_paid THEN 'paid' ELSE 'organic' END AS kind, round((1000.0 * sum(engagement) / NULLIF(sum(followers), 0))::numeric, 1) AS value
FROM posts WHERE brand = focal_brand() AND followers > 0 GROUP BY 1 ORDER BY 1`,
        x: "kind", y: "value", colorBy: "auto", format: "decimal", horizontal: true, period: "all",
        rationale: "Whether paid content performs like the organic conversation. Shown over all time.",
      },
      {
        type: "bar", w: 6, h: 5,
        title: "How the audience reads our sponsorships",
        subtitle: "Comments that react to the partnership itself",
        sql: `SELECT partnership_perception AS perception, count(*)::int AS value FROM comments
WHERE brand = focal_brand() AND partnership_perception IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
        x: "perception", y: "value", format: "compact", horizontal: true,
        rationale: "Ad call-outs and scepticism show when sponsorship is wearing thin.",
      },
    ],
  },
  {
    title: "The strategy read",
    when: HAS_INSIGHT,
    widgets: [
      {
        type: "insight", w: 12, h: 6,
        title: "Strategy insight",
        subtitle: "From the full analysis of posts and comments. Not specific to the selected period.",
        sql: `SELECT insight_headline AS headline, insight_act AS body FROM segments WHERE brand = focal_brand()`,
        period: "all",
        rationale: "The recommended actions from the precomputed analysis.",
      },
    ],
  },
];

/** Every starter element as a catalogue entry (for the Add element drawer). */
export function starterCatalog(): Array<Omit<WidgetSpec, "id" | "layout">> {
  return STARTER_SECTIONS.flatMap((s) =>
    s.widgets.map((el) => {
      const { w, h, when, ...spec } = el;
      void w; void h; void when;
      return spec;
    }),
  );
}
