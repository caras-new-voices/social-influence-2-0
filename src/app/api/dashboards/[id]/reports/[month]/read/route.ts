import { NextResponse } from "next/server";
import { getDashboard } from "@/lib/dashboards";
import { ISO_MONTH } from "@/lib/period";
import { getMonthRead } from "@/lib/reports";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
type Ctx = { params: Promise<{ id: string; month: string }> };

/** The monthly read: the eight measures and the volume counts for the month and the month before. ?market= narrows it to one market. */
export async function GET(req: Request, ctx: Ctx) {
  const { id, month } = await ctx.params;
  if (!ISO_MONTH.test(month)) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  if (!(await getDashboard(id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const market = (new URL(req.url).searchParams.get("market") ?? "").slice(0, 80) || undefined;
  try {
    return NextResponse.json(await getMonthRead(id, month, market));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
