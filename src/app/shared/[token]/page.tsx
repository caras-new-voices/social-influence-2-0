import { notFound } from "next/navigation";
import { SharedView } from "@/components/SharedView";
import { WorkspaceProvider } from "@/components/WorkspaceProvider";
import { scopeOrDefault, workspaceFor } from "@/lib/catalog";
import { getSharedView } from "@/lib/share";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

/** A dashboard opened through a share link. The dashboard's own id never reaches the browser. */
export default async function SharedPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const shared = await getSharedView(token);
  if (!shared) notFound();
  const { dashboard, settings } = shared;
  return (
    <WorkspaceProvider workspace={{ ...workspaceFor(scopeOrDefault(dashboard.scope)), shareToken: token }}>
      <SharedView name={dashboard.name} widgets={dashboard.widgets} period={settings.period} view={settings.view} leader={settings.leader} />
    </WorkspaceProvider>
  );
}
