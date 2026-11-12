import { NextResponse } from "next/server";
import type { Row } from "@/lib/db";
import { importBatch, isAuthorized, listImports } from "@/lib/imports";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Request bodies above this size should go through the CLI (Vercel caps function bodies at 4.5 MB). */
const MAX_BYTES = 8 * 1024 * 1024;

interface ImportBody {
  source?: string;
  covers_from?: string;
  covers_to?: string;
  segments?: Row[];
  posts?: Row[];
  comments?: Row[];
  influencers?: Row[];
}

/** Latest imports, newest first. */
export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ imports: await listImports(20) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** Loads one export batch (JSON). Idempotent; returns the import row and the period events it produced. */
export async function POST(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return NextResponse.json({ error: `Body too large (max ${MAX_BYTES / 1024 / 1024} MB); use npm run import for large drops` }, { status: 413 });
  const text = await req.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: "Body too large" }, { status: 413 });
  let body: ImportBody;
  try {
    body = JSON.parse(text) as ImportBody;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  for (const k of ["segments", "posts", "comments", "influencers"] as const) {
    if (body[k] !== undefined && !Array.isArray(body[k])) return NextResponse.json({ error: `${k} must be an array of rows` }, { status: 400 });
  }
  if (!body.segments?.length && !body.posts?.length && !body.comments?.length && !body.influencers?.length) {
    return NextResponse.json({ error: "Nothing to import: send segments, posts, comments or influencers" }, { status: 400 });
  }
  try {
    const result = await importBatch({
      source: (body.source ?? "api").toString().slice(0, 120),
      coversFrom: body.covers_from ?? null,
      coversTo: body.covers_to ?? null,
      segments: body.segments,
      posts: body.posts,
      comments: body.comments,
      influencers: body.influencers,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: /must be|after covers_to/.test(msg) ? 400 : 500 });
  }
}
