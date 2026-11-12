"use client";
import { useEffect, useState } from "react";
import type { Row } from "@/lib/chart-data";
import { rowsToCsv } from "@/lib/format";
import { effectiveWindow, formatWindow, windowKey, type PeriodWindow } from "@/lib/period";
import { isDataWidget, type WidgetSpec } from "@/lib/widgets";
import { usePeriod } from "./PeriodContext";
import { useToast } from "./Toast";
import { WidgetBody } from "./WidgetBody";

export interface WidgetData {
  rows: Row[];
  /** Rows for the comparison window when comparison is on. */
  compareRows?: Row[];
  error?: string;
}

const cache = new Map<string, Promise<WidgetData>>();

/** Drops cached results; call after new data is imported. */
export function clearWidgetCache() {
  cache.clear();
}

export function fetchWidgetRows(sql: string, window?: PeriodWindow | null, compare?: PeriodWindow | null): Promise<WidgetData> {
  const key = `${windowKey(window)}|${windowKey(compare)}|${sql}`;
  if (!cache.has(key)) {
    const p = fetch("/api/widgets/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql, window: window && (window.start || window.end) ? window : undefined, compare: compare ?? undefined }),
    })
      .then(async (r) => {
        const j = (await r.json()) as { rows?: Row[]; compareRows?: Row[]; error?: string };
        if (!r.ok) return { rows: [], error: j.error ?? "Query failed" };
        return { rows: j.rows ?? [], compareRows: j.compareRows };
      })
      .catch((e: Error) => ({ rows: [], error: e.message }));
    cache.set(key, p);
    p.then((res) => { if (res.error) cache.delete(key); });
  }
  return cache.get(key)!;
}

/**
 * Rows for a widget within the dashboard period (honouring the widget's own period override).
 * `preloaded` rows (from a chat proposal) are used as-is.
 */
export function useWidgetRows(spec: WidgetSpec, preloaded?: Row[]) {
  const period = usePeriod();
  const win = effectiveWindow(period.window, spec.period);
  const compare = spec.period && spec.period !== "inherit" ? null : period.compareWindow;
  const key = `${period.dataVersion}|${windowKey(win)}|${windowKey(compare)}|${spec.sql ?? ""}`;
  const needsFetch = !preloaded && !!spec.sql && isDataWidget(spec.type);
  const [result, setResult] = useState<{ key?: string; rows: Row[]; compareRows?: Row[]; error?: string }>({ rows: [] });
  useEffect(() => {
    if (!needsFetch || !spec.sql) return;
    let alive = true;
    fetchWidgetRows(spec.sql, win, compare).then((res) => alive && setResult({ key, rows: res.rows, compareRows: res.compareRows, error: res.error }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, needsFetch]);
  if (!needsFetch) return { rows: preloaded ?? [], compareRows: undefined, loading: false, error: undefined, window: win };
  const fresh = result.key === key;
  return { rows: fresh ? result.rows : [], compareRows: fresh ? result.compareRows : undefined, loading: !fresh, error: fresh ? result.error : undefined, window: win };
}

/** Small badge shown on elements that do not follow the dashboard period. */
export function PeriodBadge({ spec }: { spec: WidgetSpec }) {
  if (!spec.period || spec.period === "inherit") return null;
  const label = spec.period === "all" ? "All time" : formatWindow(spec.period);
  return <span className="im-badge widget__period" title={spec.period === "all" ? "This element ignores the dashboard period" : "This element is pinned to a fixed window"}>{label}</span>;
}

const I = {
  edit: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 20h4l10-10-4-4L4 16v4z" /><path d="M12.5 7.5l4 4" /></svg>,
  table: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M9 5v14" /></svg>,
  chart: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 19V5M4 19h16" /><path d="M8 15v-4M12 15V8M16 15v-6" /></svg>,
  trash: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>,
  spark: <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>,
  copy: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>,
  expand: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5" /></svg>,
};

function VoiceButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button className="widget__voice no-drag" onClick={onClick} aria-label={`Explain ${title} with AI voice`} title="Explain with AI voice">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/ai-voice.svg" alt="" />
    </button>
  );
}

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

export function WidgetCard({
  spec,
  onEdit,
  onRemove,
  onAsk,
  onExpand,
  onVoice,
}: {
  spec: WidgetSpec;
  onEdit: () => void;
  onRemove: () => void;
  onAsk: () => void;
  onExpand: () => void;
  onVoice: (rows: Row[]) => void;
}) {
  const { rows, compareRows, loading, error } = useWidgetRows(spec);
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
          <VoiceButton title={spec.title} onClick={() => onVoice([])} />
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
      <VoiceButton title={spec.title} onClick={() => onVoice(rows)} />
      <div className="widget__head drag-handle">
        <div className="grow">
          <div className="widget__title">{spec.title} <PeriodBadge spec={spec} /></div>
          {spec.subtitle && <div className="widget__sub">{spec.subtitle}</div>}
        </div>
        <div className="widget__toolbar no-drag">
          <button className="widget__ask" onClick={onAsk} aria-label={`Ask AI about ${spec.title}`} title="Chat with the analyst about this element">{I.spark} Ask AI</button>
          <div className="widget__actions">
          <button className="im-btn im-btn-ghost im-btn-icon" onClick={onExpand} aria-label="Expand to full screen" title="Expand">{I.expand}</button>
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
          <WidgetBody spec={spec} rows={rows} compareRows={compareRows} tableView={tableView} />
        )}
      </div>
    </div>
  );
}
