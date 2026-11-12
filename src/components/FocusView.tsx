"use client";
import { useEffect, useState } from "react";
import { rowsToCsv } from "@/lib/format";
import { formatWindow } from "@/lib/period";
import { askAboutWidget, EXPLAIN_CHANGE_QUESTION, type WidgetSpec } from "@/lib/widgets";
import { usePeriod } from "./PeriodContext";
import { ChatPanel } from "./ChatPanel";
import { useToast } from "./Toast";
import { useWidgetRows } from "./WidgetCard";
import { WidgetBody } from "./WidgetBody";

/** Full-screen view of one element with a chat scoped to it. */
export function FocusView({
  widget,
  widgets,
  dashboardId,
  demoMode,
  onClose,
  onEdit,
  onAddWidget,
}: {
  widget: WidgetSpec;
  widgets: WidgetSpec[];
  dashboardId: string;
  demoMode: boolean;
  onClose: () => void;
  onEdit: () => void;
  onAddWidget: (w: WidgetSpec, replaces?: string) => void;
}) {
  const { rows, compareRows, loading, error, window: win } = useWidgetRows(widget);
  const period = usePeriod();
  const [ask, setAsk] = useState<{ text: string; instruction: string; nonce: number } | undefined>();
  // "Explain the change" is offered only while the dashboard compares two periods and this element follows it.
  const comparing = !!period.compareWindow && !!widget.sql && Array.isArray(compareRows);
  const explainChange = () => {
    if (!period.compareWindow) return;
    const ctx = { periodLabel: formatWindow(win), compareLabel: formatWindow(period.compareWindow), rows, compareRows };
    setAsk({ ...askAboutWidget(widget, ctx), nonce: Date.now() });
  };
  const [tableView, setTableView] = useState(widget.type === "table");
  const toast = useToast();
  const chartLike = ["bar", "stacked_bar", "line", "segmented", "kpi"].includes(widget.type);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".modal.confirm")) onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const copyCsv = async () => {
    try {
      await navigator.clipboard.writeText(rowsToCsv(rows));
      toast(`Copied ${rows.length} rows as CSV`);
    } catch {
      toast("Could not copy to the clipboard");
    }
  };

  return (
    <div className="focus" role="dialog" aria-modal="true" aria-label={`${widget.title}, full screen`}>
      <div className="focus__main">
        <div className="focus__head">
          <div className="grow" style={{ minWidth: 0 }}>
            <h2 className="im-text-header truncate">{widget.title}</h2>
            {widget.subtitle && <div className="im-text-description">{widget.subtitle}</div>}
          </div>
          <div className="row">
            {comparing && !loading && !error && (
              <button className="im-btn im-btn-secondary im-btn-sm" onClick={explainChange} title={`Ask the analyst why ${formatWindow(win)} differs from ${formatWindow(period.compareWindow!)}`}>
                {EXPLAIN_CHANGE_QUESTION}
              </button>
            )}
            {chartLike && (
              <button className="im-btn im-btn-secondary im-btn-sm" onClick={() => setTableView((v) => !v)}>{tableView ? "Show chart" : "Show as table"}</button>
            )}
            {(tableView || widget.type === "table") && rows.length > 0 && (
              <button className="im-btn im-btn-secondary im-btn-sm" onClick={() => void copyCsv()}>Copy CSV</button>
            )}
            <button className="im-btn im-btn-secondary im-btn-sm" onClick={onEdit}>Edit</button>
            <button className="im-btn im-btn-primary im-btn-sm" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="focus__body">
          {loading ? (
            <div className="widget__state"><span className="spinner" /></div>
          ) : error ? (
            <div className="widget__state widget__state--error">{error}</div>
          ) : (
            <WidgetBody spec={widget} rows={rows} compareRows={compareRows} tableView={tableView} />
          )}
        </div>
        <div className="focus__foot im-text-description">
          {rows.length ? `${rows.length} rows` : ""} · Press Esc to close
        </div>
      </div>
      <div className="focus__chat">
        <ChatPanel
          dashboardId={dashboardId}
          widgets={widgets}
          demoMode={demoMode}
          onAddWidget={onAddWidget}
          onPrefillConsumed={() => {}}
          scope={{ widget }}
          ask={ask}
        />
      </div>
    </div>
  );
}
