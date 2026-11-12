import { NextResponse } from "next/server";
import { getDashboard } from "@/lib/dashboards";
import { ISO_MONTH } from "@/lib/period";
import { generateMonthReview, getStoredReport } from "@/lib/reports";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Ctx = { params: Promise<{ id: string; month: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id, month } = await ctx.params;
  if (!ISO_MONTH.test(month)) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  const report = await getStoredReport(id, month);
  return NextResponse.json({ report });
}

/** Generates (or with ?force=1 regenerates) the month in review. */
export async function POST(req: Request, ctx: Ctx) {
  const { id, month } = await ctx.params;
  if (!ISO_MONTH.test(month)) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  const dashboard = await getDashboard(id);
  if (!dashboard) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const force = new URL(req.url).searchParams.get("force") === "1";
  try {
    const report = await generateMonthReview(id, month, { force });
    return NextResponse.json({ report });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
