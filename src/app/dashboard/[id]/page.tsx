import { notFound } from "next/navigation";
import { Workspace } from "@/components/Workspace";
import { getDashboard } from "@/lib/dashboards";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dashboard = await getDashboard(id);
  if (!dashboard) notFound();
  return <Workspace key={dashboard.id} dashboard={dashboard} />;
}
