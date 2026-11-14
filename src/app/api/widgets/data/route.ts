import { NextResponse } from "next/server";
import { z } from "zod";
import { ISO_DATE } from "@/lib/period";
import { runWidgetQuery } from "@/lib/query";

export const dynamic = "force-dynamic";

const WindowSchema = z.object({ start: z.string().regex(ISO_DATE).optional(), end: z.string().regex(ISO_DATE).optional() }).nullable().optional();
const BodySchema = z.object({
  sql: z.string().min(1),
  /** Main window; omit for all time. */
  window: WindowSchema,
  /** Comparison window; when present the query runs a second time and compareRows is returned. */
  compare: WindowSchema,
  /** Optional sample check: one row with column n, run in the main window. */
  sampleSql: z.string().max(2000).optional(),
});

/** Executes a widget's saved SQL (within the dashboard period) and returns rows for rendering. */
export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const { sql, window, compare, sampleSql } = parsed.data;
  const result = await runWidgetQuery(sql, undefined, window ?? undefined);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  let compareRows: typeof result.rows | undefined;
  if (compare) {
    const c = await runWidgetQuery(sql, undefined, compare);
    compareRows = c.ok ? c.rows : [];
  }
  let sample: number | undefined;
  if (sampleSql) {
    const s = await runWidgetQuery(sampleSql, 1, window ?? undefined);
    if (s.ok) sample = Number(s.rows[0]?.n ?? 0) || 0;
  }
  return NextResponse.json({ rows: result.rows, columns: result.columns, truncated: result.truncated, compareRows, sample });
}
