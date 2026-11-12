import { NextResponse } from "next/server";
import { listPeriodEvents } from "@/lib/period-events";

export const dynamic = "force-dynamic";

/** Period events newer than ?since=<id>, newest first, each with its import. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const since = Number(url.searchParams.get("since") ?? 0) || 0;
  const limit = Number(url.searchParams.get("limit") ?? 30) || 30;
  try {
    return NextResponse.json({ events: await listPeriodEvents({ since, limit }) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
