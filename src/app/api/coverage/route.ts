import { NextResponse } from "next/server";
import { getCoverage } from "@/lib/coverage";

export const dynamic = "force-dynamic";

/** What the dataset covers: date range, months with data, which months are complete. */
export async function GET() {
  try {
    return NextResponse.json(await getCoverage());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
