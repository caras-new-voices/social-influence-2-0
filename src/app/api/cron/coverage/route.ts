import { NextResponse } from "next/server";
import { getCoverage } from "@/lib/coverage";
import { isAuthorized } from "@/lib/imports";
import { checkCalendarCoverage } from "@/lib/period-events";

export const dynamic = "force-dynamic";

/**
 * Daily calendar check (vercel.json cron): if last month is not complete in the coverage and no
 * `month_missing` event exists for it yet, records one, so a quiet exporter produces a warning.
 */
async function run(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await checkCalendarCoverage(await getCoverage());
    const action = result.complete ? "none: month complete" : result.created ? "created month_missing event" : "none: month_missing already recorded";
    return NextResponse.json({ ...result, action });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
