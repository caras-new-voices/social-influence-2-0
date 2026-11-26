"use client";
import { useMemo, useState } from "react";
import { formatWindow, resolveCompare, resolveWindow, type PeriodState } from "@/lib/period";
import { LEADER_VIEWS } from "@/lib/tom8";
import type { WidgetSpec } from "@/lib/widgets";
import { DashboardCanvas, leaderParts, summaryParts } from "./DashboardCanvas";
import { PeriodProvider } from "./PeriodContext";
import { useWorkspace } from "./WorkspaceProvider";

const nothing = () => {};

/**
 * A dashboard opened through a share link: the boxes, the period and the market the link was made
 * for, and nothing to change. It has no chat, no editor and no address of the dashboard itself:
 * every box is asked for through the link, which can read only this dashboard's boxes.
 */
export function SharedView({ name, widgets, period, view: firstView, leader: firstLeader }: { name: string; widgets: WidgetSpec[]; period: PeriodState | null; view: "summary" | "full"; leader: string | null }) {
  const ws = useWorkspace();
  const state = useMemo<PeriodState>(() => period ?? { mode: "all" }, [period]);
  const summary = useMemo(() => summaryParts(widgets), [widgets]);
  const canSummarise = summary.length >= 3 && widgets.length > 20;
  const [choice, setChoice] = useState<"summary" | "full">(firstView);
  const view = canSummarise ? choice : "full";
  const [leaderId, setLeaderId] = useState<string | null>(LEADER_VIEWS.some((l) => l.id === firstLeader) ? firstLeader : null);
  const leader = LEADER_VIEWS.find((l) => l.id === leaderId) ?? null;
  const leaderSummary = useMemo(() => (leader ? leaderParts(widgets, leader.asks) : null), [leader, widgets]);
  const window_ = resolveWindow(state);
  const compare = resolveCompare(state);
  const open = (next: "summary" | "full", scrollTo?: string | null) => {
    setChoice(next);
    if (next === "full") {
      window.setTimeout(() => {
        const el = scrollTo ? document.querySelector(`[data-wid="${CSS.escape(scrollTo)}"]`) : null;
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 250);
    }
  };
  return (
    <PeriodProvider state={state} onChange={nothing}>
      <div className="shared">
        <header className="shared__head">
          <div>
            <h1 className="im-text-header">{name}</h1>
            <p className="im-text-description">
              {ws.focal} against {ws.competitors.length ? ws.competitors.join(", ") : "no competitors"} · {formatWindow(window_)}{window_.market ? "" : " · all markets"}{compare ? ` · compared with ${formatWindow(compare)}` : ""}
            </p>
          </div>
          <span className="row" style={{ gap: "0.5rem" }}>
            <span className="im-badge">Read-only view</span>
            <button className="im-btn im-btn-secondary im-btn-sm no-print" onClick={() => window.print()}>Print or save as PDF</button>
          </span>
        </header>
        <div className="ws ws--readonly ws--shared">
          <div className="ws__canvas">
            {canSummarise && (
              <div className="viewswitch no-print" role="tablist" aria-label="How much of the dashboard to show">
                <button role="tab" aria-selected={view === "summary"} className={view === "summary" ? "is-on" : ""} onClick={() => open("summary")}>Summary</button>
                <button role="tab" aria-selected={view === "full"} className={view === "full" ? "is-on" : ""} onClick={() => open("full")}>Everything ({widgets.filter((w) => w.type !== "section" && w.type !== "text").length} boxes)</button>
              </div>
            )}
            {canSummarise && view === "summary" && (
              <div className="leaders no-print" role="tablist" aria-label="Whose summary">
                <button role="tab" aria-selected={!leader} className={!leader ? "is-on" : ""} onClick={() => setLeaderId(null)}>The five answers</button>
                {LEADER_VIEWS.map((l) => (
                  <button key={l.id} role="tab" aria-selected={leader?.id === l.id} className={leader?.id === l.id ? "is-on" : ""} onClick={() => setLeaderId(l.id)}>{l.label}</button>
                ))}
              </div>
            )}
            <DashboardCanvas
              fixed
              summary={view === "summary" ? leaderSummary ?? summary : null}
              onSeeDetail={(sectionId) => open("full", sectionId)}
              widgets={widgets}
              onLayoutChange={nothing}
              onEdit={nothing}
              onRemove={nothing}
              onAsk={nothing}
              onExpand={nothing}
              onVoice={nothing}
              onAddClick={nothing}
            />
          </div>
        </div>
      </div>
    </PeriodProvider>
  );
}
