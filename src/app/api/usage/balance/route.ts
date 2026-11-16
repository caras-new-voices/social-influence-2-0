import { NextResponse } from "next/server";
import { getBalance } from "@/lib/usage";

export const dynamic = "force-dynamic";

/** Token balance, today's and this month's usage. ?dashboard=<id> adds that dashboard's month total. */
export async function GET(req: Request) {
  try {
    return NextResponse.json(await getBalance(new URL(req.url).searchParams.get("dashboard")));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
