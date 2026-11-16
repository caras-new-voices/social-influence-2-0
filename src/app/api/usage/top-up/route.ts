import { NextResponse } from "next/server";
import { topUp, topUpEnabled } from "@/lib/usage";

export const dynamic = "force-dynamic";

/** Demo top-up: adds tokens to the account without payment. Disabled with DEMO_TOPUP=0. */
export async function POST(req: Request) {
  if (!topUpEnabled()) return NextResponse.json({ error: "Adding tokens is turned off on this deployment." }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { tokens?: number };
  try {
    return NextResponse.json(await topUp(Number(body.tokens)));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
