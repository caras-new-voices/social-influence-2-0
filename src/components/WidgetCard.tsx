"use client";
import { useEffect, useState } from "react";
import type { Row } from "@/lib/chart-data";
import { rowsToCsv } from "@/lib/format";
import { isDataWidget, type WidgetSpec } from "@/lib/widgets";
import { useToast } from "./Toast";
import { WidgetBody } from "./WidgetBody";

const cache = new Map<string, Promise<{ rows: Row[]; error?: string }>>();

export function fetchWidgetRows(sql: string): Promise<{ rows: Row[]; error?: string }> {
  if (!cache.has(sql)) {
    const p = fetch("/api/widgets/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql }) })
      .then(async (r) => {
        const j = (await r.json()) as { rows?: Row[]; error?: string };
        if (!r.ok) return { rows: [], error: j.error ?? "Query failed" };
        return { rows: j.rows ?? [] };
      })
      .catch((e: Error) => ({ rows: [], error: e.message }));
    cache.set(sql, p);
    p.then((res) => { if (res.error) cache.delete(sql); });
  }
  return cache.get(sql)!;
}

export function useWidgetRows(spec: WidgetSpec, preloaded?: Row[]) {
  const needsFetch = !preloaded && !!spec.sql && isDataWidget(spec.type);
  const [result, setResult] = useState<{ sql?: string; rows: Row[]; error?: string }>({ rows: [] });
  useEffect(() => {
    if (!needsFetch || !spec.sql) return;
    let alive = true;
    const sql = spec.sql;
    fetchWidgetRows(sql).then((res) => alive && setResult({ sql, rows: res.rows, error: res.error }));
    return () => {
      alive = false;
    };
  }, [spec.sql, needsFetch]);
  if (!needsFetch) return { rows: preloaded ?? [], loading: false, error: undefined };
  const fresh = result.sql === spec.sql;
  return { rows: fresh ? result.rows : [], loading: !fresh, error: fresh ? result.error : undefined };
}

const I = {
  edit: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 20h4l10-10-4-4L4 16v4z" /><path d="M12.5 7.5l4 4" /></svg>,
  table: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M9 5v14" /></svg>,
  chart: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 19V5M4 19h16" /><path d="M8 15v-4M12 15V8M16 15v-6" /></svg>,
  trash: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>,
  spark: <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>,
  copy: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>,
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for contexts without the async clipboard API.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function WidgetCard({ spec, onEdit, onRemove, onAsk }: { spec: WidgetSpec; onEdit: () => void; onRemove: () => void; onAsk: () => void }) {
  const { rows, loading, error } = useWidgetRows(spec);
  const [tableView, setTableView] = useState(false);
  const toast = useToast();
  const chartLike = ["bar", "stacked_bar", "line", "segmented", "kpi"].includes(spec.type);
  const showCopy = (tableView || spec.type === "table") && rows.length > 0;
  const copyCsv = async () => {
    const ok = await copyText(rowsToCsv(rows));
    toast(ok ? `Copied ${rows.length} rows as CSV` : "Could not copy to the clipboard");
  };

  if (spec.type === "section") {
    return (
      <div className="widget widget--section">
        <div className="section-head drag-handle">
          <h3>{spec.title}</h3>
          {spec.subtitle && <span className="widget__sub">{spec.subtitle}</span>}
          <span className="grow" />
          <span className="widget__actions no-drag">
            <button className="widget__ask" onClick={onAsk} aria-label={`Ask AI about ${spec.title}`}>{I.spark} Ask AI</button>
            <button className="im-btn im-btn-ghost im-btn-icon" onClick={onEdit} aria-label="Edit section">{I.edit}</button>
            <button className="im-btn im-btn-ghost im-btn-icon" onClick={onRemove} aria-label="Remove section">{I.trash}</button>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="widget">
      <div className="widget__head drag-handle">
        <div className="grow">
          <div className="widget__title">{spec.title}</div>
          {spec.subtitle && <div className="widget__sub">{spec.subtitle}</div>}
        </div>
        <div className="widget__toolbar no-drag">
          <button className="widget__ask" onClick={onAsk} aria-label={`Ask AI about ${spec.title}`} title="Chat with the analyst about this element">{I.spark} Ask AI</button>
          <div className="widget__actions">
          {showCopy && (
            <button className="im-btn im-btn-ghost im-btn-icon" onClick={() => void copyCsv()} aria-label="Copy table as CSV" title="Copy table as CSV">{I.copy}</button>
          )}
          {chartLike && (
            <button className="im-btn im-btn-ghost im-btn-icon" onClick={() => setTableView((v) => !v)} aria-label={tableView ? "Show chart" : "Show as table"} title={tableView ? "Show chart" : "Show as table"}>
              {tableView ? I.chart : I.table}
            </button>
          )}
          <button className="im-btn im-btn-ghost im-btn-icon" onClick={onEdit} aria-label="Edit widget" title="Edit">{I.edit}</button>
          <button className="im-btn im-btn-ghost im-btn-icon" onClick={onRemove} aria-label="Remove widget" title="Remove">{I.trash}</button>
          </div>
        </div>
      </div>
      <div className="widget__body no-drag">
        {loading ? (
          <div className="widget__state"><span className="spinner" /></div>
        ) : error ? (
          <div className="widget__state widget__state--error">{error}</div>
        ) : (
          <WidgetBody spec={spec} rows={rows} tableView={tableView} />
        )}
      </div>
    </div>
  );
}
