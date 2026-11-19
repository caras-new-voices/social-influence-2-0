import { NextResponse } from "next/server";
import { getDashboard } from "@/lib/dashboards";
import { ISO_MONTH } from "@/lib/period";
import { generateMonthReview, getStoredReport } from "@/lib/reports";
import { OUT_OF_TOKENS, OUT_OF_TOKENS_MESSAGE } from "@/lib/usage-shared";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Ctx = { params: Promise<{ id: string; month: string }> };

const marketOf = (req: Request) => (new URL(req.url).searchParams.get("market") ?? "").slice(0, 80) || undefined;

export async function GET(req: Request, ctx: Ctx) {
  const { id, month } = await ctx.params;
  if (!ISO_MONTH.test(month)) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  const report = await getStoredReport(id, month, marketOf(req));
  return NextResponse.json({ report });
}

/** Generates (or with ?force=1 regenerates) the month in review. ?market= writes it for one market. */
export async function POST(req: Request, ctx: Ctx) {
  const { id, month } = await ctx.params;
  if (!ISO_MONTH.test(month)) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  const dashboard = await getDashboard(id);
  if (!dashboard) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const force = new URL(req.url).searchParams.get("force") === "1";
  try {
    const report = await generateMonthReview(id, month, { force, market: marketOf(req) });
    return NextResponse.json({ report });
  } catch (e) {
    const message = (e as Error).message;
    if (message === OUT_OF_TOKENS_MESSAGE) return NextResponse.json({ error: message, code: OUT_OF_TOKENS }, { status: 402 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
