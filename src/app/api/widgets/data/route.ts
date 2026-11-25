import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureReady } from "@/lib/schema";
import { resolveScope, runInScope } from "@/lib/scope";
import { answerWidget, WindowSchema } from "@/lib/widget-data";

export const dynamic = "force-dynamic";

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

/**
 * Executes a widget's saved SQL (within the dashboard period) and returns rows for rendering.
 * The same box for the same brands, period and market is answered from the store until the data changes.
 */
export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const { sql, window, compare, sampleSql } = parsed.data;
  await ensureReady();
  return runInScope(resolveScope(parsed.data.scope), async () => {
    const out = await answerWidget(sql, window, compare, sampleSql);
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: 400 });
    return NextResponse.json(out.body, out.stored ? { headers: { "x-cache": "hit" } } : undefined);
  });
}
