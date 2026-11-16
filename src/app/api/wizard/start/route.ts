import { NextResponse } from "next/server";
import { getCoverage } from "@/lib/coverage";
import { getWorkspace } from "@/lib/brands";
import { normalizeScope, scopeOrDefault, workspaceFor } from "@/lib/catalog";
import { createDashboard, getDashboard, updateDashboard } from "@/lib/dashboards";
import { ensureReady } from "@/lib/schema";
import { resolveScope, runForDashboard, runInScope } from "@/lib/scope";
import { GOALS, STEP_IDS, WizardAnswersSchema, wizardIntro, WIZARD_STEPS, stepOrder, type OnboardingState } from "@/lib/wizard";

export const dynamic = "force-dynamic";

/** Creates the blank dashboard the guided setup fills, and returns the wizard definition the page needs. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { name?: string; scope?: unknown };
  await ensureReady();
  const scope = body.scope ? normalizeScope(body.scope) : null;
  if (body.scope && !scope) return NextResponse.json({ error: "Unknown industry or brand in the selection" }, { status: 400 });
  const name = (body.name ?? "").trim() || "New dashboard (setup in progress)";
  // The default answers name the competitors, so they are read inside the chosen brands.
  const { answers, order } = runInScope(resolveScope(scope), () => {
    const a = WizardAnswersSchema.parse({});
    return { answers: a, order: stepOrder(a.goal) };
  });
  const onboarding: OnboardingState = { version: 1, answers, order, currentStep: 0, startedAt: new Date().toISOString(), completedAt: null };
  const created = await createDashboard({ name, template: "blank", scope });
  const dashboard = await updateDashboard(created.id, { onboarding });
  return NextResponse.json({ dashboard, workspace: workspaceFor(scopeOrDefault(dashboard?.scope)) }, { status: 201 });
}

/**
 * The wizard definition (questions, choices, goals, intro) plus coverage, for rendering the page.
 * It depends on the brands: pass ?dashboard=<id> (the setup's dashboard) or ?scope=<json>.
 */
export async function GET(req: Request) {
  await ensureReady();
  const url = new URL(req.url);
  const id = url.searchParams.get("dashboard");
  const dashboard = id ? await getDashboard(id) : null;
  return dashboard ? runForDashboard(dashboard, definition) : runInScope(resolveScope(url.searchParams.get("scope")), definition);
}

async function definition() {
  const coverage = await getCoverage();
  return NextResponse.json({
    workspace: getWorkspace(),
    intro: wizardIntro(),
    goals: GOALS,
    stepIds: STEP_IDS,
    steps: WIZARD_STEPS.map((s) => ({ id: s.id, question: s.question, short: s.short, choices: s.choices })),
    coverage,
  });
}
