import { NextResponse } from "next/server";
import { createDashboard, listDashboards } from "@/lib/dashboards";
import { isTemplateId } from "@/lib/templates";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ dashboards: await listDashboards() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { name?: string; description?: string; template?: string };
  const name = (body.name ?? "").trim() || "Untitled dashboard";
  const dashboard = await createDashboard({
    name,
    description: body.description,
    template: isTemplateId(body.template) ? body.template : "default",
  });
  return NextResponse.json({ dashboard }, { status: 201 });
}
