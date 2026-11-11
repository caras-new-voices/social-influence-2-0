import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteDashboard, duplicateDashboard, getDashboard, updateDashboard } from "@/lib/dashboards";
import { WidgetSpecSchema } from "@/lib/widgets";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const dashboard = await getDashboard(id);
  if (!dashboard) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ dashboard });
}

const PatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(600).nullable().optional(),
  widgets: z.array(WidgetSpecSchema).optional(),
});

export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const dashboard = await updateDashboard(id, parsed.data);
  if (!dashboard) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ dashboard });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  await deleteDashboard(id);
  return NextResponse.json({ ok: true });
}

/** Duplicates the dashboard. */
export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const dashboard = await duplicateDashboard(id);
  if (!dashboard) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ dashboard }, { status: 201 });
}
