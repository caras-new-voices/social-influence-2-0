import { NextResponse } from "next/server";
import { createDashboard, listDashboards } from "@/lib/dashboards";
import { normalizeScope } from "@/lib/catalog";
import { ensureReady } from "@/lib/schema";
import { toTemplateId } from "@/lib/templates";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ dashboards: await listDashboards() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { name?: string; description?: string; template?: string; scope?: unknown };
  await ensureReady();
  // The brands the dashboard looks at: one industry, one brand as "us", the chosen competitors.
  const scope = body.scope ? normalizeScope(body.scope) : null;
  if (body.scope && !scope) return NextResponse.json({ error: "Unknown industry or brand in the selection" }, { status: 400 });
  const name = (body.name ?? "").trim() || "Untitled dashboard";
  const dashboard = await createDashboard({
    name,
    description: body.description,
    template: toTemplateId(body.template),
    scope,
  });
  return NextResponse.json({ dashboard }, { status: 201 });
}
