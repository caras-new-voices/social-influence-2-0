import { DashboardList, type ScopeLabel } from "@/components/DashboardList";
import { Shell } from "@/components/Shell";
import { getIndustry, scopeOrDefault } from "@/lib/catalog";
import { listDashboards } from "@/lib/dashboards";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const dashboards = await listDashboards();
  // Each card shows its brands: the company, how many competitors and the industry.
  const labels: Record<string, ScopeLabel> = {};
  for (const d of dashboards) {
    const scope = scopeOrDefault(d.scope);
    if (scope) labels[d.id] = { focal: scope.focal, competitors: scope.competitors.length, industry: getIndustry(scope.industry)?.name ?? null };
  }
  return (
    <Shell title="Dashboards">
      <DashboardList initial={dashboards} labels={labels} />
    </Shell>
  );
}
