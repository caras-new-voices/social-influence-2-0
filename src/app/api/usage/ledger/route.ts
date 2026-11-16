import { NextResponse } from "next/server";
import { getStatement } from "@/lib/usage";

export const dynamic = "force-dynamic";

/** The account statement: grants, top-ups and daily usage with the balance after each. */
export async function GET() {
  try {
    return NextResponse.json({ statement: await getStatement() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
