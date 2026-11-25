import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureReady } from "@/lib/schema";
import { hasWorkspaceHeader, llmMode, llmModel } from "@/lib/claude";
import { liveReadingEnabled, pendingReads } from "@/lib/live-classify";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureReady();
    const db = await getDb();
    const [p] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM posts_raw");
    const [c] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM comments_raw");
    return NextResponse.json({
      ok: true,
      db: db.kind,
      posts: p.n,
      comments: c.n,
      llm: llmMode(),
      model: llmModel(),
      workspaceHeader: hasWorkspaceHeader(),
      // New posts and comments waiting for the model's reading (run /api/cron/upkeep), and whether it can read them.
      newRows: { reader: liveReadingEnabled(), waiting: await pendingReads(db).catch(() => []) },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
