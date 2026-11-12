"use client";
import { useEffect, useMemo, useState } from "react";
import { effectiveWindow, addDays, ISO_DATE, type WidgetPeriod } from "@/lib/period";
import { usePeriod } from "./PeriodContext";
import type { Row } from "@/lib/chart-data";
import { WIDGET_TYPES, isDataWidget, type WidgetSpec } from "@/lib/widgets";
import { Markdown, WidgetBody } from "./WidgetBody";

async function runSql(sql: string, win?: { start?: string; end?: string }): Promise<{ rows: Row[]; error?: string }> {
  const r = await fetch("/api/widgets/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql, window: win }) });
  const j = (await r.json()) as { rows?: Row[]; error?: string };
  if (!r.ok) return { rows: [], error: j.error ?? "Query failed" };
  return { rows: j.rows ?? [] };
}

export function WidgetEditor({ initial, onSave, onClose }: { initial: WidgetSpec; onSave: (w: WidgetSpec) => void; onClose: () => void }) {
  const [spec, setSpec] = useState<WidgetSpec>(initial);
  const period = usePeriod();
  const winStart = effectiveWindow(period.window, spec.period).start;
  const winEnd = effectiveWindow(period.window, spec.period).end;
  const win = useMemo(() => ({ start: winStart, end: winEnd }), [winStart, winEnd]);
  const [result, setResult] = useState<{ rows: Row[]; error?: string }>({ rows: [] });
  const [running, setRunning] = useState(false);
  const [assistRequest, setAssistRequest] = useState("");
  const [assistBusy, setAssistBusy] = useState<"explain" | "modify" | null>(null);
  const [assistOut, setAssistOut] = useState<{ kind: "explain" | "modify" | "error"; text: string } | null>(null);
  const [previousSql, setPreviousSql] = useState<string | null>(null);

  const assist = async (mode: "explain" | "modify") => {
    if (!spec.sql || assistBusy) return;
    setAssistBusy(mode);
    setAssistOut(null);
    try {
      const r = await fetch("/api/sql-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, sql: spec.sql, request: assistRequest, widget: { title: spec.title, type: spec.type, x: spec.x, y: spec.y, series: spec.series } }),
      });
      const j = (await r.json()) as { error?: string; explanation?: string; sql?: string; summary?: string; columns?: string[]; rowCount?: number; warning?: string };
      if (!r.ok) throw new Error(j.error ?? "The assistant failed");
      if (mode === "explain") {
        setAssistOut({ kind: "explain", text: j.explanation ?? "" });
      } else if (j.sql) {
        setPreviousSql(spec.sql);
        set("sql", j.sql);
        setAssistRequest("");
        setAssistOut({ kind: "modify", text: `${j.summary ?? "Query updated."} ${j.rowCount ?? 0} rows, columns: ${(j.columns ?? []).join(", ")}.${j.warning ? ` ${j.warning}` : ""}` });
        setResult(await runSql(j.sql, win));
      }
    } catch (e) {
      setAssistOut({ kind: "error", text: (e as Error).message });
    } finally {
      setAssistBusy(null);
    }
  };
  const set = <K extends keyof WidgetSpec>(k: K, v: WidgetSpec[K]) => setSpec((s) => ({ ...s, [k]: v === "" ? undefined : v }));
  const rows = result.rows;
  const err = result.error;

  const run = async () => {
    if (!spec.sql) return;
    setRunning(true);
    const res = await runSql(spec.sql, win);
    setResult(res);
    setRunning(false);
  };
  useEffect(() => {
    if (!initial.sql) return;
    let alive = true;
    runSql(initial.sql, win).then((res) => alive && setResult(res));
    return () => {
      alive = false;
    };
  }, [initial.sql, win]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dataType = isDataWidget(spec.type);
  const columns = rows[0] ? Object.keys(rows[0]) : [];

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--wide" role="dialog" aria-label="Edit widget">
        <div className="modal__head">
          <h3 className="im-text-header">Edit element</h3>
          <button className="im-btn im-btn-ghost im-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="modal__body">
          <div className="editor-grid">
            <label><span className="im-label">Title</span><input className="im-input" value={spec.title} onChange={(e) => setSpec((s) => ({ ...s, title: e.target.value }))} /></label>
            <label><span className="im-label">Subtitle</span><input className="im-input" value={spec.subtitle ?? ""} onChange={(e) => set("subtitle", e.target.value)} /></label>
            <label><span className="im-label">Type</span>
              <select className="im-select" value={spec.type} onChange={(e) => set("type", e.target.value as WidgetSpec["type"])}>
                {WIDGET_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
              </select>
            </label>
          </div>
          {dataType && <PeriodField value={spec.period} onChange={(v) => setSpec((s) => ({ ...s, period: v }))} />}
          {dataType && (
            <>
              <div className="editor-grid">
                <label><span className="im-label">Category / x column</span>
                  <select className="im-select" value={spec.x ?? ""} onChange={(e) => set("x", e.target.value)}>
                    <option value="">auto</option>{columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label><span className="im-label">Value / y column</span>
                  <select className="im-select" value={spec.y ?? ""} onChange={(e) => set("y", e.target.value)}>
                    <option value="">auto</option>{columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label><span className="im-label">Series column</span>
                  <select className="im-select" value={spec.series ?? ""} onChange={(e) => set("series", e.target.value)}>
                    <option value="">none (columns are series)</option>{columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label><span className="im-label">Colour by</span>
                  <select className="im-select" value={spec.colorBy ?? "auto"} onChange={(e) => set("colorBy", e.target.value as WidgetSpec["colorBy"])}>
                    {["auto", "brand", "platform", "sentiment", "tier"].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label><span className="im-label">Number format</span>
                  <select className="im-select" value={spec.format ?? ""} onChange={(e) => set("format", e.target.value as WidgetSpec["format"])}>
                    <option value="">auto</option>{["number", "compact", "percent", "currency", "decimal"].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <div className="row" style={{ alignItems: "flex-end", gap: "1rem", paddingBottom: "0.4rem" }}>
                  <label className="row"><input type="checkbox" checked={!!spec.horizontal} onChange={(e) => set("horizontal", e.target.checked)} /> Horizontal</label>
                  <label className="row"><input type="checkbox" checked={!!spec.normalize} onChange={(e) => set("normalize", e.target.checked)} /> Show as 100% share</label>
                </div>
              </div>
              <label>
                <span className="im-label">SQL (read-only, Postgres)</span>
                <textarea className="im-textarea code" rows={7} value={spec.sql ?? ""} onChange={(e) => set("sql", e.target.value)} spellCheck={false} />
              </label>
              <div className="row">
                <button className="im-btn im-btn-secondary im-btn-sm" onClick={() => void run()} disabled={running}>{running ? "Running…" : "Run query"}</button>
                <span className="im-text-description">{rows.length ? `${rows.length} rows · columns: ${columns.join(", ")}` : ""}</span>
                {err && <span className="im-badge im-badge-error">{err}</span>}
              </div>
              <div className="assist">
                <div className="assist__head">
                  <span className="sidebar__mark" style={{ width: 22, height: 22, fontSize: 10, borderRadius: 6 }}>AI</span>
                  <b>Query assistant</b>
                  <button className="im-btn im-btn-light im-btn-sm" style={{ marginLeft: "auto" }} onClick={() => void assist("explain")} disabled={!!assistBusy || !spec.sql}>
                    {assistBusy === "explain" ? "Explaining…" : "Explain this query"}
                  </button>
                </div>
                <div className="chat__input">
                  <input
                    className="im-input"
                    placeholder="Describe a change, e.g. only TikTok, last three months, split by platform…"
                    value={assistRequest}
                    onChange={(e) => setAssistRequest(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void assist("modify"); }}
                    disabled={!!assistBusy}
                  />
                  <button className="im-btn im-btn-primary im-btn-sm" onClick={() => void assist("modify")} disabled={!!assistBusy || !assistRequest.trim() || !spec.sql}>
                    {assistBusy === "modify" ? "Rewriting…" : "Apply change"}
                  </button>
                </div>
                {assistOut && (
                  <div className={`assist__out ${assistOut.kind === "error" ? "assist__out--error" : ""}`}>
                    {assistOut.kind === "explain" ? <Markdown text={assistOut.text} /> : <p>{assistOut.text}</p>}
                    {assistOut.kind === "modify" && previousSql && (
                      <button className="im-btn im-btn-ghost im-btn-sm" onClick={() => { set("sql", previousSql); setPreviousSql(null); setAssistOut(null); void runSql(previousSql, win).then(setResult); }}>Revert to previous query</button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
          {(spec.type === "text" || spec.type === "insight") && (
            <label><span className="im-label">Content (markdown)</span>
              <textarea className="im-textarea" rows={6} value={spec.content ?? ""} onChange={(e) => set("content", e.target.value)} />
            </label>
          )}
          {spec.type !== "section" && (
            <div>
              <span className="im-label">Preview</span>
              <div className="editor-preview">
                <WidgetBody spec={spec} rows={rows} />
              </div>
            </div>
          )}
        </div>
        <div className="modal__foot">
          <button className="im-btn im-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="im-btn im-btn-primary" onClick={() => onSave(spec)} disabled={!spec.title.trim()}>Save changes</button>
        </div>
      </div>
    </div>
  );
}


/** Per-element time window: follow the dashboard period, ignore it, or pin a fixed window. */
function PeriodField({ value, onChange }: { value: WidgetPeriod | undefined; onChange: (v: WidgetPeriod | undefined) => void }) {
  const mode = !value || value === "inherit" ? "inherit" : value === "all" ? "all" : "fixed";
  const fixed = typeof value === "object" ? value : null;
  const [start, setStart] = useState(fixed?.start ?? "");
  const [end, setEnd] = useState(fixed?.end ? addDays(fixed.end, -1) : "");
  const apply = (a: string, b: string) => { if (ISO_DATE.test(a) && ISO_DATE.test(b) && a <= b) onChange({ start: a, end: addDays(b, 1) }); };
  return (
    <div className="editor-grid">
      <label><span className="im-label">Time window</span>
        <select className="im-select" value={mode} onChange={(e) => { const v = e.target.value; if (v === "inherit") onChange(undefined); else if (v === "all") onChange("all"); else apply(start, end); }}>
          <option value="inherit">Follow the dashboard period</option>
          <option value="all">All time (ignore the period)</option>
          <option value="fixed">Fixed window</option>
        </select>
      </label>
      {mode === "fixed" && (
        <>
          <label><span className="im-label">From</span><input className="im-input" type="date" value={start} onChange={(e) => { setStart(e.target.value); apply(e.target.value, end); }} /></label>
          <label><span className="im-label">To (inclusive)</span><input className="im-input" type="date" value={end} onChange={(e) => { setEnd(e.target.value); apply(start, e.target.value); }} /></label>
        </>
      )}
      {mode !== "fixed" && <span className="im-text-description" style={{ alignSelf: "end", paddingBottom: "0.5rem" }}>{mode === "inherit" ? "The element shows the window chosen in the period bar." : "Lifetime numbers, whatever the period bar shows."}</span>}
    </div>
  );
}
