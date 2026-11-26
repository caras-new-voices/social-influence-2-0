import { NextResponse } from "next/server";
import { getDashboard } from "@/lib/dashboards";
import { templateUpdate } from "@/lib/template-update";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

/** What the dashboard is missing against the current version of its template. Changes nothing. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const dashboard = await getDashboard(id);
  if (!dashboard) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json(await templateUpdate(dashboard));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
