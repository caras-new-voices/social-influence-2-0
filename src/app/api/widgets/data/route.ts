import { NextResponse } from "next/server";
import { runWidgetQuery } from "@/lib/query";

export const dynamic = "force-dynamic";

/** Executes a widget's saved SQL and returns rows for rendering. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { sql?: string };
  if (!body.sql) return NextResponse.json({ error: "sql is required" }, { status: 400 });
  const result = await runWidgetQuery(body.sql);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ rows: result.rows, columns: result.columns, truncated: result.truncated });
}
