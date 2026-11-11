"use client";
import { useEffect, useState } from "react";
import type { Row } from "@/lib/chart-data";
import { isDataWidget, type WidgetSpec } from "@/lib/widgets";
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
};

export function WidgetCard({ spec, onEdit, onRemove }: { spec: WidgetSpec; onEdit: () => void; onRemove: () => void }) {
  const { rows, loading, error } = useWidgetRows(spec);
  const [tableView, setTableView] = useState(false);
  const chartLike = ["bar", "stacked_bar", "line", "segmented", "kpi"].includes(spec.type);

  if (spec.type === "section") {
    return (
      <div className="widget widget--section">
        <div className="section-head drag-handle">
          <h3>{spec.title}</h3>
          {spec.subtitle && <span className="widget__sub">{spec.subtitle}</span>}
          <span className="grow" />
          <span className="widget__actions no-drag">
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
        <div className="widget__actions no-drag">
          {chartLike && (
            <button className="im-btn im-btn-ghost im-btn-icon" onClick={() => setTableView((v) => !v)} aria-label={tableView ? "Show chart" : "Show as table"} title={tableView ? "Show chart" : "Show as table"}>
              {tableView ? I.chart : I.table}
            </button>
          )}
          <button className="im-btn im-btn-ghost im-btn-icon" onClick={onEdit} aria-label="Edit widget" title="Edit">{I.edit}</button>
          <button className="im-btn im-btn-ghost im-btn-icon" onClick={onRemove} aria-label="Remove widget" title="Remove">{I.trash}</button>
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
