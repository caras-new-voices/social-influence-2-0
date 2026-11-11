"use client";
import { useEffect, useState } from "react";
import type { Row } from "@/lib/chart-data";
import { rowsToCsv } from "@/lib/format";
import type { WidgetSpec } from "@/lib/widgets";
import { useToast } from "./Toast";
import { WidgetBody } from "./WidgetBody";

/** Large read-only view of one element over a dimmed backdrop. Esc, the backdrop or Close dismisses it. */
export function Lightbox({ widget, rows, onClose }: { widget: WidgetSpec; rows: Row[]; onClose: () => void }) {
  const [tableView, setTableView] = useState(widget.type === "table");
  const toast = useToast();
  const chartLike = ["bar", "stacked_bar", "line", "segmented", "kpi"].includes(widget.type);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
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
    <div className="lightbox" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={`${widget.title}, enlarged`}>
      <div className="lightbox__card">
        <div className="focus__head">
          <div className="grow" style={{ minWidth: 0 }}>
            <h2 className="im-text-header truncate">{widget.title}</h2>
            {widget.subtitle && <div className="im-text-description">{widget.subtitle}</div>}
          </div>
          <div className="row">
            {chartLike && <button className="im-btn im-btn-secondary im-btn-sm" onClick={() => setTableView((v) => !v)}>{tableView ? "Show chart" : "Show as table"}</button>}
            {(tableView || widget.type === "table") && rows.length > 0 && <button className="im-btn im-btn-secondary im-btn-sm" onClick={() => void copyCsv()}>Copy CSV</button>}
            <button className="im-btn im-btn-primary im-btn-sm" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="lightbox__body">
          <WidgetBody spec={widget} rows={rows} tableView={tableView} />
        </div>
        {widget.rationale && <div className="proposal__rationale" style={{ padding: "0.5rem 0 0" }}>{widget.rationale}</div>}
      </div>
    </div>
  );
}
