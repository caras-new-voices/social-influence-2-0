import { getDashboard } from "@/lib/dashboards";
import { formatWindow, periodFromParams, resolveWindow } from "@/lib/period";
import { runWidgetQuery } from "@/lib/query";
import { runForDashboard } from "@/lib/scope";
import { isDataWidget } from "@/lib/widgets";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Ctx = { params: Promise<{ id: string }> };

const cell = (v: unknown) => {
  const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  // A leading =, +, - or @ would be read as a formula by a spreadsheet: keep it as text.
  const safe = /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Every data element of a dashboard as one CSV file: a title line, the column names, the rows. ?period= and ?market= as on the dashboard. */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const dashboard = await getDashboard(id);
  if (!dashboard) return new Response("Not found", { status: 404 });
  const state = periodFromParams(new URL(req.url).searchParams) ?? dashboard.period ?? { mode: "all" as const };
  const window = resolveWindow(state);
  const lines: string[] = [cell(`${dashboard.name}: ${formatWindow(window)}`), ""];
  await runForDashboard(dashboard, async () => {
    for (const w of dashboard.widgets) {
      if (!w.sql || !isDataWidget(w.type) || w.type === "insight") continue;
      const res = await runWidgetQuery(w.sql, 500, w.period === "all" ? (window.market ? { market: window.market } : null) : window);
      lines.push(cell(w.title));
      if (!res.ok) { lines.push(cell(`Could not be read: ${res.error}`), ""); continue; }
      const cols = res.rows.length ? Object.keys(res.rows[0]) : [];
      if (cols.length) lines.push(cols.map(cell).join(","));
      for (const r of res.rows) lines.push(cols.map((c) => cell(r[c])).join(","));
      lines.push("");
    }
  });
  const name = dashboard.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "dashboard";
  // The byte order mark makes spreadsheets read accents and other scripts correctly.
  return new Response("\ufeff" + lines.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` } });
}
