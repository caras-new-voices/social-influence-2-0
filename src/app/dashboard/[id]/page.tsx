import { notFound } from "next/navigation";
import { Workspace } from "@/components/Workspace";
import { WorkspaceProvider } from "@/components/WorkspaceProvider";
import { scopeOrDefault, workspaceFor } from "@/lib/catalog";
import { getDashboard } from "@/lib/dashboards";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dashboard = await getDashboard(id);
  if (!dashboard) notFound();
  // Everything on the page (colours, legends, data requests, the analyst) works with the dashboard's own brands.
  return (
    <WorkspaceProvider workspace={workspaceFor(scopeOrDefault(dashboard.scope))}>
      <Workspace key={dashboard.id} dashboard={dashboard} />
    </WorkspaceProvider>
  );
}
