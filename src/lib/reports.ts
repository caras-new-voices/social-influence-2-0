import { FOCAL_BRAND } from "./brands";
import { getCoverage } from "./coverage";
import { getDashboard } from "./dashboards";
import { getDb, type Row } from "./db";
import { llmMode } from "./claude";
import { complete } from "./llm";
import { addMonths, formatMonth, monthEnd, monthKey, monthStart, type MonthCoverage, type PeriodWindow } from "./period";
import { runWidgetQuery } from "./query";
import { DATASET_DOC } from "./schema-doc";
import { ensureReady } from "./schema";
import { isDataWidget, type WidgetSpec } from "./widgets";

/**
 * Monthly reports: one row per complete month with headline numbers and the delta versus the
 * previous month, plus an optional stored "month in review" written by the analyst.
 */

const DDL = `
CREATE TABLE IF NOT EXISTS period_reports (
  id bigserial PRIMARY KEY,
  dashboard_id text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  summary_md text NOT NULL,
  model text,
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dashboard_id, period_start, period_end)
);`;

let ready: Promise<void> | null = null;
async function ensureReports() {
  if (!ready) {
    ready = (async () => {
      await ensureReady();
      const db = await getDb();
      await db.exec(DDL);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

export interface MonthKpis {
  posts: number;
  creators: number;
  engagement: number;
  views: number;
  comments: number;
  positiveShare: number | null;
  intentComments: number;
  objections: number;
}

export interface MonthReportRow {
  month: string;
  label: string;
  start: string;
  end: string;
  complete: boolean;
  kpis: MonthKpis;
  previous: MonthKpis | null;
  review: StoredReport | null;
}

export type StoredReport = {
  id: number;
  dashboard_id: string;
  period_start: string;
  period_end: string;
  summary_md: string;
  model: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
};

const B = FOCAL_BRAND.name;
const KPI_SQL = `
SELECT
  (SELECT count(*)::int FROM posts WHERE brand = '${B}') AS posts,
  (SELECT count(DISTINCT influencer_id)::int FROM posts WHERE brand = '${B}') AS creators,
  (SELECT coalesce(sum(engagement), 0) FROM posts WHERE brand = '${B}') AS engagement,
  (SELECT coalesce(sum(views), 0) FROM posts WHERE brand = '${B}') AS views,
  (SELECT count(*)::int FROM comments WHERE brand = '${B}') AS comments,
  (SELECT round(100.0 * count(*) FILTER (WHERE sentiment = 'positive') / NULLIF(count(*) FILTER (WHERE sentiment IS NOT NULL), 0), 1) FROM comments WHERE brand = '${B}') AS positive_share,
  (SELECT count(*)::int FROM comments WHERE brand = '${B}' AND purchase_intent_type IS NOT NULL) AS intent_comments,
  (SELECT count(*)::int FROM comments WHERE brand = '${B}' AND objection_category IS NOT NULL) AS objections`;

async function kpisFor(window: PeriodWindow): Promise<MonthKpis> {
  const res = await runWidgetQuery(KPI_SQL, 5, window);
  const r = res.ok ? res.rows[0] ?? {} : {};
  const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);
  return {
    posts: n(r.posts), creators: n(r.creators), engagement: n(r.engagement), views: n(r.views), comments: n(r.comments),
    positiveShare: r.positive_share == null ? null : n(r.positive_share), intentComments: n(r.intent_comments), objections: n(r.objections),
  };
}

function monthsForReports(months: MonthCoverage[]): MonthCoverage[] {
  // Complete months with posts, newest first; a trailing partial month is shown too (flagged).
  const withPosts = months.filter((m) => m.posts > 0);
  return withPosts.slice().reverse();
}

export async function listMonthReports(dashboardId: string): Promise<{ rows: MonthReportRow[]; coveredTo: string | null }> {
  await ensureReports();
  const cov = await getCoverage();
  const months = monthsForReports(cov.months);
  const db = await getDb();
  const stored = await db.query<StoredReport>(`SELECT * FROM period_reports WHERE dashboard_id = $1`, [dashboardId]);
  const byStart = new Map(stored.map((s) => [String(s.period_start).slice(0, 10), s]));
  const cache = new Map<string, MonthKpis>();
  const kpis = async (m: string) => {
    if (!cache.has(m)) cache.set(m, await kpisFor({ start: monthStart(m), end: monthEnd(m) }));
    return cache.get(m)!;
  };
  const rows: MonthReportRow[] = [];
  for (const m of months) {
    const prevKey = monthKey(addMonths(monthStart(m.month), -1));
    const hasPrev = cov.months.some((x) => x.month === prevKey && x.posts > 0);
    rows.push({
      month: m.month,
      label: formatMonth(m.month),
      start: monthStart(m.month),
      end: monthEnd(m.month),
      complete: m.complete,
      kpis: await kpis(m.month),
      previous: hasPrev ? await kpis(prevKey) : null,
      review: byStart.get(monthStart(m.month)) ?? null,
    });
  }
  return { rows, coveredTo: cov.coveredTo };
}

export async function getStoredReport(dashboardId: string, month: string): Promise<StoredReport | null> {
  await ensureReports();
  const db = await getDb();
  const rows = await db.query<StoredReport>(`SELECT * FROM period_reports WHERE dashboard_id = $1 AND period_start = $2`, [dashboardId, monthStart(month)]);
  return rows[0] ?? null;
}

const REVIEW_SYSTEM = `You write the "month in review" for a brand team's social intelligence dashboard (the Social Influence workspace, an IMAI product). You are given the dashboard's elements with their results for the month and for the previous month. Write a concise, concrete review in markdown. Never name third-party data providers.

${DATASET_DOC}`;

function compactRows(rows: Row[], max = 12): Row[] {
  return rows.slice(0, max).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" && v.length > 120 ? v.slice(0, 120) + "…" : typeof v === "number" ? Math.round(v * 100) / 100 : v])));
}

function pct(a: number, b: number): string {
  if (!b) return "n/a";
  const d = ((a - b) / Math.abs(b)) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(0)}%`;
}

function mockReview(month: string, prev: string | null, k: MonthKpis, p: MonthKpis | null, widgets: Array<{ title: string; rows: Row[]; prevRows: Row[] }>): string {
  const lines: string[] = [];
  lines.push(`## ${formatMonth(month)} in review`);
  lines.push("");
  if (p && prev) {
    lines.push(`**Volume.** ${B} had ${k.posts.toLocaleString("en-US")} creator posts (${pct(k.posts, p.posts)} vs ${formatMonth(prev)}) from ${k.creators.toLocaleString("en-US")} creators, generating ${Math.round(k.engagement).toLocaleString("en-US")} engagements (${pct(k.engagement, p.engagement)}) and ${k.comments.toLocaleString("en-US")} comments (${pct(k.comments, p.comments)}).`);
  } else {
    lines.push(`**Volume.** ${B} had ${k.posts.toLocaleString("en-US")} creator posts from ${k.creators.toLocaleString("en-US")} creators, generating ${Math.round(k.engagement).toLocaleString("en-US")} engagements and ${k.comments.toLocaleString("en-US")} comments.`);
  }
  lines.push("");
  lines.push(`**Sentiment and intent.** ${k.positiveShare == null ? "No analysed comments." : `${k.positiveShare}% of analysed comments were positive${p?.positiveShare != null ? ` (${(k.positiveShare - p.positiveShare) >= 0 ? "+" : ""}${(k.positiveShare - p.positiveShare).toFixed(1)} pts)` : ""}.`} ${k.intentComments.toLocaleString("en-US")} comments showed buying intent${p ? ` (${pct(k.intentComments, p.intentComments)})` : ""}; ${k.objections.toLocaleString("en-US")} raised an objection${p ? ` (${pct(k.objections, p.objections)})` : ""}.`);
  lines.push("");
  const movers = widgets.slice(0, 3).map((w) => `- **${w.title}**: ${w.rows.length} rows this month, ${w.prevRows.length} last month.`);
  if (movers.length) {
    lines.push("**What moved on the dashboard.**");
    lines.push(...movers);
    lines.push("");
  }
  lines.push("**Suggested action.** Review the elements with the largest change in compare mode and ask the analyst to explain the drivers.");
  lines.push("");
  lines.push("_Demo mode: this review is generated from the numbers without an LLM. With an API key configured, the analyst writes the narrative._");
  return lines.join("\n");
}

/** Builds (or rebuilds) the month in review for a dashboard and month, running every data element for both months. */
export async function generateMonthReview(dashboardId: string, month: string, { force = false } = {}): Promise<StoredReport> {
  await ensureReports();
  const existing = await getStoredReport(dashboardId, month);
  if (existing && !force) return existing;
  const dashboard = await getDashboard(dashboardId);
  if (!dashboard) throw new Error("Dashboard not found");
  const start = monthStart(month);
  const end = monthEnd(month);
  const prevMonth = monthKey(addMonths(start, -1));
  const cov = await getCoverage();
  const hasPrev = cov.months.some((x) => x.month === prevMonth && x.posts + x.comments > 0);
  const cur: PeriodWindow = { start, end };
  const prev: PeriodWindow | null = hasPrev ? { start: monthStart(prevMonth), end: start } : null;

  const k = await kpisFor(cur);
  const p = prev ? await kpisFor(prev) : null;
  const widgets: Array<{ title: string; type: string; rows: Row[]; prevRows: Row[] }> = [];
  for (const w of dashboard.widgets.filter((x): x is WidgetSpec & { sql: string } => !!x.sql && isDataWidget(x.type) && x.type !== "insight")) {
    if (w.period === "all") continue;
    const a = await runWidgetQuery(w.sql, 40, cur);
    const b = prev ? await runWidgetQuery(w.sql, 40, prev) : null;
    widgets.push({ title: w.title, type: w.type, rows: a.ok ? a.rows : [], prevRows: b && b.ok ? b.rows : [] });
    if (widgets.length >= 14) break;
  }

  let summary: string;
  let model: string | null = null;
  if (llmMode() === "mock") {
    summary = mockReview(month, prev ? prevMonth : null, k, p, widgets);
    model = "demo";
  } else {
    const user = [
      `Dashboard: "${dashboard.name}". Focal brand: ${B}. Month under review: ${formatMonth(month)} (${start} to ${end}, end exclusive).${prev ? ` Previous month: ${formatMonth(prevMonth)}.` : " No previous month available."}`,
      `Headline numbers for ${B}: ${JSON.stringify(k)}${p ? `; previous month: ${JSON.stringify(p)}` : ""}.`,
      "Dashboard elements (this month, then previous month; rows trimmed):",
      ...widgets.map((w) => `### ${w.title} (${w.type})\nthis month: ${JSON.stringify(compactRows(w.rows))}\nprevious month: ${JSON.stringify(compactRows(w.prevRows))}`),
      "",
      "Write the month in review in markdown, under 320 words: a heading '## <Month> in review'; a one-paragraph lead with the headline numbers and the direction versus the previous month; then 3 to 5 bullets on what grew, what fell and why (name creators, channels, topics, objections with the numbers); then 2 or 3 notable verbatim comments if present in the data (quoted, short); then one bullet 'Suggested action'. Only use numbers present in the data. Do not mention SQL or tools.",
    ].join("\n\n");
    summary = (await complete(REVIEW_SYSTEM, user, 1800)).trim();
    model = process.env.OPEN_AI_KEY || process.env.OPENAI_API_KEY ? process.env.OPENAI_MODEL ?? "gpt-5.2" : process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
  }

  const db = await getDb();
  const data = { kpis: k, previous: p, elements: widgets.map((w) => ({ title: w.title, rows: w.rows.length, prevRows: w.prevRows.length })) };
  const rows = await db.query<StoredReport>(
    `INSERT INTO period_reports (dashboard_id, period_start, period_end, summary_md, model, data) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (dashboard_id, period_start, period_end) DO UPDATE SET summary_md = EXCLUDED.summary_md, model = EXCLUDED.model, data = EXCLUDED.data, created_at = now()
     RETURNING *`,
    [dashboardId, start, end, summary, model, JSON.stringify(data)],
  );
  return rows[0];
}
