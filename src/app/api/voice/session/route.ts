import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureReady } from "@/lib/schema";
import { assertCanSpend } from "@/lib/llm";
import { getDashboard } from "@/lib/dashboards";
import { runForDashboard } from "@/lib/scope";
import { createVoiceSession } from "@/lib/voice";
import { WidgetSpecSchema } from "@/lib/widgets";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  widget: WidgetSpecSchema,
  rows: z.array(z.record(z.string(), z.unknown())).max(500).default([]),
  dashboardId: z.string().optional(),
});

/** Mints a short-lived Realtime client secret for a voice session about one element. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    await ensureReady();
    await assertCanSpend();
    const dashboard = parsed.data.dashboardId ? await getDashboard(parsed.data.dashboardId) : null;
    const session = await runForDashboard(dashboard, () => createVoiceSession(parsed.data.widget, parsed.data.rows));
    return NextResponse.json(session);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    const msg = err.status === 401 ? "The OpenAI key was rejected (401). Check OPEN_AI_KEY and redeploy." : (err.message ?? "Could not start the voice session");
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
