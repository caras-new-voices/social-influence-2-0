"use client";
import Link from "next/link";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { ALL_TIME, formatWindow, periodFromParams, periodToParams, resolveCompare, resolveWindow, type PeriodState } from "@/lib/period";
import { WORKED_EXAMPLE } from "@/lib/tom8";
import type { DashboardRecord, WidgetSpec } from "@/lib/widgets";
import { PeriodProvider } from "./PeriodContext";
import { WidgetCard } from "./WidgetCard";
import { useWorkspace } from "./WorkspaceProvider";

const nothing = () => {};

/**
 * The worked example as a document: the brief's headings in order, each with the boxes of this
 * dashboard that carry its answer. It reads the same queries as the dashboard, in the period and
 * market of the link, so the two cannot disagree. Nothing here can be edited.
 */
export function ExampleView({ dashboard }: { dashboard: DashboardRecord }) {
  const ws = useWorkspace();
  const searchParams = useSearchParams();
  const period = useMemo<PeriodState>(() => {
    const fromUrl = periodFromParams(searchParams);
    if (!fromUrl) return dashboard.period ?? ALL_TIME;
    return fromUrl.market === undefined && dashboard.period?.market ? { ...fromUrl, market: dashboard.period.market } : fromUrl;
  }, [searchParams, dashboard.period]);
  const chapters = useMemo(() => {
    const byTitle = new Map(dashboard.widgets.map((w) => [w.title, w]));
    return WORKED_EXAMPLE.map((c) => ({ ...c, boxes: c.titles.map((t) => byTitle.get(t)).filter((w): w is WidgetSpec => !!w) })).filter((c) => c.boxes.length);
  }, [dashboard.widgets]);
  const win = resolveWindow(period);
  const cmp = resolveCompare(period);
  const back = new URLSearchParams(Object.entries(periodToParams(period)).filter(([k, v]) => !(k === "period" && v === "all"))).toString();
  const made = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <PeriodProvider state={period} onChange={nothing}>
      <div className="doc">
        <div className="doc__bar no-print">
          <Link className="im-btn im-btn-ghost im-btn-sm" href={`/dashboard/${dashboard.id}${back ? `?${back}` : ""}`}>← Dashboard</Link>
          <span className="grow" />
          <button className="im-btn im-btn-primary im-btn-sm" onClick={() => window.print()}>Print or save as PDF</button>
        </div>
        <header className="doc__head">
          <span className="im-micro-label">Social intelligence: from conversation to content, creators and product</span>
          <h1>{ws.focal}: the worked example</h1>
          <p className="doc__meta">
            {ws.focal} against {ws.competitors.length} {ws.competitors.length === 1 ? "competitor" : "competitors"}{ws.competitors.length ? ` (${ws.competitors.join(", ")})` : ""}. {formatWindow(win)}{cmp ? `, compared with ${formatWindow(cmp)}` : ""}. Made on {made} from the dashboard &quot;{dashboard.name}&quot;.
          </p>
          <p className="doc__meta">The five questions of the brief, each answered from the data, with the numbers behind the answer. Every figure is the one the dashboard shows.</p>
        </header>
        {chapters.length === 0 && <p className="im-text-description">This dashboard has none of the boxes the worked example is made from. Create a dashboard from the default template to get one.</p>}
        {chapters.map((c) => (
          <section key={c.heading} className="doc__chapter">
            <h2>{c.heading}</h2>
            <p className="doc__text">{c.text}</p>
            {c.boxes.map((w) => (
              <div key={w.id} className="doc__box">
                <WidgetCard spec={w} onEdit={nothing} onRemove={nothing} onAsk={nothing} onExpand={nothing} onVoice={nothing} />
              </div>
            ))}
          </section>
        ))}
      </div>
    </PeriodProvider>
  );
}
