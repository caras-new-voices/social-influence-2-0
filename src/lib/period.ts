/**
 * Time periods. A period is a half-open window [start, end) of ISO dates (YYYY-MM-DD).
 * The dashboard carries one global period; every data element inherits it unless it opts out.
 * The window is applied inside the database (see schema.ts: posts and comments are views over
 * posts_all and comments_all filtered by transaction-local settings), so saved SQL never changes.
 */
import { z } from "zod";

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const ISO_MONTH = /^\d{4}-\d{2}$/;

export const CompareSchema = z.object({
  mode: z.enum(["previous", "same_last_year", "custom"]),
  start: z.string().regex(ISO_DATE).optional(),
  end: z.string().regex(ISO_DATE).optional(),
});
export type CompareState = z.infer<typeof CompareSchema>;

export const PeriodStateSchema = z.object({
  mode: z.enum(["all", "month", "range"]),
  /** Inclusive start, ISO date. Required for month and range. */
  start: z.string().regex(ISO_DATE).optional(),
  /** Exclusive end, ISO date. Required for month and range. */
  end: z.string().regex(ISO_DATE).optional(),
  compare: CompareSchema.nullable().optional(),
});
export type PeriodState = z.infer<typeof PeriodStateSchema>;

/** A concrete window as sent to the database. Either bound may be absent (open). */
export interface PeriodWindow {
  start?: string;
  end?: string;
}

/** Per-element override: inherit the dashboard period, ignore it, or pin a fixed window. */
export const WidgetPeriodSchema = z.union([
  z.literal("inherit"),
  z.literal("all"),
  z.object({ start: z.string().regex(ISO_DATE), end: z.string().regex(ISO_DATE) }),
]);
export type WidgetPeriod = z.infer<typeof WidgetPeriodSchema>;

export const ALL_TIME: PeriodState = { mode: "all" };

/* ---------------------------------------------------------------- */
/* Date helpers (UTC, date-only; no timezone surprises)               */
/* ---------------------------------------------------------------- */

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function parseIsoDate(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}
export function addMonths(iso: string, n: number): string {
  const d = parseIsoDate(iso);
  d.setUTCMonth(d.getUTCMonth() + n);
  return toIsoDate(d);
}
export function addDays(iso: string, n: number): string {
  const d = parseIsoDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIsoDate(d);
}
export function daysBetween(start: string, end: string): number {
  return Math.round((parseIsoDate(end).getTime() - parseIsoDate(start).getTime()) / 86_400_000);
}
/** First day of the month for a YYYY-MM key. */
export function monthStart(month: string): string {
  return `${month}-01`;
}
/** Exclusive end (first day of the next month) for a YYYY-MM key. */
export function monthEnd(month: string): string {
  return addMonths(`${month}-01`, 1);
}
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}
export function isWholeMonth(start: string, end: string): boolean {
  return start.endsWith("-01") && addMonths(start, 1) === end;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatMonth(month: string, long = true): string {
  const [y, m] = month.split("-").map(Number);
  const name = long ? new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-GB", { month: "long", timeZone: "UTC" }) : MONTHS[m - 1];
  return `${name} ${y}`;
}
export function formatDate(iso: string): string {
  const d = parseIsoDate(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
/** Human label for a window, e.g. "June 2026" or "3 Apr to 18 May 2026". Inclusive end shown. */
export function formatWindow(w: PeriodWindow): string {
  if (!w.start && !w.end) return "All time";
  if (w.start && w.end && isWholeMonth(w.start, w.end)) return formatMonth(monthKey(w.start));
  const a = w.start ? formatDate(w.start) : "the beginning";
  const b = w.end ? formatDate(addDays(w.end, -1)) : "the latest data";
  return `${a} to ${b}`;
}

/* ---------------------------------------------------------------- */
/* Resolution                                                         */
/* ---------------------------------------------------------------- */

export function monthPeriod(month: string, compare: PeriodState["compare"] = null): PeriodState {
  return { mode: "month", start: monthStart(month), end: monthEnd(month), compare };
}

/** The main window of a period state. */
export function resolveWindow(p: PeriodState | null | undefined): PeriodWindow {
  if (!p || p.mode === "all" || !p.start || !p.end) return {};
  return { start: p.start, end: p.end };
}

/** The comparison window, derived from the main window and the compare mode. */
export function resolveCompare(p: PeriodState | null | undefined): PeriodWindow | null {
  if (!p?.compare) return null;
  const main = resolveWindow(p);
  const c = p.compare;
  if (c.mode === "custom") return c.start && c.end ? { start: c.start, end: c.end } : null;
  if (!main.start || !main.end) return null;
  if (c.mode === "same_last_year") return { start: addMonths(main.start, -12), end: addMonths(main.end, -12) };
  // previous period: same length immediately before; whole months shift by whole months
  if (isWholeMonth(main.start, main.end)) return { start: addMonths(main.start, -1), end: main.start };
  const len = daysBetween(main.start, main.end);
  return { start: addDays(main.start, -len), end: main.start };
}

/** Applies an element-level override to the dashboard window. */
export function effectiveWindow(dashboard: PeriodWindow, override: WidgetPeriod | undefined): PeriodWindow {
  if (!override || override === "inherit") return dashboard;
  if (override === "all") return {};
  return { start: override.start, end: override.end };
}

/** Stable key for caches. */
export function windowKey(w: PeriodWindow | null | undefined): string {
  if (!w || (!w.start && !w.end)) return "all";
  return `${w.start ?? ""}..${w.end ?? ""}`;
}

/* ---------------------------------------------------------------- */
/* URL serialisation (?period=2026-06 | 2026-04-03..2026-05-19 | all; &compare=prev | ly | a..b) */
/* ---------------------------------------------------------------- */

export function periodToParams(p: PeriodState): Record<string, string> {
  const out: Record<string, string> = {};
  if (p.mode === "month" && p.start && p.end && isWholeMonth(p.start, p.end)) out.period = monthKey(p.start);
  else if (p.mode !== "all" && p.start && p.end) out.period = `${p.start}..${p.end}`;
  else out.period = "all";
  if (p.compare) {
    if (p.compare.mode === "previous") out.compare = "prev";
    else if (p.compare.mode === "same_last_year") out.compare = "ly";
    else if (p.compare.start && p.compare.end) out.compare = `${p.compare.start}..${p.compare.end}`;
  }
  return out;
}

export function periodFromParams(params: { get(name: string): string | null }): PeriodState | null {
  const period = params.get("period");
  if (!period) return null;
  let state: PeriodState;
  if (period === "all") state = { mode: "all" };
  else if (ISO_MONTH.test(period)) state = monthPeriod(period);
  else {
    const [a, b] = period.split("..");
    if (!ISO_DATE.test(a ?? "") || !ISO_DATE.test(b ?? "")) return null;
    state = { mode: "range", start: a, end: b };
  }
  const compare = params.get("compare");
  if (compare === "prev") state.compare = { mode: "previous" };
  else if (compare === "ly") state.compare = { mode: "same_last_year" };
  else if (compare && compare.includes("..")) {
    const [a, b] = compare.split("..");
    if (ISO_DATE.test(a) && ISO_DATE.test(b)) state.compare = { mode: "custom", start: a, end: b };
  }
  return state;
}

/** Coverage of the dataset, computed from the data (see coverage.ts). */
export interface MonthCoverage {
  month: string;        // YYYY-MM
  posts: number;
  comments: number;
  /** True when the data delivered so far reaches the end of the month. */
  complete: boolean;
}
export interface Coverage {
  firstDate: string | null;   // first post or comment date (ISO date)
  lastDate: string | null;    // last post or comment date (ISO date)
  /** Latest date the delivered data is known to cover (from imports), else lastDate. */
  coveredTo: string | null;
  months: MonthCoverage[];
  posts: number;
  comments: number;
}
