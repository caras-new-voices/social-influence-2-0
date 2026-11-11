import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureReady } from "@/lib/schema";
import { hasWorkspaceHeader, llmMode } from "@/lib/claude";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureReady();
    const db = await getDb();
    const [p] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM posts");
    const [c] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM comments");
    return NextResponse.json({
      ok: true,
      db: db.kind,
      posts: p.n,
      comments: c.n,
      llm: llmMode(),
      model: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
      workspaceHeader: hasWorkspaceHeader(),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
