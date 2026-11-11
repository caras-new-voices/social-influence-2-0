import { z } from "zod";

/**
 * A widget is a saved query plus a rendering recipe. The chat assistant proposes
 * widgets in this exact shape; the dashboard stores them as JSON.
 */
export const WIDGET_TYPES = ["kpi", "line", "bar", "stacked_bar", "segmented", "table", "text", "section", "insight"] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export const LayoutSchema = z.object({
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0),
  w: z.number().int().min(2).max(12),
  h: z.number().int().min(1).max(12),
});
export type WidgetLayout = z.infer<typeof LayoutSchema>;

export const WidgetSpecSchema = z.object({
  id: z.string().min(1),
  type: z.enum(WIDGET_TYPES),
  title: z.string().min(1).max(120),
  subtitle: z.string().max(240).optional(),
  /** Read-only SQL (Postgres) returning the rows to render. Required for data widgets. */
  sql: z.string().max(12000).optional(),
  /** Column used for the x axis / category (bar, line, stacked_bar, segmented). */
  x: z.string().optional(),
  /** Value column. Default "value". */
  y: z.string().optional(),
  /** Column whose distinct values become series (long format). When omitted every numeric column except x is a series. */
  series: z.string().optional(),
  colorBy: z.enum(["brand", "platform", "sentiment", "tier", "auto"]).optional(),
  format: z.enum(["number", "compact", "percent", "currency", "decimal"]).optional(),
  horizontal: z.boolean().optional(),
  /** Normalise each category to 100 percent (stacked bars). */
  normalize: z.boolean().optional(),
  /** Free text (notes, section headers, insight cards). Simple markdown: **bold**, bullet lines starting with "- ". */
  content: z.string().max(8000).optional(),
  /** Why this widget was proposed; shown in the proposal card. */
  rationale: z.string().max(600).optional(),
  layout: LayoutSchema,
});
export type WidgetSpec = z.infer<typeof WidgetSpecSchema>;

/** The shape the model fills in (id and layout.y are assigned server-side). */
export const ProposedWidgetSchema = WidgetSpecSchema.omit({ id: true, layout: true }).extend({
  /** Width in grid columns (12 column grid). */
  width: z.number().int().min(3).max(12).optional(),
  /** Height in grid rows (1 row = 56px). */
  height: z.number().int().min(2).max(10).optional(),
});
export type ProposedWidget = z.infer<typeof ProposedWidgetSchema>;

export const DATA_WIDGET_TYPES: WidgetType[] = ["kpi", "line", "bar", "stacked_bar", "segmented", "table", "insight"];
export function isDataWidget(type: WidgetType) {
  return DATA_WIDGET_TYPES.includes(type);
}

export function defaultSize(type: WidgetType): { w: number; h: number } {
  switch (type) {
    case "kpi": return { w: 12, h: 3 };
    case "section": return { w: 12, h: 1 };
    case "text": return { w: 4, h: 3 };
    case "insight": return { w: 6, h: 6 };
    case "table": return { w: 12, h: 6 };
    case "line": return { w: 8, h: 5 };
    default: return { w: 6, h: 5 };
  }
}

export function newId(prefix = "w") {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

/** Finds the first free y under existing widgets (simple bottom placement). */
export function nextY(widgets: WidgetSpec[]): number {
  return widgets.reduce((m, w) => Math.max(m, w.layout.y + w.layout.h), 0);
}

export function materialize(p: ProposedWidget, existing: WidgetSpec[]): WidgetSpec {
  const size = defaultSize(p.type);
  const w = p.width ?? size.w;
  const h = p.height ?? size.h;
  const { width: _w, height: _h, ...rest } = p;
  void _w; void _h;
  return { ...rest, id: newId(), layout: { x: 0, y: nextY(existing), w, h } };
}

export interface DashboardRecord {
  id: string;
  name: string;
  description: string | null;
  widgets: WidgetSpec[];
  created_at: string;
  updated_at: string;
}

/* ------------------------------------------------------------------ */
/* Default widget catalog (grounded in the preloaded dataset)          */
/* ------------------------------------------------------------------ */

const VENUS_KPI_SQL = `WITH focal AS (
  SELECT count(*)::float AS posts, count(DISTINCT influencer_id)::float AS creators,
         sum(views) AS views, sum(engagement) AS engagement, sum(emv) AS emv,
         sum(engagement) / NULLIF(sum(views), 0) AS eng_rate
  FROM posts WHERE brand = 'Venus'
), comp AS (
  SELECT avg(posts) AS posts, avg(creators) AS creators, avg(views) AS views, avg(engagement) AS engagement, avg(emv) AS emv,
         avg(eng_rate) AS eng_rate
  FROM (
    SELECT brand, count(*)::float AS posts, count(DISTINCT influencer_id)::float AS creators, sum(views) AS views,
           sum(engagement) AS engagement, sum(emv) AS emv, sum(engagement) / NULLIF(sum(views), 0) AS eng_rate
    FROM posts WHERE brand <> 'Venus' AND brand <> 'Mercadona' GROUP BY brand
  ) b
)
SELECT 'Posts' AS label, focal.posts AS value, comp.posts AS compare, 'compact' AS fmt FROM focal, comp
UNION ALL SELECT 'Creators', focal.creators, comp.creators, 'compact' FROM focal, comp
UNION ALL SELECT 'Views', focal.views, comp.views, 'compact' FROM focal, comp
UNION ALL SELECT 'Engagement', focal.engagement, comp.engagement, 'compact' FROM focal, comp
UNION ALL SELECT 'Eng. rate', focal.eng_rate, comp.eng_rate, 'percent' FROM focal, comp
UNION ALL SELECT 'EMV', focal.emv, comp.emv, 'currency' FROM focal, comp`;

export const DEFAULT_WIDGETS: Omit<WidgetSpec, "id" | "layout">[] = [
  {
    type: "kpi",
    title: "Venus at a glance",
    subtitle: "Oct 2025 to Jul 2026. Delta is versus the average competitor (Mercadona excluded).",
    sql: VENUS_KPI_SQL,
    rationale: "Headline numbers for the focal brand with a competitor benchmark.",
  },
  {
    type: "bar",
    title: "Share of voice by brand",
    subtitle: "Creator posts tracked per brand",
    sql: `SELECT brand, count(*)::int AS value FROM posts GROUP BY brand ORDER BY value DESC`,
    x: "brand", y: "value", colorBy: "brand", format: "compact", horizontal: true,
    rationale: "Who is generating the most creator content in the category.",
  },
  {
    type: "line",
    title: "Engagement trend by brand",
    subtitle: "Monthly sum of likes, comments, shares and saves",
    sql: `SELECT to_char(date_trunc('month', published_at), 'YYYY-MM') AS month, brand, sum(engagement) AS value
FROM posts WHERE published_at < '2026-08-01' GROUP BY 1, 2 ORDER BY 1`,
    x: "month", y: "value", series: "brand", colorBy: "brand", format: "compact",
    rationale: "Shows momentum shifts; Venus and Estrid both surged in May to July 2026.",
  },
  {
    type: "stacked_bar",
    title: "Comment sentiment by brand",
    subtitle: "Share of analysed comments",
    sql: `SELECT brand, sentiment, count(*)::int AS value FROM comments WHERE sentiment IS NOT NULL GROUP BY 1, 2 ORDER BY 1`,
    x: "brand", y: "value", series: "sentiment", colorBy: "sentiment", normalize: true, format: "percent",
    rationale: "How audiences feel about each brand's creator content.",
  },
  {
    type: "stacked_bar",
    title: "Purchase intent in comments",
    subtitle: "Comments flagged with buying intent, by stage",
    sql: `SELECT brand, purchase_intent_type AS stage, count(*)::int AS value FROM comments
WHERE purchase_intent_type IS NOT NULL GROUP BY 1, 2 ORDER BY 1`,
    x: "brand", y: "value", series: "stage", colorBy: "auto", format: "compact",
    rationale: "Explicit intent is the strongest conversion signal in the comments.",
  },
  {
    type: "stacked_bar",
    title: "Top objections by brand",
    subtitle: "Comments raising an objection, grouped by category",
    sql: `SELECT objection_category AS objection, brand, count(*)::int AS value FROM comments
WHERE objection_category IS NOT NULL GROUP BY 1, 2 ORDER BY 1`,
    x: "objection", y: "value", series: "brand", colorBy: "brand", horizontal: true, format: "compact",
    rationale: "Quality and price dominate the objections across the category.",
  },
  {
    type: "table",
    title: "Competitors named in Venus comments",
    subtitle: "Who commenters mention under Venus content, and which side they favour",
    sql: `SELECT competitor_name AS competitor, count(*)::int AS mentions,
  count(*) FILTER (WHERE competitor_favored = 'competitor')::int AS prefers_competitor,
  count(*) FILTER (WHERE competitor_favored = 'focal_brand')::int AS prefers_venus,
  count(*) FILTER (WHERE competitor_favored IN ('neither','unclear'))::int AS neutral
FROM comments WHERE brand = 'Venus' AND competitor_name IS NOT NULL
GROUP BY 1 ORDER BY mentions DESC LIMIT 12`,
    rationale: "Direct read on competitive preference inside the focal brand's own audience.",
  },
  {
    type: "stacked_bar",
    title: "Creator tier mix",
    subtitle: "Share of posts by creator follower tier",
    sql: `SELECT brand, tier, count(*)::int AS value FROM posts WHERE tier IS NOT NULL GROUP BY 1, 2 ORDER BY 1`,
    x: "brand", y: "value", series: "tier", colorBy: "tier", normalize: true, format: "percent",
    rationale: "Whether a brand leans on nano and micro creators or on macro and mega reach.",
  },
  {
    type: "stacked_bar",
    title: "Posts by country",
    subtitle: "Top markets, stacked by brand",
    sql: `SELECT country, brand, count(*)::int AS value FROM posts
WHERE country IN (SELECT country FROM posts WHERE country IS NOT NULL AND country <> 'Unknown' GROUP BY country ORDER BY count(*) DESC LIMIT 8)
GROUP BY 1, 2 ORDER BY 1`,
    x: "country", y: "value", series: "brand", colorBy: "brand", horizontal: true, format: "compact",
    rationale: "Where the conversation is happening; the UK and Germany lead.",
  },
  {
    type: "table",
    title: "Top posts by engagement",
    sql: `SELECT brand, username AS creator, platform, published_at::date AS date, likes, comments, views, engagement, url
FROM posts ORDER BY engagement DESC NULLS LAST LIMIT 15`,
    rationale: "The individual pieces of content that moved the most people.",
  },
  {
    type: "line",
    title: "Safety complaints and backlash signals",
    subtitle: "Monthly count of flagged comments, all brands",
    sql: `SELECT to_char(date_trunc('month', published_at), 'YYYY-MM') AS month,
  count(*) FILTER (WHERE safety_complaint_type IS NOT NULL)::int AS safety_complaints,
  count(*) FILTER (WHERE crisis_risk_type IS NOT NULL)::int AS backlash_flags
FROM comments WHERE published_at < '2026-09-01' GROUP BY 1 ORDER BY 1`,
    x: "month", colorBy: "auto", format: "number",
    rationale: "Early warning for skin irritation complaints and creator credibility call-outs.",
  },
  {
    type: "insight",
    title: "Strategy insight for Venus",
    subtitle: "Generated from the full post and comment analysis",
    sql: `SELECT insight_headline AS headline, insight_act AS body FROM segments WHERE brand = 'Venus'`,
    rationale: "The recommended actions from the precomputed AI analysis.",
  },
];

/** Goal-first entry points for the chat. Each intent reveals three focused prompts. */
export interface Intent {
  id: string;
  title: string;
  blurb: string;
  prompts: string[];
}

export const INTENTS: Intent[] = [
  {
    id: "competitor",
    title: "Size up a competitor",
    blurb: "Volume, reach and momentum, brand by brand.",
    prompts: [
      "How does Estrid's creator activity compare with Venus by platform?",
      "Which brand is growing fastest month by month, and where?",
      "Which competitor gets the most comments per post?",
    ],
  },
  {
    id: "audience",
    title: "Hear what audiences say",
    blurb: "Sentiment, intent, objections and open questions in the comments.",
    prompts: [
      "What do commenters complain about most, brand by brand?",
      "What questions are people asking that nobody answers?",
      "Which brand gets the strongest purchase intent in comments, and why?",
    ],
  },
  {
    id: "creators",
    title: "Evaluate creators",
    blurb: "Who moves people, and what size of creator pays off.",
    prompts: [
      "Which creators drove the most engagement for Venus?",
      "How does engagement differ between nano, micro and macro creators?",
      "Which creators post about more than one of these brands?",
    ],
  },
  {
    id: "risk",
    title: "Spot risks",
    blurb: "Safety complaints, backlash and sponsorship scepticism.",
    prompts: [
      "Are there safety complaints or backlash signals, and for which brands?",
      "How do audiences react to sponsored posts compared with organic ones?",
      "Which brands get the most ad call-outs in comments?",
    ],
  },
  {
    id: "report",
    title: "Build a report",
    blurb: "Let the analyst propose whole sections of the dashboard.",
    prompts: [
      "Propose a competitive overview section for Venus: three or four elements.",
      "Propose a section about audience sentiment and purchase intent.",
      "Summarise what changed for Venus from April to July 2026, with a chart.",
    ],
  },
];

/** Hidden instruction sent when the person clicks "Where should I start?". */
export const START_SCAN_LABEL = "Where should I start?";
export const START_SCAN_INSTRUCTION = `Where should I start? Run a quick scan of the data for me: query share of voice by brand and platform, the monthly engagement trend, comment sentiment and purchase intent by brand, and the top objections. Then give me exactly three short observations about Venus versus its competitors (one or two sentences each, with the key numbers), and call propose_widget once for each observation so I can add a matching element. Keep the whole reply under 170 words.`;

/** Starter questions surfaced in the chat panel. */
export const STARTER_QUESTIONS: string[] = [
  "Which competitor is winning on TikTok, and why?",
  "What are people complaining about with Venus versus Estrid?",
  "Where are Venus buyers getting stuck before purchase?",
  "Which creators drove the most engagement for Venus?",
  "How does comment sentiment compare across brands on Instagram?",
  "Which brands do commenters prefer over Venus, and what do they cite?",
  "What questions are commenters asking that nobody answers?",
  "Which countries over-index for Philips OneBlade?",
  "How much of each brand's content is paid versus organic?",
  "What do loyal Venus customers say about the product?",
];
