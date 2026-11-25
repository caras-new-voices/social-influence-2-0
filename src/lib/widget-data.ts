import { z } from "zod";
import { ISO_DATE } from "./period";
import { cacheGet, cacheKey, cachePut } from "./query-cache";
import { runWidgetQuery } from "./query";
import type { Row } from "./db";
import { scopeSettings } from "./scope";

/** A window as a box's request carries it. Parsing through this gives one spelling per window, which the stored answers are keyed on. */
export const WindowSchema = z.object({ start: z.string().regex(ISO_DATE).optional(), end: z.string().regex(ISO_DATE).optional(), market: z.string().max(80).optional() }).nullable().optional();
export type RequestWindow = z.infer<typeof WindowSchema>;

export interface WidgetAnswer { rows: Row[]; columns: string[]; truncated: boolean; compareRows?: Row[]; sample?: number }
export type WidgetOutcome = { ok: true; body: WidgetAnswer; stored: boolean } | { ok: false; error: string };

/** What the page sends for a window: nothing at all when it has no dates and no market. */
export function requestWindow(w: { start?: string; end?: string; market?: string } | null | undefined): RequestWindow {
  return w && (w.start || w.end || w.market) ? WindowSchema.parse(w) : undefined;
}

/**
 * A box's answer inside the current scope: from the store when the same query, brands, period and
 * market were answered since the data last changed, else worked out and stored. `peek` only says
 * whether a stored answer exists.
 */
export async function answerWidget(sql: string, window: RequestWindow, compare: RequestWindow, sampleSql?: string): Promise<WidgetOutcome> {
  const key = cacheKey({ sql, window: window ?? null, compare: compare ?? null, sampleSql: sampleSql ?? null, scope: scopeSettings() });
  const stored = await cacheGet<WidgetAnswer>(key);
  if (stored) return { ok: true, body: stored, stored: true };
  const result = await runWidgetQuery(sql, undefined, window ?? undefined);
  if (!result.ok) return { ok: false, error: result.error };
  // Only a complete answer is stored: a comparison or a sample that failed is tried again next time.
  let complete = true;
  let compareRows: Row[] | undefined;
  if (compare) {
    const c = await runWidgetQuery(sql, undefined, compare);
    compareRows = c.ok ? c.rows : [];
    if (!c.ok) complete = false;
  }
  let sample: number | undefined;
  if (sampleSql) {
    const s = await runWidgetQuery(sampleSql, 1, window ?? undefined);
    if (s.ok) sample = Number(s.rows[0]?.n ?? 0) || 0;
    else complete = false;
  }
  const body: WidgetAnswer = { rows: result.rows, columns: result.columns, truncated: result.truncated, compareRows, sample };
  if (complete) await cachePut(key, body);
  return { ok: true, body, stored: false };
}
