import { z } from "zod";
import { WidgetPeriodSchema, type PeriodState } from "./period";

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
  /** Time window: inherit the dashboard period (default), ignore it ("all"), or a fixed window. */
  period: WidgetPeriodSchema.optional(),
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
  /** Global time period for the dashboard; null means all time. */
  period: PeriodState | null;
  /** Guided setup state; null when the dashboard was not created through the wizard (or it finished and was cleared). */
  onboarding?: import("./wizard").OnboardingState | null;
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

/** Period context for "Ask AI" when the dashboard compares two periods. */
export interface AskContext {
  periodLabel: string;
  compareLabel?: string;
  rows?: Record<string, unknown>[];
  compareRows?: Record<string, unknown>[];
}

const ASK_MAX_ROWS = 25;
const ASK_MAX_STRING = 120;

/** Compact JSON of at most 25 rows, long strings cut to 120 characters. */
export function compactRowsJson(rows: Record<string, unknown>[] | undefined): string {
  const list = (rows ?? []).slice(0, ASK_MAX_ROWS).map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) out[k] = typeof v === "string" && v.length > ASK_MAX_STRING ? `${v.slice(0, ASK_MAX_STRING)}…` : v;
    return out;
  });
  const more = rows && rows.length > ASK_MAX_ROWS ? ` (first ${ASK_MAX_ROWS} of ${rows.length} rows)` : "";
  return `${JSON.stringify(list)}${more}`;
}

function isComparing(ctx: AskContext | undefined): ctx is AskContext & { compareLabel: string; compareRows: Record<string, unknown>[] } {
  return !!ctx?.compareLabel && Array.isArray(ctx.compareRows);
}

function compareBlock(w: WidgetSpec, ctx: AskContext & { compareLabel: string; compareRows: Record<string, unknown>[] }): string {
  return [
    `The dashboard is comparing ${ctx.periodLabel} (current) with ${ctx.compareLabel} (comparison). The element's query was run once for each period.`,
    `Result for ${ctx.periodLabel}: ${compactRowsJson(ctx.rows)}`,
    `Result for ${ctx.compareLabel}: ${compactRowsJson(ctx.compareRows)}`,
    `Explain the biggest movements between the two periods in "${w.title}": name the three to five largest changes with both numbers and the change, then find the reasons behind them with follow-up queries (use posts_all and comments_all with explicit date filters to look at either period, e.g. which creators, posts, platforms or comment themes account for the change). Separate real shifts from volume effects (more posts or comments overall). Finish with what it means for Venus and propose one or two follow-up elements with propose_widget that would track or explain the change.`,
  ].join("\n\n");
}

/** Builds the chat request sent when the person clicks "Ask AI" on a dashboard element. */
export function askAboutWidget(w: WidgetSpec, ctx?: AskContext): { text: string; instruction: string } {
  if (w.sql && isComparing(ctx)) {
    return {
      text: `Explain the change in "${w.title}"`,
      instruction: [
        `Explain the change in the dashboard element "${w.title}"${w.subtitle ? ` (${w.subtitle})` : ""}. Its id is ${w.id} and its type is ${w.type}.`,
        `It is defined by this SQL:\n${w.sql}`,
        compareBlock(w, ctx),
        `If you propose a replacement for this element, call propose_widget with replaces_widget_id set to ${w.id}.`,
      ].join("\n\n"),
    };
  }
  const text = `Tell me about "${w.title}"`;
  const lines = [
    `Tell me about the dashboard element "${w.title}"${w.subtitle ? ` (${w.subtitle})` : ""}. Its id is ${w.id} and its type is ${w.type}.`,
  ];
  if (w.sql) {
    lines.push(`It is defined by this SQL:\n${w.sql}`);
    lines.push(
      "Run that query (and any follow-up queries you need), explain in plain language what it shows with the key numbers, point out the single most notable pattern, and say what it means for Venus. Then suggest one way to refine or extend this element; if you propose a replacement, call propose_widget with replaces_widget_id set to the id above.",
    );
  } else if (w.content) {
    lines.push(`Its content is:\n${w.content}`);
    lines.push("Comment on it against the data: confirm or challenge it with one or two queries, and suggest an element that would support it.");
  } else {
    lines.push("It is a section header. Suggest two or three elements that would belong under it, and propose the most useful one.");
  }
  return { text, instruction: lines.join("\n\n") };
}

/** Wraps a free question with the element's definition, for the focused (full-screen) chat. */
export function questionAboutWidget(w: WidgetSpec, question: string, ctx?: AskContext): string {
  const def = w.sql ? `It is defined by this SQL:\n${w.sql}` : w.content ? `Its content is:\n${w.content}` : "It is a section header.";
  const base = `The person is looking at the dashboard element "${w.title}"${w.subtitle ? ` (${w.subtitle})` : ""}, id ${w.id}, type ${w.type}. ${def}`;
  const answer = `Answer their question about this element, running the element's query or variations of it as needed. If you propose a refinement, call propose_widget with replaces_widget_id set to ${w.id}.`;
  if (w.sql && isComparing(ctx)) {
    const explain = question.trim() === EXPLAIN_CHANGE_QUESTION;
    return `${base}\n\n${explain ? compareBlock(w, ctx) : `The dashboard is comparing ${ctx.periodLabel} with ${ctx.compareLabel}.\n\nResult for ${ctx.periodLabel}: ${compactRowsJson(ctx.rows)}\n\nResult for ${ctx.compareLabel}: ${compactRowsJson(ctx.compareRows)}`}\n\n${answer}\n\nQuestion: ${question}`;
  }
  return `${base}\n\n${answer}\n\nQuestion: ${question}`;
}

/** Quick question offered in the focused chat when the dashboard compares two periods. */
export const EXPLAIN_CHANGE_QUESTION = "Explain the change";

/** Quick questions offered in the focused chat. */
export const FOCUS_QUESTIONS: string[] = [
  "Explain what this shows",
  "What stands out here?",
  "Split this by platform",
  "Show how this changed over time",
  "Give me example comments behind this",
];

/** The focused chat's quick questions; "Explain the change" leads when a comparison is active. */
export function focusQuestions(comparing: boolean): string[] {
  return comparing ? [EXPLAIN_CHANGE_QUESTION, ...FOCUS_QUESTIONS] : FOCUS_QUESTIONS;
}

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
