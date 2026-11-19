import { NextResponse } from "next/server";
import { z } from "zod";
import { getDashboard } from "@/lib/dashboards";
import { listActions, setAction, themeOptions } from "@/lib/reports";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** The themes this dashboard's team acted on, and the themes that can be picked. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!(await getDashboard(id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json({ actions: await listActions(id), themes: await themeOptions(id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

const Body = z.object({ theme: z.string().min(1).max(200), remove: z.boolean().optional() });

/** Marks a theme as acted on, or with remove: true takes the mark away. */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!(await getDashboard(id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    await setAction(id, parsed.data.theme, parsed.data.remove);
    return NextResponse.json({ actions: await listActions(id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
