import { NextResponse } from "next/server";
import { getDashboard } from "@/lib/dashboards";
import { listMonthReports } from "@/lib/reports";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** One row per month with headline numbers, the previous month's numbers and any stored review. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const dashboard = await getDashboard(id);
  if (!dashboard) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json(await listMonthReports(id));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
