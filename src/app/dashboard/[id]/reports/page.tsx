import { notFound } from "next/navigation";
import { ReportsView } from "@/components/ReportsView";
import { getDashboard } from "@/lib/dashboards";
import { listMonthReports } from "@/lib/reports";
import "@/app/reports.css";

export const dynamic = "force-dynamic";

export default async function ReportsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dashboard = await getDashboard(id);
  if (!dashboard) notFound();
  const initial = await listMonthReports(id);
  return <ReportsView dashboard={dashboard} initial={initial} />;
}
