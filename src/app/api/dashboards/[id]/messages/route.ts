import { NextResponse } from "next/server";
import { clearMessages, listSessionMessages } from "@/lib/claude";
import { listSessions } from "@/lib/chat-sessions";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  // The most recently used chat session, so a dashboard opens where the person left off.
  const latest = (await listSessions(id))[0] ?? null;
  return NextResponse.json({ session: latest, messages: latest ? await listSessionMessages(latest.id) : [] });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  await clearMessages(id);
  return NextResponse.json({ ok: true });
}
