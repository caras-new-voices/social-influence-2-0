import { NextResponse } from "next/server";
import { z } from "zod";
import { getCoverage, latestMonth } from "@/lib/coverage";
import { getDashboard, updateDashboard } from "@/lib/dashboards";
import { addDays, monthPeriod, type PeriodState } from "@/lib/period";
import { layoutSections, type TemplateSection } from "@/lib/templates";
import { WidgetSpecSchema, materialize, type WidgetSpec } from "@/lib/widgets";
import { STEP_IDS, STEPS_BY_ID, stepProposals, WizardAnswersSchema, type StepId } from "@/lib/wizard";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  dashboardId: z.string().min(1),
  name: z.string().min(1).max(120),
  answers: WizardAnswersSchema,
  order: z.array(z.enum(STEP_IDS)),
  /** Elements accepted per step, in the order they should appear. */
  accepted: z.record(z.string(), z.array(WidgetSpecSchema.omit({ layout: true }).extend({ layout: WidgetSpecSchema.shape.layout.optional() }))).default({}),
  /** Fill the steps with nothing accepted using their personalised defaults. */
  fillRest: z.boolean().default(false),
});

/** Lays the accepted elements out by question, sets the default period and marks the setup complete. */
export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const { dashboardId, name, answers, order, accepted, fillRest } = parsed.data;
  const dashboard = await getDashboard(dashboardId);
  if (!dashboard) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sections: TemplateSection[] = [];
  let n = 0;
  for (const stepId of order) {
    const step = STEPS_BY_ID[stepId as StepId];
    let widgets: WidgetSpec[] = (accepted[stepId] ?? []).map((w) => ({ ...w, layout: w.layout ?? { x: 0, y: 0, w: 6, h: 5 } }));
    const skipped = answers.steps[stepId]?.skipped;
    if (!widgets.length && fillRest && !skipped) {
      widgets = stepProposals(stepId as StepId, answers).map((p) => materialize(p, []));
    }
    if (!widgets.length) continue;
    n += 1;
    sections.push({
      title: `${n}. ${step.question}`,
      widgets: widgets.map((w) => {
        const { layout, id, ...spec } = w;
        void id;
        return { ...spec, w: layout.w, h: layout.h };
      }),
    });
  }
  const laidOut = layoutSections(sections);

  let period: PeriodState | null = null;
  const cov = await getCoverage();
  if (answers.view === "month") {
    const m = latestMonth(cov);
    if (m) period = monthPeriod(m, { mode: "previous" });
  } else if (answers.view === "90d" && cov.lastDate) {
    period = { mode: "range", start: addDays(cov.lastDate, -89), end: addDays(cov.lastDate, 1), compare: { mode: "previous" } };
  }

  const onboarding = dashboard.onboarding
    ? { ...dashboard.onboarding, answers, order, completedAt: new Date().toISOString(), currentStep: order.length }
    : { version: 1 as const, answers, order, currentStep: order.length, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
  const updated = await updateDashboard(dashboardId, { name, widgets: laidOut, period, onboarding });
  return NextResponse.json({ dashboard: updated, elements: laidOut.length, period });
}
