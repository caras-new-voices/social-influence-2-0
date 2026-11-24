import { NextResponse } from "next/server";
import { z } from "zod";
import { ISO_DATE } from "@/lib/period";
import { runWidgetQuery } from "@/lib/query";
import { ensureReady } from "@/lib/schema";
import { cacheGet, cacheKey, cachePut } from "@/lib/query-cache";
import { resolveScope, runInScope, scopeSettings } from "@/lib/scope";

export const dynamic = "force-dynamic";

const WindowSchema = z.object({ start: z.string().regex(ISO_DATE).optional(), end: z.string().regex(ISO_DATE).optional(), market: z.string().max(80).optional() }).nullable().optional();
const BodySchema = z.object({
  sql: z.string().min(1),
  /** Main window; omit for all time. */
  window: WindowSchema,
  /** Comparison window; when present the query runs a second time and compareRows is returned. */
  compare: WindowSchema,
  /** Optional sample check: one row with column n, run in the main window. */
  sampleSql: z.string().max(2000).optional(),
  /** The dashboard's brand scope; omit for the default selection. */
  scope: z.unknown().optional(),
});

/** Executes a widget's saved SQL (within the dashboard period) and returns rows for rendering. */
export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const { sql, window, compare, sampleSql } = parsed.data;
  await ensureReady();
  return runInScope(resolveScope(parsed.data.scope), () => run(sql, window, compare, sampleSql));
}

type Window = z.infer<typeof WindowSchema>;
async function run(sql: string, window: Window, compare: Window, sampleSql?: string) {
  // The same box for the same brands, period and market is answered from the store until the data changes.
  const key = cacheKey({ sql, window: window ?? null, compare: compare ?? null, sampleSql: sampleSql ?? null, scope: scopeSettings() });
  const stored = await cacheGet<Record<string, unknown>>(key);
  if (stored) return NextResponse.json(stored, { headers: { "x-cache": "hit" } });
  const result = await runWidgetQuery(sql, undefined, window ?? undefined);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  let complete = true;
  let compareRows: typeof result.rows | undefined;
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
  const body = { rows: result.rows, columns: result.columns, truncated: result.truncated, compareRows, sample };
  // Only a complete answer is stored: a comparison that failed is tried again next time.
  if (complete) await cachePut(key, body);
  return NextResponse.json(body);
}
