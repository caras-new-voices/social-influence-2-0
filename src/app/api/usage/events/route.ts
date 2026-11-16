import { NextResponse } from "next/server";
import { ISO_DATE } from "@/lib/period";
import { eventsToCsv, listUsageEvents } from "@/lib/usage";

export const dynamic = "force-dynamic";

/** The usage log, newest first. Filters: dashboard, kind, from, to, before (event id), limit. format=csv exports it. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const from = sp.get("from"), to = sp.get("to");
  if ((from && !ISO_DATE.test(from)) || (to && !ISO_DATE.test(to))) return NextResponse.json({ error: "from and to must be YYYY-MM-DD" }, { status: 400 });
  const csv = sp.get("format") === "csv";
  try {
    const events = await listUsageEvents({
      from: from ?? undefined, to: to ?? undefined,
      dashboardId: sp.get("dashboard") ?? undefined, kind: sp.get("kind") ?? undefined,
      before: sp.get("before") ? Number(sp.get("before")) : undefined,
      limit: csv ? 5000 : sp.get("limit") ? Number(sp.get("limit")) : 100,
    });
    if (csv) return new Response(eventsToCsv(events), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="token-usage.csv"' } });
    return NextResponse.json({ events });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
