import { z } from "zod";
import { runChatTurn, type ChatEvent } from "@/lib/claude";
import { getDashboard } from "@/lib/dashboards";
import { PeriodStateSchema, resolveWindow } from "@/lib/period";
import { runWidgetQuery } from "@/lib/query";
import { STEP_IDS, STEPS_BY_ID, stepDiscussInstruction, stepInstruction, stepProposals, WizardAnswersSchema } from "@/lib/wizard";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BodySchema = z.object({
  dashboardId: z.string().min(1),
  stepId: z.enum(STEP_IDS),
  answers: WizardAnswersSchema,
  period: PeriodStateSchema.optional(),
  /** propose: run the step (data summary + proposals). discuss: a free message on the step. */
  mode: z.enum(["propose", "discuss"]).default("propose"),
  text: z.string().max(2000).optional(),
  /** Elements currently proposed on the step (for replaces_widget_id in discuss mode). */
  proposed: z.array(z.object({ id: z.string(), title: z.string() })).default([]),
});

/** Runs one guided-setup step and streams the analyst's events (NDJSON, same shape as /api/chat). */
export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return new Response(JSON.stringify({ error: parsed.error.issues[0]?.message ?? "Invalid request" }), { status: 400 });
  const { dashboardId, stepId, answers, period, mode, text, proposed } = parsed.data;
  const dashboard = await getDashboard(dashboardId);
  if (!dashboard) return new Response(JSON.stringify({ error: "Dashboard not found" }), { status: 404 });
  const step = STEPS_BY_ID[stepId];

  let userText: string;
  let instruction: string;
  let wizard: { text: string; proposals: ReturnType<typeof stepProposals> } | undefined;
  if (mode === "discuss") {
    if (!text?.trim()) return new Response(JSON.stringify({ error: "text is required" }), { status: 400 });
    userText = text.trim();
    instruction = stepDiscussInstruction(stepId, answers, userText, proposed);
    wizard = { text: `In demo mode I can't answer free questions yet, but the elements proposed above follow your choices. With an API key configured, I'd answer "${userText}" with numbers from the data and adjust the elements.`, proposals: [] };
  } else {
    const res = await runWidgetQuery(step.dataSql(answers), 5, resolveWindow(period ?? dashboard.period));
    const rows = res.ok ? res.rows : [];
    const summary = step.dataText(rows, answers);
    const proposals = stepProposals(stepId, answers);
    const st = answers.steps[stepId];
    const chosen = step.choices.map((c) => `${c.label}: ${(st?.choices?.[c.key]?.length ? st.choices[c.key] : c.default).join(", ")}`).join(" · ");
    userText = `${step.question}\n${chosen}${st?.text ? `\n${st.text}` : ""}`;
    instruction = stepInstruction(stepId, answers, summary, proposals);
    wizard = { text: summary, proposals };
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ChatEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        for await (const ev of runChatTurn({ dashboardId, userText, instruction, widgets: [], period: period ?? dashboard.period ?? undefined, wizard }, dashboard.widgets)) send(ev);
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
        send({ type: "done", messageId: null });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
