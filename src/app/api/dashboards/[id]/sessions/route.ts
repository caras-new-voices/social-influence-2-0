import { NextResponse } from "next/server";
import { listSessions } from "@/lib/chat-sessions";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** The dashboard's chat sessions, most recently used first. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return NextResponse.json({ sessions: await listSessions(id) });
}
