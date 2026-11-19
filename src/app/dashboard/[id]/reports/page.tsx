import { notFound } from "next/navigation";
import { ReportsView } from "@/components/ReportsView";
import { WorkspaceProvider } from "@/components/WorkspaceProvider";
import { scopeOrDefault, workspaceFor } from "@/lib/catalog";
import { getDashboard } from "@/lib/dashboards";
import { listMonthReports } from "@/lib/reports";
import "@/app/reports.css";

export const dynamic = "force-dynamic";

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ market?: string | string[] }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const market = (Array.isArray(sp.market) ? sp.market[0] : sp.market) ?? undefined;
  const dashboard = await getDashboard(id);
  if (!dashboard) notFound();
  const initial = await listMonthReports(id);
  return (
    <WorkspaceProvider workspace={workspaceFor(scopeOrDefault(dashboard.scope))}>
      <ReportsView dashboard={dashboard} initial={initial} initialMarket={market ?? dashboard.period?.market ?? undefined} />
    </WorkspaceProvider>
  );
}
