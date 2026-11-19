import { getWorkspace } from "./brands";
import { getDb } from "./db";
import { readScoped } from "./query";
import { addDays, addMonths, monthEnd, toIsoDate, type Coverage, type MonthCoverage } from "./period";
import { ensureReady } from "./schema";

/**
 * What the dataset covers for the current scope's brands, computed from the data and the import log. Used by the period bar,
 * the analyst's dataset description and the new-period detection. Never hardcoded.
 */
export async function getCoverage(market?: string): Promise<Coverage> {
  await ensureReady();
  const db = await getDb();
  // With a market, the dates, totals and months are that market's. The list of markets is always the whole list.
  const win = market ? { market } : null;
  const [d] = await readScoped<{ first: string | null; last: string | null; posts: number; comments: number }>(`
    SELECT least((SELECT min(published_at) FROM posts_all), (SELECT min(published_at) FROM comments_all)) AS first,
           greatest((SELECT max(published_at) FROM posts_all), (SELECT max(published_at) FROM comments_all)) AS last,
           (SELECT count(*)::int FROM posts_all) AS posts, (SELECT count(*)::int FROM comments_all) AS comments`, [], win);
  // Imports feed the live industry only; the other industries are fixed snapshots.
  const live = getWorkspace().industry?.live !== false;
  const [imp] = live ? await db.query<{ covered_to: string | null }>(`SELECT max(covers_to)::text AS covered_to FROM imports WHERE status = 'done'`) : [{ covered_to: null }];
  const rows = await readScoped<{ month: string; posts: number; comments: number }>(`
    SELECT m.month, coalesce(p.n, 0)::int AS posts, coalesce(c.n, 0)::int AS comments FROM
      (SELECT DISTINCT to_char(date_trunc('month', published_at), 'YYYY-MM') AS month FROM posts_all WHERE published_at IS NOT NULL
       UNION SELECT DISTINCT to_char(date_trunc('month', published_at), 'YYYY-MM') FROM comments_all WHERE published_at IS NOT NULL) m
      LEFT JOIN (SELECT to_char(date_trunc('month', published_at), 'YYYY-MM') AS month, count(*) AS n FROM posts_all GROUP BY 1) p ON p.month = m.month
      LEFT JOIN (SELECT to_char(date_trunc('month', published_at), 'YYYY-MM') AS month, count(*) AS n FROM comments_all GROUP BY 1) c ON c.month = m.month
    ORDER BY 1`, [], win);
  const markets = await readScoped<{ country: string; posts: number }>(
    `SELECT country, count(*)::int AS posts FROM posts_all WHERE country IS NOT NULL AND country <> 'Unknown' GROUP BY 1 HAVING count(*) >= 30 ORDER BY 2 DESC LIMIT 40`,
  );
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
  return { firstDate, lastDate, coveredTo, months, posts: Number(d.posts), comments: Number(d.comments), markets: markets.map((m) => ({ country: m.country, posts: Number(m.posts) })) };
}

/** Months with any data, newest first. */
export function monthsWithData(c: Coverage): MonthCoverage[] {
  return c.months.filter((m) => m.posts + m.comments > 0).slice().reverse();
}

/** Latest complete month with a meaningful amount of posts (a trailing month with a handful of stray rows does not count), else the latest month with data. */
export function latestMonth(c: Coverage): string | null {
  const maxPosts = Math.max(0, ...c.months.map((m) => m.posts));
  const complete = c.months.filter((m) => m.complete && m.posts >= Math.max(1, maxPosts * 0.1));
  if (complete.length) return complete[complete.length - 1].month;
  const any = monthsWithData(c);
  return any[0]?.month ?? null;
}
