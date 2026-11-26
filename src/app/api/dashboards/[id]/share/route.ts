import { NextResponse } from "next/server";
import { z } from "zod";
import { getDashboard } from "@/lib/dashboards";
import { PeriodStateSchema } from "@/lib/period";
import { createShareLink, listShareLinks, revokeShareLink } from "@/lib/share";
import { siteLocked } from "@/lib/gate";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** The dashboard's share links, and whether the rest of the site is behind a passcode. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!(await getDashboard(id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ links: await listShareLinks(id), siteLocked: siteLocked() });
}

const Body = z.object({ period: PeriodStateSchema.nullable().optional(), view: z.enum(["summary", "full"]).optional(), leader: z.string().max(40).nullable().optional() });

/** Makes (or finds) the link for a view of the dashboard. */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!(await getDashboard(id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const link = await createShareLink(id, { period: parsed.data.period ?? null, view: parsed.data.view ?? "summary", leader: parsed.data.leader ?? null });
  return NextResponse.json({ link, links: await listShareLinks(id), siteLocked: siteLocked() }, { status: 201 });
}

/** Switches a link off. */
export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const token = new URL(req.url).searchParams.get("token") ?? "";
  await revokeShareLink(id, token);
  return NextResponse.json({ links: await listShareLinks(id) });
}
