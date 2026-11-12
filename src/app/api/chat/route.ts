import { z } from "zod";
import { runChatTurn, type ChatEvent } from "@/lib/claude";
import { getDashboard } from "@/lib/dashboards";
import { PeriodStateSchema } from "@/lib/period";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BodySchema = z.object({
  dashboardId: z.string().min(1),
  message: z.string().min(1).max(4000),
  instruction: z.string().max(6000).optional(),
  widgets: z.array(z.object({ id: z.string(), type: z.string(), title: z.string() })).default([]),
  period: PeriodStateSchema.optional(),
});

/** Streams newline-delimited JSON chat events. */
export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return new Response(JSON.stringify({ error: parsed.error.message }), { status: 400 });
  const { dashboardId, message, instruction, widgets, period } = parsed.data;
  const dashboard = await getDashboard(dashboardId);
  if (!dashboard) return new Response(JSON.stringify({ error: "Dashboard not found" }), { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ChatEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        for await (const ev of runChatTurn({ dashboardId, userText: message, instruction, widgets, period: period ?? dashboard.period ?? undefined }, dashboard.widgets)) send(ev);
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
        send({ type: "done", messageId: null });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
