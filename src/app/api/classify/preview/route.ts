import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { isAuthorized } from "@/lib/imports";
import { previewReading } from "@/lib/live-classify";
import { ensureReady } from "@/lib/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  industry: z.string().min(1).max(80),
  posts: z.array(z.object({ segment_id: z.number().int(), post_id: z.number().int() })).max(400).optional(),
  comments: z.array(z.object({ segment_id: z.number().int(), comment_id: z.number().int() })).max(600).optional(),
});

/**
 * Reads the given posts and comments the way a new import is read, and returns the readings
 * without storing them. For measuring the reader against rows whose labels are already known
 * (scripts/check_live_reader.py). Protected like the imports route.
 */
export async function POST(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Each call costs model tokens: on a deployed site it is closed unless a token protects it.
  if (process.env.VERCEL && !process.env.IMPORT_TOKEN) return NextResponse.json({ error: "Set IMPORT_TOKEN to use the preview on a deployed site" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    await ensureReady();
    return NextResponse.json(await previewReading(await getDb(), parsed.data.industry, parsed.data.posts ?? [], parsed.data.comments ?? []));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
