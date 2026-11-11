import { NextResponse } from "next/server";
import { clearMessages, listMessages } from "@/lib/claude";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return NextResponse.json({ messages: await listMessages(id) });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  await clearMessages(id);
  return NextResponse.json({ ok: true });
}
