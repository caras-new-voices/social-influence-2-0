import { UsageView } from "@/components/UsageView";
import "@/app/usage.css";

export const dynamic = "force-dynamic";

export const metadata = { title: "Usage" };

/** Token usage: balance, where the tokens went, the log and the statement. Data loads from /api/usage/*. */
export default function UsagePage() {
  return <UsageView />;
}
