import { NextResponse } from "next/server";
import { getCoverage } from "@/lib/coverage";
import { createDashboard, updateDashboard } from "@/lib/dashboards";
import { GOALS, STEP_IDS, WizardAnswersSchema, WIZARD_INTRO, WIZARD_STEPS, stepOrder, type OnboardingState } from "@/lib/wizard";

export const dynamic = "force-dynamic";

/** Creates the blank dashboard the guided setup fills, and returns the wizard definition the page needs. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const name = (body.name ?? "").trim() || "New dashboard (setup in progress)";
  const answers = WizardAnswersSchema.parse({});
  const onboarding: OnboardingState = { version: 1, answers, order: stepOrder(answers.goal), currentStep: 0, startedAt: new Date().toISOString(), completedAt: null };
  const created = await createDashboard({ name, template: "blank" });
  const dashboard = await updateDashboard(created.id, { onboarding });
  return NextResponse.json({ dashboard }, { status: 201 });
}

/** The wizard definition (questions, choices, goals, intro) plus coverage, for rendering the page. */
export async function GET() {
  const coverage = await getCoverage();
  return NextResponse.json({
    intro: WIZARD_INTRO,
    goals: GOALS,
    stepIds: STEP_IDS,
    steps: WIZARD_STEPS.map((s) => ({ id: s.id, question: s.question, short: s.short, choices: s.choices })),
    coverage,
  });
}
