import { openAiKey } from "./openai-key";
import { focalName } from "./brands";
import { getCoverage } from "./coverage";
import { getDashboard } from "./dashboards";
import { getDb, type Row } from "./db";
import { llmMode } from "./claude";
import { assertCanSpend, complete, recordEstimate } from "./llm";
import type { UsageLine } from "./usage-shared";
import { addMonths, formatMonth, monthEnd, monthKey, monthStart, type MonthCoverage, type PeriodWindow } from "./period";
import { runForDashboard } from "./scope";
import { runWidgetQuery } from "./query";
import { datasetDoc } from "./schema-doc";
import { ensureReady } from "./schema";
import { isDataWidget, type WidgetSpec } from "./widgets";
import { EIGHT_MEASURES_SQL } from "./tom8";

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
);
-- A review is written per market ('' is all markets), so the key includes it.
ALTER TABLE period_reports ADD COLUMN IF NOT EXISTS market text NOT NULL DEFAULT '';
ALTER TABLE period_reports DROP CONSTRAINT IF EXISTS period_reports_dashboard_id_period_start_period_end_key;
CREATE UNIQUE INDEX IF NOT EXISTS period_reports_key ON period_reports (dashboard_id, period_start, period_end, market);`;

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

const KPI_SQL = `
SELECT
  (SELECT count(*)::int FROM posts WHERE brand = focal_brand()) AS posts,
  (SELECT count(DISTINCT influencer_id)::int FROM posts WHERE brand = focal_brand()) AS creators,
  (SELECT coalesce(sum(engagement), 0) FROM posts WHERE brand = focal_brand()) AS engagement,
  (SELECT coalesce(sum(views), 0) FROM posts WHERE brand = focal_brand()) AS views,
  (SELECT count(*)::int FROM comments WHERE brand = focal_brand()) AS comments,
  (SELECT round(100.0 * count(*) FILTER (WHERE sentiment = 'positive') / NULLIF(count(*) FILTER (WHERE sentiment IS NOT NULL), 0), 1) FROM comments WHERE brand = focal_brand()) AS positive_share,
  (SELECT count(*)::int FROM comments WHERE brand = focal_brand() AND purchase_intent_type IS NOT NULL) AS intent_comments,
  (SELECT count(*)::int FROM comments WHERE brand = focal_brand() AND objection_category IS NOT NULL) AS objections`;

/** One of the eight measures for a month: its value, the month before, and how to show it. */
export interface MonthMeasure { label: string; value: number | null; compare: number | null; fmt: "percent" | "ratio" | "decimal" | "points" }
export interface MonthRead { measures: MonthMeasure[]; kpis: MonthKpis; previous: MonthKpis | null; /** The written review for this month and market, if one exists. */ review: StoredReport | null }

/** The monthly read: the eight measures and the volume counts for one month against the month before, for all markets or one. */
export async function getMonthRead(dashboardId: string, month: string, market?: string): Promise<MonthRead> {
  return runForDashboard(await getDashboard(dashboardId), async () => {
    await ensureReports();
    const window: PeriodWindow = { start: monthStart(month), end: monthEnd(month), ...(market ? { market } : {}) };
    const prevKey = monthKey(addMonths(monthStart(month), -1));
    const res = await runWidgetQuery(EIGHT_MEASURES_SQL, 20, window);
    const num = (v: unknown) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
    // A failed query is an error, not a month with too few posts.
    if (!res.ok) throw new Error(res.error);
    const measures: MonthMeasure[] = res.rows.map((r) => ({ label: String(r.label), value: num(r.value), compare: num(r.compare), fmt: String(r.fmt) as MonthMeasure["fmt"] }));
    const cov = await getCoverage();
    const hasPrev = cov.months.some((x) => x.month === prevKey && x.posts > 0);
    const before = hasPrev ? await kpisFor({ start: monthStart(prevKey), end: monthEnd(prevKey), ...(market ? { market } : {}) }) : null;
    // A market can have nothing in the month before even when the brands as a whole do.
    return { measures, kpis: await kpisFor(window), previous: before && (before.posts > 0 || before.comments > 0) ? before : null, review: await getStoredReport(dashboardId, month, market) };
  });
}

async function kpisFor(window: PeriodWindow): Promise<MonthKpis> {
  const res = await runWidgetQuery(KPI_SQL, 5, window);
  // A failed query is an error: zeros would read as a month with nothing in it.
  if (!res.ok) throw new Error(res.error);
  const r = res.rows[0] ?? {};
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

/** One row per month of the dashboard's brands, with headline numbers and any stored review. */
export async function listMonthReports(dashboardId: string): Promise<{ rows: MonthReportRow[]; coveredTo: string | null; markets: string[] }> {
  return runForDashboard(await getDashboard(dashboardId), () => listReports(dashboardId));
}

async function listReports(dashboardId: string): Promise<{ rows: MonthReportRow[]; coveredTo: string | null; markets: string[] }> {
  await ensureReports();
  const cov = await getCoverage();
  const months = monthsForReports(cov.months);
  const db = await getDb();
  // The month is taken as text in SQL: Postgres hands a date column back as a Date object, the embedded database as a string.
  const stored = await db.query<StoredReport & { start_key: string }>(`SELECT *, to_char(period_start, 'YYYY-MM-DD') AS start_key FROM period_reports WHERE dashboard_id = $1 AND market = ''`, [dashboardId]);
  const byStart = new Map(stored.map((s) => [s.start_key, s]));
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
  return { rows, coveredTo: cov.coveredTo, markets: (cov.markets ?? []).map((m) => m.country) };
}

export async function getStoredReport(dashboardId: string, month: string, market?: string): Promise<StoredReport | null> {
  await ensureReports();
  const db = await getDb();
  const rows = await db.query<StoredReport>(`SELECT * FROM period_reports WHERE dashboard_id = $1 AND period_start = $2 AND market = $3`, [dashboardId, monthStart(month), market ?? ""]);
  return rows[0] ?? null;
}

const reviewSystem = () => `You write the "month in review" for a brand team's social intelligence dashboard (the Social Influence workspace, an IMAI product). You are given the dashboard's elements with their results for the month and for the previous month. Write a concise, concrete review in markdown. Never name third-party data providers. Always make clear whether a number is a count (posts, comments, creators) or a rate (a share, a ratio, a per-1,000 figure), and give every rate its base. Describe a change in a count as a percent and a change in a share as percentage points ("share of voice up 4 points, from 27% to 31%"), never as a percent of a percent.

${datasetDoc()}`;

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
    lines.push(`**Volume.** ${focalName()} had ${k.posts.toLocaleString("en-US")} creator posts (${pct(k.posts, p.posts)} vs ${formatMonth(prev)}) from ${k.creators.toLocaleString("en-US")} creators, generating ${Math.round(k.engagement).toLocaleString("en-US")} engagements (${pct(k.engagement, p.engagement)}) and ${k.comments.toLocaleString("en-US")} comments (${pct(k.comments, p.comments)}).`);
  } else {
    lines.push(`**Volume.** ${focalName()} had ${k.posts.toLocaleString("en-US")} creator posts from ${k.creators.toLocaleString("en-US")} creators, generating ${Math.round(k.engagement).toLocaleString("en-US")} engagements and ${k.comments.toLocaleString("en-US")} comments.`);
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
export async function generateMonthReview(dashboardId: string, month: string, opts: { force?: boolean; automatic?: boolean; market?: string } = {}): Promise<StoredReport> {
  return runForDashboard(await getDashboard(dashboardId), () => writeReview(dashboardId, month, opts));
}

async function writeReview(dashboardId: string, month: string, { force = false, automatic = false, market }: { force?: boolean; automatic?: boolean; market?: string } = {}): Promise<StoredReport> {
  await ensureReports();
  const existing = await getStoredReport(dashboardId, month, market);
  if (existing && !force) return existing;
  // Writing a review uses the analyst: it needs tokens (automatic reviews are skipped at zero by the caller's catch).
  await assertCanSpend();
  const dashboard = await getDashboard(dashboardId);
  if (!dashboard) throw new Error("Dashboard not found");
  const start = monthStart(month);
  const end = monthEnd(month);
  const prevMonth = monthKey(addMonths(start, -1));
  const cov = await getCoverage();
  const hasPrev = cov.months.some((x) => x.month === prevMonth && x.posts + x.comments > 0);
  // With a market, both months are read inside it, and the review says so.
  const inMarket = market ? { market } : {};
  const cur: PeriodWindow = { start, end, ...inMarket };
  const prev: PeriodWindow | null = hasPrev ? { start: monthStart(prevMonth), end: start, ...inMarket } : null;

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

  const meta = { kind: "month_review" as const, dashboardId, label: `Month in review: ${formatMonth(month)}${market ? `, ${market}` : ""}`, automatic };
  let usage: UsageLine | null = null;
  let summary: string;
  let model: string | null = null;
  if (llmMode() === "mock") {
    summary = mockReview(month, prev ? prevMonth : null, k, p, widgets);
    if (market) summary = summary.replace(/^## (.*) in review/m, `## $1 in review: ${market}`);
    model = "demo";
    usage = await recordEstimate(meta, reviewSystem() + JSON.stringify(widgets.map((w) => [w.title, compactRows(w.rows), compactRows(w.prevRows)])), summary);
  } else {
    const user = [
      `Dashboard: "${dashboard.name}". Focal brand: ${focalName()}. Month under review: ${formatMonth(month)} (${start} to ${end}, end exclusive).${market ? ` Market: ${market} only (creators in ${market}); every number below is for that market, so name the market in the heading and the lead and do not present anything as a total across markets.` : ""}${prev ? ` Previous month: ${formatMonth(prevMonth)}.` : " No previous month available."}`,
      `Headline numbers for ${focalName()}: ${JSON.stringify(k)}${p ? `; previous month: ${JSON.stringify(p)}` : ""}.`,
      "Dashboard elements (this month, then previous month; rows trimmed):",
      ...widgets.map((w) => `### ${w.title} (${w.type})\nthis month: ${JSON.stringify(compactRows(w.rows))}\nprevious month: ${JSON.stringify(compactRows(w.prevRows))}`),
      "",
      "Write the month in review in markdown, under 320 words: a heading '## <Month> in review'; a one-paragraph lead with the headline numbers and the direction versus the previous month; then 3 to 5 bullets on what grew, what fell and why (name creators, channels, topics, objections with the numbers); then 2 or 3 notable verbatim comments if present in the data (quoted, short); then one bullet 'Suggested action'. Only use numbers present in the data. Do not mention SQL or tools.",
    ].join("\n\n");
    const res = await complete(reviewSystem(), user, 1800, meta);
    summary = res.text.trim();
    usage = res.usage;
    model = openAiKey() ? process.env.OPENAI_MODEL ?? "gpt-5.2" : process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
  }

  const db = await getDb();
  const data = { usage, kpis: k, previous: p, elements: widgets.map((w) => ({ title: w.title, rows: w.rows.length, prevRows: w.prevRows.length })) };
  const rows = await db.query<StoredReport>(
    `INSERT INTO period_reports (dashboard_id, period_start, period_end, summary_md, model, data, market) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     ON CONFLICT (dashboard_id, period_start, period_end, market) DO UPDATE SET summary_md = EXCLUDED.summary_md, model = EXCLUDED.model, data = EXCLUDED.data, created_at = now()
     RETURNING *`,
    [dashboardId, start, end, summary, model, JSON.stringify(data), market ?? ""],
  );
  return rows[0];
}
