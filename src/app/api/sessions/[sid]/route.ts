import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteSession, getSession, renameSession } from "@/lib/chat-sessions";
import { listSessionMessages } from "@/lib/claude";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ sid: string }> };

/** One chat session and its messages. */
export async function GET(_req: Request, ctx: Ctx) {
  const { sid } = await ctx.params;
  const session = await getSession(sid);
  if (!session) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  return NextResponse.json({ session, messages: await listSessionMessages(sid) });
}

const RenameSchema = z.object({ title: z.string().min(1).max(120) });

/** Renames a chat session. */
export async function PATCH(req: Request, ctx: Ctx) {
  const { sid } = await ctx.params;
  const parsed = RenameSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "A title is required" }, { status: 400 });
  const session = await renameSession(sid, parsed.data.title);
  if (!session) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  return NextResponse.json({ session });
}

/** Deletes a chat session and its messages. Elements already on the dashboard stay. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { sid } = await ctx.params;
  await deleteSession(sid);
  return NextResponse.json({ ok: true });
}
