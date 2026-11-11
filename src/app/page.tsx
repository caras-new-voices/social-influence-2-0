import { DashboardList } from "@/components/DashboardList";
import { Shell } from "@/components/Shell";
import { listDashboards } from "@/lib/dashboards";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const dashboards = await listDashboards();
  return (
    <Shell title="Dashboards">
      <DashboardList initial={dashboards} />
    </Shell>
  );
}
