import { getDb } from "./db";
import { addDays, addMonths, monthEnd, toIsoDate, type Coverage, type MonthCoverage } from "./period";
import { ensureReady } from "./schema";

/**
 * What the dataset covers, computed from the data and the import log. Used by the period bar,
 * the analyst's dataset description and the new-period detection. Never hardcoded.
 */
export async function getCoverage(): Promise<Coverage> {
  await ensureReady();
  const db = await getDb();
  const [d] = await db.query<{ first: string | null; last: string | null; posts: number; comments: number }>(`
    SELECT least((SELECT min(published_at) FROM posts_all), (SELECT min(published_at) FROM comments_all)) AS first,
           greatest((SELECT max(published_at) FROM posts_all), (SELECT max(published_at) FROM comments_all)) AS last,
           (SELECT count(*)::int FROM posts_all) AS posts, (SELECT count(*)::int FROM comments_all) AS comments`);
  const [imp] = await db.query<{ covered_to: string | null }>(`SELECT max(covers_to)::text AS covered_to FROM imports WHERE status = 'done'`);
  const rows = await db.query<{ month: string; posts: number; comments: number }>(`
    SELECT m.month, coalesce(p.n, 0)::int AS posts, coalesce(c.n, 0)::int AS comments FROM
      (SELECT DISTINCT to_char(date_trunc('month', published_at), 'YYYY-MM') AS month FROM posts_all WHERE published_at IS NOT NULL
       UNION SELECT DISTINCT to_char(date_trunc('month', published_at), 'YYYY-MM') FROM comments_all WHERE published_at IS NOT NULL) m
      LEFT JOIN (SELECT to_char(date_trunc('month', published_at), 'YYYY-MM') AS month, count(*) AS n FROM posts_all GROUP BY 1) p ON p.month = m.month
      LEFT JOIN (SELECT to_char(date_trunc('month', published_at), 'YYYY-MM') AS month, count(*) AS n FROM comments_all GROUP BY 1) c ON c.month = m.month
    ORDER BY 1`);
  const firstDate = d.first ? toIsoDate(new Date(d.first)) : null;
  const lastDate = d.last ? toIsoDate(new Date(d.last)) : null;
  const coveredTo = imp.covered_to ? (imp.covered_to > (lastDate ?? "") ? imp.covered_to : lastDate) : lastDate;
  // Fill gaps so the month picker shows empty months inside the covered range.
  const months: MonthCoverage[] = [];
  if (rows.length) {
    const byMonth = new Map(rows.map((r) => [r.month, r]));
    let m = rows[0].month;
    const lastMonth = rows[rows.length - 1].month;
    while (m <= lastMonth) {
      const r = byMonth.get(m);
      months.push({ month: m, posts: Number(r?.posts ?? 0), comments: Number(r?.comments ?? 0), complete: !!coveredTo && coveredTo >= addDays(monthEnd(m), -1) });
      m = addMonths(`${m}-01`, 1).slice(0, 7);
    }
  }
  return { firstDate, lastDate, coveredTo, months, posts: Number(d.posts), comments: Number(d.comments) };
}

/** Months with any data, newest first. */
export function monthsWithData(c: Coverage): MonthCoverage[] {
  return c.months.filter((m) => m.posts + m.comments > 0).slice().reverse();
}

/** Latest complete month, or the latest month with data. */
export function latestMonth(c: Coverage): string | null {
  const complete = c.months.filter((m) => m.complete && m.posts + m.comments > 0);
  if (complete.length) return complete[complete.length - 1].month;
  const any = monthsWithData(c);
  return any[0]?.month ?? null;
}
