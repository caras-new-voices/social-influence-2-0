import { OnboardingWizard } from "@/components/OnboardingWizard";
import "@/app/wizard.css";

export const dynamic = "force-dynamic";

/** Guided setup: eight questions with the analyst. `?dashboard=<id>` resumes a setup in progress. */
export default async function GuidedSetupPage({ searchParams }: { searchParams: Promise<{ dashboard?: string | string[] }> }) {
  const { dashboard } = await searchParams;
  const resumeId = Array.isArray(dashboard) ? dashboard[0] : dashboard;
  return <OnboardingWizard resumeId={resumeId || undefined} />;
}
