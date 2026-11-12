import { FOCAL_BRAND } from "./brands";
import { DEFAULT_WIDGETS, newId, type WidgetSpec } from "./widgets";

/**
 * Dashboard templates. A template is a list of sections; each section is a header followed by
 * widgets placed left to right on the 12 column grid (wrapping to a new row when full).
 */
export type TemplateId = "default" | "eran" | "blank";

export interface DashboardTemplate {
  id: TemplateId;
  name: string;
  description: string;
  build: () => WidgetSpec[];
}

export type TemplateWidget = Omit<WidgetSpec, "id" | "layout"> & { w: number; h: number };
export interface TemplateSection {
  title: string;
  widgets: TemplateWidget[];
}

export function layoutSections(sections: TemplateSection[]): WidgetSpec[] {
  const out: WidgetSpec[] = [];
  let y = 0;
  for (const s of sections) {
    out.push({ id: newId(), type: "section", title: s.title, layout: { x: 0, y, w: 12, h: 1 } });
    y += 1;
    let x = 0;
    let rowH = 0;
    for (const t of s.widgets) {
      const { w, h, ...spec } = t;
      if (x + w > 12) {
        x = 0;
        y += rowH;
        rowH = 0;
      }
      out.push({ ...spec, id: newId(), layout: { x, y, w, h } });
      x += w;
      rowH = Math.max(rowH, h);
    }
    y += rowH;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Default template (the curated catalog in widgets.ts)                 */
/* ------------------------------------------------------------------ */

/** Lays the default catalog out as a sensible starting grid. */
export function buildDefaultWidgets(): WidgetSpec[] {
  const out: WidgetSpec[] = [];
  let y = 0;
  const place = (idx: number, x: number, w: number, h: number, yy: number) => {
    const d = DEFAULT_WIDGETS[idx];
    out.push({ ...d, id: newId(), layout: { x, y: yy, w, h } });
  };
  const section = (title: string) => {
    out.push({ id: newId(), type: "section", title, layout: { x: 0, y, w: 12, h: 1 } });
    y += 1;
  };
  section("Overview");
  place(0, 0, 12, 3, y); y += 3;
  place(1, 0, 5, 5, y); place(2, 5, 7, 5, y); y += 5;
  section("What audiences say");
  place(3, 0, 6, 5, y); place(4, 6, 6, 5, y); y += 5;
  place(5, 0, 6, 5, y); place(6, 6, 6, 5, y); y += 5;
  section("Creators and markets");
  place(7, 0, 6, 5, y); place(8, 6, 6, 5, y); y += 5;
  place(9, 0, 12, 6, y); y += 6;
  section("Risk and strategy");
  place(10, 0, 6, 5, y); place(11, 6, 6, 5, y); y += 5;
  return out;
}

/* ------------------------------------------------------------------ */
/* Eran's template: eight strategic questions, each answered from data  */
/* ------------------------------------------------------------------ */

const B = FOCAL_BRAND.name;
/** Mentions of the focal brand itself (and its parent brand name) are not partners or competitors. */
export const NOT_SELF = (col: string) => `${col} NOT ILIKE '%${B}%' AND ${col} NOT ILIKE '%gil%ette%'`;
/**
 * "Right now" means the dashboard period when one is selected, otherwise the last 90 days of
 * tracked activity for the focal brand. Inside the posts/comments views (already filtered to the
 * period) the 90 day cut only bites when no period is set.
 */
const RECENT_POSTS = `published_at >= coalesce(period_start(), (SELECT max(published_at) FROM posts WHERE brand = '${B}') - interval '90 days')`;
const RECENT_LABEL = "In the selected period (last 90 days when viewing all time)";

/* ------------------------------------------------------------------ */
/* What changed: elements that compare the period with the one before   */
/* ------------------------------------------------------------------ */

/**
 * Current window [s, e) and the start of the previous window (ps). With a dashboard period the
 * current window is that period and the previous one is the month before (whole months) or the
 * same length before; with no period it is the last 90 days of the table's data and the 90 before.
 */
const CHANGE_BOUNDS = (table: "posts_all" | "comments_all") => `b0 AS (
  SELECT coalesce(period_start(), (SELECT max(published_at) FROM ${table} WHERE brand = '${B}') - interval '90 days') AS s,
         coalesce(period_end(), (SELECT max(published_at) FROM ${table} WHERE brand = '${B}') + interval '1 second') AS e
), b AS (
  SELECT s, e, CASE WHEN s = date_trunc('month', s) AND e = s + interval '1 month' THEN s - interval '1 month' ELSE s - (e - s) END AS ps FROM b0
)`;
const CHANGE_LABEL = "This period versus the one before (last 90 days versus the 90 before, when viewing all time)";

/** "What changed" catalogue: each element computes its own movement, so it works without the compare toggle. */
export const CHANGE_WIDGETS: Omit<WidgetSpec, "id" | "layout">[] = [
  {
    type: "table",
    title: "Rising and falling creators",
    subtitle: `Engagement on ${B} posts by creator. ${CHANGE_LABEL}`,
    sql: `WITH ${CHANGE_BOUNDS("posts_all")},
agg AS (
  SELECT p.username AS creator, max(p.platform) AS platform,
    coalesce(sum(p.engagement) FILTER (WHERE p.published_at >= b.s), 0)::float AS current,
    coalesce(sum(p.engagement) FILTER (WHERE p.published_at < b.s), 0)::float AS previous,
    count(*) FILTER (WHERE p.published_at >= b.s)::int AS posts_now
  FROM posts_all p, b WHERE p.brand = '${B}' AND p.published_at >= b.ps AND p.published_at < b.e
  GROUP BY 1
), r AS (SELECT *, current - previous AS change FROM agg)
SELECT * FROM (
  (SELECT creator, platform, 'rising' AS movement, posts_now, current, previous, change,
     round((100 * change / NULLIF(previous, 0))::numeric, 0)::float AS change_pct FROM r WHERE change > 0 ORDER BY change DESC LIMIT 10)
  UNION ALL
  (SELECT creator, platform, 'falling', posts_now, current, previous, change,
     round((100 * change / NULLIF(previous, 0))::numeric, 0)::float FROM r WHERE change < 0 ORDER BY change ASC LIMIT 10)
) u ORDER BY change DESC`,
    format: "compact",
    rationale: "Who gained and who lost the most engagement since the previous period.",
  },
  {
    type: "bar",
    title: "Topics rising and falling",
    subtitle: `Change in each topic's share of ${B} comments, in percentage points. ${CHANGE_LABEL}`,
    sql: `WITH ${CHANGE_BOUNDS("comments_all")},
c AS (
  SELECT c.topics, c.published_at >= b.s AS cur FROM comments_all c, b
  WHERE c.brand = '${B}' AND c.published_at >= b.ps AND c.published_at < b.e AND c.topics IS NOT NULL
), tot AS (SELECT count(*) FILTER (WHERE cur)::float AS nc, count(*) FILTER (WHERE NOT cur)::float AS np FROM c),
t AS (SELECT topic, count(*) FILTER (WHERE cur)::int AS current, count(*) FILTER (WHERE NOT cur)::int AS previous FROM c, unnest(c.topics) AS topic GROUP BY 1),
r AS (
  SELECT t.topic, round((100.0 * t.current / NULLIF(tot.nc, 0) - 100.0 * t.previous / NULLIF(tot.np, 0))::numeric, 1)::float AS value, t.current, t.previous
  FROM t, tot WHERE t.current + t.previous >= 5
)
SELECT * FROM (
  (SELECT * FROM r WHERE value > 0 ORDER BY value DESC LIMIT 6)
  UNION ALL
  (SELECT * FROM r WHERE value < 0 ORDER BY value ASC LIMIT 6)
) u ORDER BY value DESC`,
    x: "topic", y: "value", format: "number", horizontal: true,
    rationale: "What the audience talks about more, and less, than before (share, so overall volume does not hide it).",
  },
  {
    type: "bar",
    title: "Objections rising and falling",
    subtitle: `Change in the number of ${B} comments raising each objection. ${CHANGE_LABEL}`,
    sql: `WITH ${CHANGE_BOUNDS("comments_all")},
t AS (
  SELECT c.objection_category AS objection,
    count(*) FILTER (WHERE c.published_at >= b.s)::int AS current,
    count(*) FILTER (WHERE c.published_at < b.s)::int AS previous
  FROM comments_all c, b
  WHERE c.brand = '${B}' AND c.objection_category IS NOT NULL AND c.published_at >= b.ps AND c.published_at < b.e
  GROUP BY 1
)
SELECT objection, current - previous AS value, current, previous FROM t WHERE current <> previous ORDER BY value DESC`,
    x: "objection", y: "value", format: "number", horizontal: true,
    rationale: "Criticism that is growing needs an answer before it spreads; falling objections show what worked.",
  },
  {
    type: "table",
    title: "Unanswered questions on the rise",
    subtitle: `Question topics in ${B} comments with no reply, growing since the previous period. ${CHANGE_LABEL}`,
    sql: `WITH ${CHANGE_BOUNDS("comments_all")},
q AS (
  SELECT c.faq_topic AS topic, c.published_at >= b.s AS cur, c.likes, coalesce(c.faq_phrase, c.text) AS question
  FROM comments_all c, b
  WHERE c.brand = '${B}' AND c.faq_topic IS NOT NULL AND coalesce(c.reply_count, 0) = 0 AND c.published_at >= b.ps AND c.published_at < b.e
), t AS (
  SELECT topic, count(*) FILTER (WHERE cur)::int AS current, count(*) FILTER (WHERE NOT cur)::int AS previous,
    left((array_agg(question ORDER BY likes DESC NULLS LAST) FILTER (WHERE cur))[1], 120) AS example
  FROM q GROUP BY 1
)
SELECT topic, current, previous, current - previous AS change, example FROM t WHERE current > previous ORDER BY change DESC, current DESC LIMIT 12`,
    rationale: "Questions people ask more often than before and nobody answers: content and FAQ entries to write first.",
  },
];

const ERAN_SECTIONS: TemplateSection[] = [
  {
    title: "1. What is driving the conversation about us right now? Creators, creatives and channels",
    widgets: [
      {
        type: "kpi", w: 12, h: 3,
        title: `${B} conversation in this period`,
        subtitle: "Versus the previous period of the same length (last 90 days versus the 90 before, when viewing all time)",
        sql: `WITH b AS (
  SELECT coalesce(period_start(), (SELECT max(published_at) FROM posts_all WHERE brand = '${B}') - interval '90 days') AS s,
         coalesce(period_end(), (SELECT max(published_at) FROM posts_all WHERE brand = '${B}') + interval '1 second') AS e
), cur AS (
  SELECT count(*)::float AS posts, count(DISTINCT influencer_id)::float AS creators, sum(engagement) AS engagement, sum(views) AS views
  FROM posts_all, b WHERE brand = '${B}' AND published_at >= b.s AND published_at < b.e
), prev AS (
  SELECT count(*)::float AS posts, count(DISTINCT influencer_id)::float AS creators, sum(engagement) AS engagement, sum(views) AS views
  FROM posts_all, b WHERE brand = '${B}' AND published_at >= b.s - (b.e - b.s) AND published_at < b.s
), cm AS (
  SELECT count(*)::float AS n FROM comments_all, b WHERE brand = '${B}' AND published_at >= b.s AND published_at < b.e
), cmp AS (
  SELECT count(*)::float AS n FROM comments_all, b WHERE brand = '${B}' AND published_at >= b.s - (b.e - b.s) AND published_at < b.s
)
SELECT 'Posts' AS label, cur.posts AS value, prev.posts AS compare, 'compact' AS fmt FROM cur, prev
UNION ALL SELECT 'Creators', cur.creators, prev.creators, 'compact' FROM cur, prev
UNION ALL SELECT 'Engagement', cur.engagement, prev.engagement, 'compact' FROM cur, prev
UNION ALL SELECT 'Views', cur.views, prev.views, 'compact' FROM cur, prev
UNION ALL SELECT 'Comments', cm.n, cmp.n, 'compact' FROM cm, cmp`,
        rationale: "Is the conversation growing or fading, and on which dimension.",
      },
      {
        type: "table", w: 7, h: 6,
        title: "Creators driving the conversation",
        subtitle: `${RECENT_LABEL}, ranked by engagement on their posts`,
        sql: `SELECT p.username AS creator, p.platform, p.tier, count(*)::int AS posts, sum(p.engagement) AS engagement, sum(p.views) AS views,
  count(c.comment_id)::int AS comments, bool_or(p.is_paid) AS paid
FROM posts p LEFT JOIN comments c ON c.post_id = p.post_id AND c.segment_id = p.segment_id
WHERE p.brand = '${B}' AND p.${RECENT_POSTS}
GROUP BY 1, 2, 3 ORDER BY engagement DESC NULLS LAST LIMIT 15`,
        rationale: "Who is actually moving people right now, and whether we paid them.",
      },
      {
        type: "bar", w: 5, h: 6,
        title: "Channels driving the conversation",
        subtitle: `Engagement by platform. ${RECENT_LABEL}`,
        sql: `SELECT platform, sum(engagement) AS value FROM posts WHERE brand = '${B}' AND ${RECENT_POSTS} GROUP BY 1 ORDER BY 2 DESC`,
        x: "platform", y: "value", colorBy: "platform", format: "compact", horizontal: true,
        rationale: "Where the conversation is happening.",
      },
      {
        type: "table", w: 12, h: 6,
        title: "Creatives driving the conversation",
        subtitle: `The individual posts with the most engagement. ${RECENT_LABEL}`,
        sql: `SELECT username AS creator, platform, post_type AS format, to_char(published_at, 'YYYY-MM-DD') AS date, left(coalesce(text, title, ''), 90) AS caption,
  likes, comments, views, engagement, CASE WHEN is_paid THEN 'paid' ELSE 'organic' END AS kind, url
FROM posts WHERE brand = '${B}' AND ${RECENT_POSTS} ORDER BY engagement DESC NULLS LAST LIMIT 15`,
        rationale: "The content itself: what format and what message is winning.",
      },
    ],
  },
  {
    title: "2. Where does the conversation show real intent to buy, and from whom?",
    widgets: [
      {
        type: "stacked_bar", w: 5, h: 6,
        title: "Purchase intent by platform",
        subtitle: `${B} comments flagged with buying intent, by stage`,
        sql: `SELECT p.platform, c.purchase_intent_type AS stage, count(*)::int AS value
FROM comments c JOIN posts p ON p.post_id = c.post_id AND p.segment_id = c.segment_id
WHERE c.brand = '${B}' AND c.purchase_intent_type IS NOT NULL GROUP BY 1, 2 ORDER BY 1`,
        x: "platform", y: "value", series: "stage", colorBy: "auto", format: "compact",
        rationale: "Explicit intent is the strongest conversion signal; this shows which channel produces it.",
      },
      {
        type: "table", w: 7, h: 6,
        title: "Whose audiences want to buy",
        subtitle: "Creators whose posts attract the most buying-intent comments",
        sql: `SELECT p.username AS creator, p.platform, p.tier,
  count(*) FILTER (WHERE c.purchase_intent_type = 'explicit')::int AS explicit,
  count(*) FILTER (WHERE c.purchase_intent_type = 'aspirational')::int AS aspirational,
  count(*) FILTER (WHERE c.purchase_intent_type = 'conditional')::int AS conditional,
  count(*)::int AS intent_comments,
  round((count(*)::numeric / NULLIF(count(DISTINCT p.post_id), 0)), 1) AS per_post
FROM comments c JOIN posts p ON p.post_id = c.post_id AND p.segment_id = c.segment_id
WHERE c.brand = '${B}' AND c.purchase_intent_type IS NOT NULL
GROUP BY 1, 2, 3 ORDER BY intent_comments DESC LIMIT 15`,
        rationale: "The creators whose followers are closest to purchase.",
      },
      {
        type: "table", w: 12, h: 6,
        title: "Intent in their own words",
        subtitle: "Most-liked buying-intent comments, with the blocker when one is mentioned",
        sql: `SELECT c.purchase_intent_type AS stage, left(c.text, 140) AS comment, c.purchase_blocker AS blocker, c.likes, p.username AS on_post_by, p.platform
FROM comments c JOIN posts p ON p.post_id = c.post_id AND p.segment_id = c.segment_id
WHERE c.brand = '${B}' AND c.purchase_intent_type IS NOT NULL
ORDER BY c.likes DESC NULLS LAST LIMIT 15`,
        rationale: "Verbatim intent, and what stands between intent and purchase.",
      },
    ],
  },
  {
    title: "3. What does the audience love that we should keep doing?",
    widgets: [
      {
        type: "bar", w: 5, h: 6,
        title: "What positive comments are about",
        subtitle: `Top topics in positive ${B} comments`,
        sql: `SELECT topic, count(*)::int AS value
FROM comments, unnest(topics) AS topic
WHERE brand = '${B}' AND sentiment = 'positive' AND topics IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
        x: "topic", y: "value", format: "compact", horizontal: true,
        rationale: "The themes the audience responds to best.",
      },
      {
        type: "bar", w: 7, h: 6,
        title: "Content that earns the warmest reaction",
        subtitle: "Share of positive comments by post format and platform (posts with 20+ comments)",
        sql: `SELECT p.platform || ' · ' || p.post_type AS content,
  round(100.0 * count(*) FILTER (WHERE c.sentiment = 'positive') / NULLIF(count(*), 0), 1) AS value
FROM comments c JOIN posts p ON p.post_id = c.post_id AND p.segment_id = c.segment_id
WHERE c.brand = '${B}' AND c.sentiment IS NOT NULL
GROUP BY 1 HAVING count(*) >= 20 ORDER BY 2 DESC`,
        x: "content", y: "value", colorBy: "auto", format: "number", horizontal: true,
        rationale: "Which formats make people happy, not just loud.",
      },
      {
        type: "bar", w: 5, h: 5,
        title: "Loyalty signals",
        subtitle: `How ${B} loyalists describe themselves`,
        sql: `SELECT loyalty_type AS signal, count(*)::int AS value FROM comments WHERE brand = '${B}' AND loyalty_type IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`,
        x: "signal", y: "value", format: "compact", horizontal: true,
        rationale: "Advocacy and repeat buying are the behaviours to protect.",
      },
      {
        type: "table", w: 7, h: 5,
        title: "What fans say we get right",
        subtitle: "Most-liked loyalty and praise comments",
        sql: `SELECT coalesce(c.loyalty_type, 'praise') AS signal, left(coalesce(c.loyalty_phrase, c.text), 140) AS comment, c.likes, p.username AS on_post_by
FROM comments c JOIN posts p ON p.post_id = c.post_id AND p.segment_id = c.segment_id
WHERE c.brand = '${B}' AND (c.loyalty_type IS NOT NULL OR ('praise' = ANY(c.topics) AND c.sentiment = 'positive'))
ORDER BY c.likes DESC NULLS LAST LIMIT 12`,
        rationale: "Verbatims to reuse in messaging and briefs.",
      },
    ],
  },
  {
    title: "4. What is the audience ignoring or pushing back on?",
    widgets: [
      {
        type: "bar", w: 6, h: 6,
        title: "What they push back on",
        subtitle: `Objections in ${B} comments, by category`,
        sql: `SELECT objection_category AS objection, count(*)::int AS value FROM comments WHERE brand = '${B}' AND objection_category IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`,
        x: "objection", y: "value", format: "compact", horizontal: true,
        rationale: "Where the criticism concentrates.",
      },
      {
        type: "bar", w: 6, h: 6,
        title: "How sponsorships land",
        subtitle: `Partnership perception in ${B} comments`,
        sql: `SELECT partnership_perception AS perception, count(*)::int AS value FROM comments WHERE brand = '${B}' AND partnership_perception IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`,
        x: "perception", y: "value", format: "compact", horizontal: true,
        rationale: "Ad call-outs and scepticism are the audience pushing back on the format itself.",
      },
      {
        type: "table", w: 7, h: 6,
        title: "What they ignore",
        subtitle: "Posts by format with the lowest engagement per view (posts with 5,000+ views)",
        sql: `SELECT platform, post_type AS format, CASE WHEN is_paid THEN 'paid' ELSE 'organic' END AS kind, count(*)::int AS posts,
  round((1000.0 * sum(engagement) / NULLIF(sum(views), 0))::numeric, 1) AS engagement_per_1k_views,
  round((1000.0 * sum(comments) / NULLIF(sum(views), 0))::numeric, 2) AS comments_per_1k_views
FROM posts WHERE brand = '${B}' AND views >= 5000
GROUP BY 1, 2, 3 HAVING count(*) >= 5 ORDER BY engagement_per_1k_views ASC`,
        rationale: "Content people scroll past: seen a lot, reacted to little.",
      },
      {
        type: "table", w: 5, h: 6,
        title: "Push-back in their own words",
        subtitle: "Most-liked objection comments",
        sql: `SELECT objection_category AS objection, left(coalesce(objection_phrase, text), 120) AS comment, likes
FROM comments WHERE brand = '${B}' AND objection_category IS NOT NULL ORDER BY likes DESC NULLS LAST LIMIT 12`,
        rationale: "The exact wording of the criticism.",
      },
    ],
  },
  {
    title: "5. What are people asking for that nobody is answering yet?",
    widgets: [
      {
        type: "bar", w: 5, h: 6,
        title: "Unanswered question topics",
        subtitle: `Questions in ${B} comments that received no reply`,
        sql: `SELECT faq_topic AS topic, count(*)::int AS value FROM comments
WHERE brand = '${B}' AND faq_topic IS NOT NULL AND coalesce(reply_count, 0) = 0 GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
        x: "topic", y: "value", format: "compact", horizontal: true,
        rationale: "Questions the brand could answer in captions, pinned comments or on the product page.",
      },
      {
        type: "table", w: 7, h: 6,
        title: "The questions, verbatim",
        subtitle: "Most-liked unanswered questions and where they were asked",
        sql: `SELECT c.faq_topic AS topic, left(coalesce(c.faq_phrase, c.text), 140) AS question, c.likes, p.username AS asked_under, p.platform
FROM comments c JOIN posts p ON p.post_id = c.post_id AND p.segment_id = c.segment_id
WHERE c.brand = '${B}' AND c.faq_topic IS NOT NULL AND coalesce(c.reply_count, 0) = 0
ORDER BY c.likes DESC NULLS LAST LIMIT 15`,
        rationale: "Each of these is a piece of content or a FAQ entry waiting to be written.",
      },
    ],
  },
  {
    title: "6. What product or service is the conversation asking us to build?",
    widgets: [
      {
        type: "bar", w: 5, h: 6,
        title: "Feature requests by type",
        subtitle: `What ${B} commenters ask the product to do`,
        sql: `SELECT feature_request_type AS request, count(*)::int AS value FROM comments WHERE brand = '${B}' AND feature_request_type IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`,
        x: "request", y: "value", format: "compact", horizontal: true,
        rationale: "Variants, formats and sizes the audience is asking for.",
      },
      {
        type: "table", w: 7, h: 6,
        title: "Requests, verbatim",
        subtitle: "Most-liked feature requests",
        sql: `SELECT feature_request_type AS type, left(coalesce(feature_request, text), 140) AS request, likes
FROM comments WHERE brand = '${B}' AND feature_request_type IS NOT NULL ORDER BY likes DESC NULLS LAST LIMIT 15`,
        rationale: "The product brief, written by customers.",
      },
      {
        type: "table", w: 12, h: 5,
        title: "Blockers we could remove",
        subtitle: "What stops people who already want to buy",
        sql: `SELECT purchase_blocker AS blocker, count(*)::int AS comments, sum(likes) AS likes_on_them, left(min(text), 120) AS example
FROM comments WHERE brand = '${B}' AND purchase_blocker IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
        rationale: "Service and availability gaps that cost sales today.",
      },
    ],
  },
  {
    title: "7. What new need is emerging in the conversation that no brand owns yet?",
    widgets: [
      {
        type: "table", w: 7, h: 6,
        title: "Emerging needs across the category",
        subtitle: "Non-standard use cases people describe, across all brands, and how many brands they appear under",
        sql: `SELECT use_case_segment AS need, count(*)::int AS comments, count(DISTINCT brand)::int AS brands_mentioned,
  string_agg(DISTINCT brand, ', ') AS brands, left(min(use_case), 110) AS example
FROM comments WHERE use_case_segment IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
        rationale: "Needs spread across several brands belong to nobody yet.",
      },
      {
        type: "bar", w: 5, h: 6,
        title: "Requests no brand answers",
        subtitle: "Feature requests by type, all brands combined",
        sql: `SELECT feature_request_type AS request, count(*)::int AS value FROM comments WHERE feature_request_type IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`,
        x: "request", y: "value", format: "compact", horizontal: true,
        rationale: "Category-wide gaps, not just ours.",
      },
      {
        type: "line", w: 12, h: 5,
        title: "Category questions over time",
        subtitle: "Monthly unanswered-question comments across all brands, by topic (top 5 topics)",
        sql: `WITH norm AS (SELECT published_at, replace(lower(faq_topic), ' ', '_') AS faq_topic FROM comments WHERE faq_topic IS NOT NULL),
 top AS (SELECT faq_topic FROM norm GROUP BY 1 ORDER BY count(*) DESC LIMIT 5)
SELECT to_char(date_trunc('month', c.published_at), 'YYYY-MM') AS month, c.faq_topic AS topic, count(*)::int AS value
FROM norm c JOIN top ON top.faq_topic = c.faq_topic
WHERE c.published_at >= '2025-10-01' AND c.published_at < '2026-09-01'
GROUP BY 1, 2 ORDER BY 1`,
        x: "month", y: "value", series: "topic", colorBy: "auto", format: "number",
        rationale: "A need that is rising month on month is one to claim early.",
      },
    ],
  },
  {
    title: "8. Which creators, brands and partners are already part of our conversation, and who should we partner with?",
    widgets: [
      {
        type: "table", w: 7, h: 6,
        title: "Creators to partner with",
        subtitle: `Organic ${B} creators (never paid) with the strongest engagement`,
        sql: `SELECT p.username AS creator, p.platform, p.tier, max(p.followers) AS followers, count(*)::int AS organic_posts,
  sum(p.engagement) AS engagement, round((avg(p.engagement) / NULLIF(max(p.followers), 0) * 100)::numeric, 2) AS eng_rate_per_post_pct, max(p.country) AS country
FROM posts p
WHERE p.brand = '${B}' AND p.influencer_id NOT IN (SELECT influencer_id FROM posts WHERE brand = '${B}' AND is_paid)
GROUP BY 1, 2, 3 HAVING count(*) >= 2 ORDER BY engagement DESC NULLS LAST LIMIT 15`,
        rationale: "People already talking about us for free, with an audience that responds.",
      },
      {
        type: "table", w: 5, h: 6,
        title: "Brands our audience already loves",
        subtitle: `Other brands named with affinity in ${B} comments`,
        sql: `SELECT brand_affinity_name AS brand, brand_affinity_category AS category, count(*)::int AS mentions
FROM comments WHERE brand = '${B}' AND brand_affinity_name IS NOT NULL AND ${NOT_SELF("brand_affinity_name")}
  AND brand_affinity_name NOT ILIKE ALL (ARRAY['%unspecified%', '%unnamed%', '%unknown%', 'this brand', 'none', 'n/a'])
GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 15`,
        rationale: "Co-marketing and bundle candidates that the audience has pre-approved.",
      },
      {
        type: "table", w: 6, h: 6,
        title: "Competitors already in our conversation",
        subtitle: `Brands commenters compare us with under ${B} content`,
        sql: `SELECT competitor_name AS brand, count(*)::int AS mentions,
  count(*) FILTER (WHERE competitor_favored = 'competitor')::int AS prefers_them,
  count(*) FILTER (WHERE competitor_favored = 'focal_brand')::int AS prefers_us
FROM comments WHERE brand = '${B}' AND competitor_name IS NOT NULL AND competitor_mention_type IN ('preference', 'comparison') AND ${NOT_SELF("competitor_name")}
GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
        rationale: "Who we are measured against, and whether we win the comparison.",
      },
      {
        type: "table", w: 6, h: 6,
        title: "Creators who already cover the category",
        subtitle: `Creators posting about ${B} and at least one competitor`,
        sql: `SELECT username AS creator, max(platform) AS platform, count(DISTINCT brand)::int AS brands, string_agg(DISTINCT brand, ', ') AS covers,
  sum(engagement) AS engagement, max(followers) AS followers
FROM posts WHERE username IN (SELECT username FROM posts WHERE brand = '${B}')
GROUP BY 1 HAVING count(DISTINCT brand) >= 2 ORDER BY engagement DESC NULLS LAST LIMIT 15`,
        rationale: "Category voices worth owning before a competitor does.",
      },
    ],
  },
  {
    title: "9. What changed since the previous period?",
    widgets: [
      { ...CHANGE_WIDGETS[0], w: 12, h: 6 },
      { ...CHANGE_WIDGETS[1], w: 6, h: 6 },
      { ...CHANGE_WIDGETS[2], w: 6, h: 6 },
      { ...CHANGE_WIDGETS[3], w: 12, h: 5 },
    ],
  },
];

export const TEMPLATES: DashboardTemplate[] = [
  {
    id: "default",
    name: "Default template",
    description: "Twelve curated elements: share of voice, trends, sentiment, intent, objections, competitors, creators, markets, top posts, risk, strategy insight.",
    build: buildDefaultWidgets,
  },
  {
    id: "eran",
    name: "Eran's template",
    description: "Eight strategic questions, each answered with data: what drives the conversation, where intent to buy shows, what the audience loves, ignores or pushes back on, unanswered questions, what to build, emerging needs, and who to partner with. Ends with what changed since the previous period.",
    build: () => layoutSections(ERAN_SECTIONS),
  },
  {
    id: "blank",
    name: "Blank",
    description: "Start empty and build it with the assistant.",
    build: () => [],
  },
];

export const TEMPLATE_IDS = TEMPLATES.map((t) => t.id);
export function isTemplateId(v: unknown): v is TemplateId {
  return typeof v === "string" && (TEMPLATE_IDS as string[]).includes(v);
}
export function buildTemplate(id: TemplateId): WidgetSpec[] {
  return (TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]).build();
}
