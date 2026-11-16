import { NextResponse } from "next/server";
import { ISO_DATE } from "@/lib/period";
import { getBalance, getUsageSummary } from "@/lib/usage";

export const dynamic = "force-dynamic";

/** Totals, the daily series and the breakdowns for the usage page. ?from=YYYY-MM-DD&to=YYYY-MM-DD (to exclusive). */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const from = sp.get("from"), to = sp.get("to");
  if ((from && !ISO_DATE.test(from)) || (to && !ISO_DATE.test(to))) return NextResponse.json({ error: "from and to must be YYYY-MM-DD" }, { status: 400 });
  try {
    const [summary, balance] = await Promise.all([getUsageSummary({ from: from ?? undefined, to: to ?? undefined }), getBalance()]);
    return NextResponse.json({ ...summary, balance });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
