import { NextResponse } from "next/server";
import { z } from "zod";
import { effectiveWindow, resolveCompare, resolveWindow } from "@/lib/period";
import { resolveScope, runInScope } from "@/lib/scope";
import { getSharedView } from "@/lib/share";
import { answerWidget, requestWindow } from "@/lib/widget-data";
import { isDataWidget } from "@/lib/widgets";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ token: string }> };

const Body = z.object({ sql: z.string().min(1).max(20000) });

/**
 * The answer to one box of a shared dashboard. The query must be one that is on the dashboard the
 * link opens; the brands, the period and the market come from the dashboard and the link, never
 * from the request. So a link can read its own dashboard's boxes and nothing else.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  const shared = await getSharedView(token);
  if (!shared) return NextResponse.json({ error: "This link is no longer active" }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { dashboard, settings } = shared;
  const w = dashboard.widgets.find((x) => x.sql === parsed.data.sql && isDataWidget(x.type));
  if (!w) return NextResponse.json({ error: "That box is not on this dashboard" }, { status: 403 });
  const win = effectiveWindow(resolveWindow(settings.period), w.period);
  const compare = w.period && w.period !== "inherit" ? null : resolveCompare(settings.period);
  return runInScope(resolveScope(dashboard.scope), async () => {
    const out = await answerWidget(w.sql!, requestWindow(win), compare ? requestWindow(compare) : undefined, w.sample?.sql);
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: 400 });
    return NextResponse.json(out.body);
  });
}
