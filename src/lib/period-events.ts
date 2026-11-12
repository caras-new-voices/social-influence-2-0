/**
 * Period events: what changed in the dataset's coverage, month by month. Produced after every
 * import (by comparing coverage before and after) and by the daily coverage cron. They drive the
 * header bell, the dashboard banner, the chat nudge and the optional outbound webhook.
 */
import { getDb } from "./db";
import { addMonths, formatMonth, monthEnd, monthStart, type Coverage, type MonthCoverage } from "./period";
import { ensureReady } from "./schema";

export type PeriodEventKind = "month_started" | "month_completed" | "month_revised" | "month_missing";

export interface PeriodEventSummary {
  label: string;
  posts: number;
  comments: number;
  posts_delta: number;
  comments_delta: number;
  [k: string]: unknown;
}

export type PeriodEvent = {
  id: number;
  kind: PeriodEventKind;
  /** First day of the month (ISO date). */
  period_start: string;
  /** Exclusive end: first day of the next month (ISO date). */
  period_end: string;
  import_id: number | null;
  summary: PeriodEventSummary;
  created_at: string;
  /** The import that produced it, when listed with its import. */
  import?: { id: number; source: string | null; received_at: string; covers_from: string | null; covers_to: string | null } | null;
};

interface Draft { kind: PeriodEventKind; month: string; summary: PeriodEventSummary }

const EMPTY: MonthCoverage = { month: "", posts: 0, comments: 0, complete: false };

/** Pure diff of two coverage snapshots. Exported for tests and the CLI dry run. */
export function diffCoverage(before: Coverage, after: Coverage): Draft[] {
  const prev = new Map(before.months.map((m) => [m.month, m]));
  const out: Draft[] = [];
  for (const m of after.months) {
    const b = prev.get(m.month) ?? { ...EMPTY, month: m.month };
    const summary: PeriodEventSummary = {
      label: formatMonth(m.month),
      posts: m.posts,
      comments: m.comments,
      posts_delta: m.posts - b.posts,
      comments_delta: m.comments - b.comments,
    };
    const hadData = b.posts + b.comments > 0;
    const hasData = m.posts + m.comments > 0;
    const changed = summary.posts_delta !== 0 || summary.comments_delta !== 0;
    if (m.complete && !b.complete) out.push({ kind: "month_completed", month: m.month, summary });
    else if (!hadData && hasData) out.push({ kind: "month_started", month: m.month, summary });
    else if (b.complete && m.complete && changed) out.push({ kind: "month_revised", month: m.month, summary });
  }
  return out;
}

/** Diffs coverage around an import and stores the resulting events. */
export async function detectPeriodEvents(before: Coverage, after: Coverage, importId: number | null): Promise<PeriodEvent[]> {
  const drafts = diffCoverage(before, after);
  const events: PeriodEvent[] = [];
  for (const d of drafts) events.push(await insertEvent(d.kind, d.month, importId, d.summary));
  // A completed month gets its month-in-review written for every dashboard, in the background.
  const completed = drafts.filter((d) => d.kind === "month_completed").map((d) => d.month);
  if (completed.length) void writeReviewsFor(completed);
  return events;
}

async function writeReviewsFor(months: string[]) {
  try {
    const { listDashboards } = await import("./dashboards");
    const { generateMonthReview } = await import("./reports");
    for (const dash of await listDashboards()) {
      for (const month of months) {
        await generateMonthReview(dash.id, month, { force: true }).catch((e: Error) => console.error(`[period-events] review ${dash.id} ${month} failed:`, e.message));
      }
    }
  } catch (e) {
    console.error("[period-events] reviews failed:", (e as Error).message);
  }
}

async function insertEvent(kind: PeriodEventKind, month: string, importId: number | null, summary: PeriodEventSummary): Promise<PeriodEvent> {
  const db = await getDb();
  const [row] = await db.query<PeriodEvent>(
    `INSERT INTO period_events (kind, period_start, period_end, import_id, summary) VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id::int AS id, kind, period_start::text AS period_start, period_end::text AS period_end, import_id::int AS import_id, summary, created_at`,
    [kind, monthStart(month), monthEnd(month), importId, JSON.stringify(summary)],
  );
  return row;
}

/** Events newer than `since` (an event id), newest first, each with its import. */
export async function listPeriodEvents({ since = 0, limit = 30 }: { since?: number; limit?: number } = {}): Promise<PeriodEvent[]> {
  await ensureReady();
  const db = await getDb();
  const rows = await db.query<PeriodEvent & { i_id: number | null; i_source: string | null; i_received_at: string | Date | null; i_from: string | null; i_to: string | null }>(
    `SELECT e.id::int AS id, e.kind, e.period_start::text AS period_start, e.period_end::text AS period_end, e.import_id::int AS import_id,
            e.summary, e.created_at, i.id::int AS i_id, i.source AS i_source, i.received_at AS i_received_at,
            i.covers_from::text AS i_from, i.covers_to::text AS i_to
       FROM period_events e LEFT JOIN imports i ON i.id = e.import_id
      WHERE e.id > $1 ORDER BY e.id DESC LIMIT $2`,
    [Math.max(0, Math.floor(since)), Math.max(1, Math.min(200, Math.floor(limit)))],
  );
  return rows.map(({ i_id, i_source, i_received_at, i_from, i_to, ...e }) => ({
    ...e,
    import: i_id ? { id: i_id, source: i_source, received_at: i_received_at instanceof Date ? i_received_at.toISOString() : String(i_received_at), covers_from: i_from, covers_to: i_to } : null,
  }));
}

/**
 * Calendar check run by the daily cron: when the month before `today` is not complete in the
 * coverage, record one `month_missing` event for it (once per month).
 */
export async function checkCalendarCoverage(coverage: Coverage, today = new Date()): Promise<{ month: string; complete: boolean; created: PeriodEvent | null; existing: number | null }> {
  await ensureReady();
  const db = await getDb();
  const current = today.toISOString().slice(0, 7);
  const month = addMonths(`${current}-01`, -1).slice(0, 7);
  const m = coverage.months.find((x) => x.month === month);
  const complete = !!m?.complete || (!!coverage.coveredTo && coverage.coveredTo >= monthEnd(month));
  if (complete) return { month, complete, created: null, existing: null };
  const [prev] = await db.query<{ id: number }>(`SELECT id::int AS id FROM period_events WHERE kind = 'month_missing' AND period_start = $1 LIMIT 1`, [monthStart(month)]);
  if (prev) return { month, complete, created: null, existing: Number(prev.id) };
  const created = await insertEvent("month_missing", month, null, {
    label: formatMonth(month),
    posts: m?.posts ?? 0,
    comments: m?.comments ?? 0,
    posts_delta: 0,
    comments_delta: 0,
    covered_to: coverage.coveredTo,
  });
  notifyWebhook(created);
  return { month, complete, created, existing: null };
}

/** Fire-and-forget POST of an event to NOTIFY_WEBHOOK_URL, when configured. */
export function notifyWebhook(ev: PeriodEvent): void {
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (!url) return;
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "period_event", event: ev }),
    signal: AbortSignal.timeout(8000),
  })
    .then((r) => { if (!r.ok) console.error(`[period-events] webhook responded ${r.status}`); })
    .catch((e: Error) => console.error("[period-events] webhook failed:", e.message));
}
