import { notFound } from "next/navigation";
import { ExampleView } from "@/components/ExampleView";
import { WorkspaceProvider } from "@/components/WorkspaceProvider";
import { scopeOrDefault, workspaceFor } from "@/lib/catalog";
import { getDashboard } from "@/lib/dashboards";
import "@/app/workspace.css";
import "@/app/example.css";

export const dynamic = "force-dynamic";

/** The worked example: the brief run end to end on this dashboard, as one document to read, print or share. */
export default async function ExamplePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dashboard = await getDashboard(id);
  if (!dashboard) notFound();
  return (
    <WorkspaceProvider workspace={workspaceFor(scopeOrDefault(dashboard.scope))}>
      <ExampleView dashboard={dashboard} />
    </WorkspaceProvider>
  );
}
