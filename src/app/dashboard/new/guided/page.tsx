import { OnboardingWizard } from "@/components/OnboardingWizard";
import "@/app/wizard.css";

export const dynamic = "force-dynamic";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/**
 * Guided setup: the brands first, then a few questions with the analyst.
 * `?dashboard=<id>` resumes a setup in progress; `?scope=<json>` starts one for those brands.
 */
export default async function GuidedSetupPage({ searchParams }: { searchParams: Promise<{ dashboard?: string | string[]; scope?: string | string[] }> }) {
  const { dashboard, scope } = await searchParams;
  return <OnboardingWizard resumeId={first(dashboard)} scopeParam={first(scope)} />;
}
