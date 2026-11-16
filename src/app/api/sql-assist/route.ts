import { NextResponse } from "next/server";
import { z } from "zod";
import { assistSql } from "@/lib/sql-assist";
import { getDashboard } from "@/lib/dashboards";
import { ensureReady } from "@/lib/schema";
import { runForDashboard } from "@/lib/scope";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({
  mode: z.enum(["explain", "modify"]),
  sql: z.string().min(1).max(12000),
  request: z.string().max(2000).optional(),
  dashboardId: z.string().optional(),
  widget: z.object({ title: z.string().optional(), type: z.string().optional(), x: z.string().optional(), y: z.string().optional(), series: z.string().optional() }).default({}),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    await ensureReady();
    const dashboard = parsed.data.dashboardId ? await getDashboard(parsed.data.dashboardId) : null;
    const result = await runForDashboard(dashboard, () => assistSql(parsed.data));
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
