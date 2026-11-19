import { NextResponse } from "next/server";
import { getCoverage } from "@/lib/coverage";
import { ensureReady } from "@/lib/schema";
import { resolveScope, runInScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

/** What the data covers for a brand scope (?scope=<json>, default: the live industry): date range, months with data, which months are complete. ?market= gives them for one market. */
export async function GET(req: Request) {
  try {
    await ensureReady();
    const params = new URL(req.url).searchParams;
    const scope = resolveScope(params.get("scope"));
    const market = (params.get("market") ?? "").slice(0, 80) || undefined;
    return NextResponse.json(await runInScope(scope, () => getCoverage(market)));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
