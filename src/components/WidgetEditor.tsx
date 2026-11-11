"use client";
import { useEffect, useState } from "react";
import type { Row } from "@/lib/chart-data";
import { WIDGET_TYPES, isDataWidget, type WidgetSpec } from "@/lib/widgets";
import { WidgetBody } from "./WidgetBody";

async function runSql(sql: string): Promise<{ rows: Row[]; error?: string }> {
  const r = await fetch("/api/widgets/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql }) });
  const j = (await r.json()) as { rows?: Row[]; error?: string };
  if (!r.ok) return { rows: [], error: j.error ?? "Query failed" };
  return { rows: j.rows ?? [] };
}

export function WidgetEditor({ initial, onSave, onClose }: { initial: WidgetSpec; onSave: (w: WidgetSpec) => void; onClose: () => void }) {
  const [spec, setSpec] = useState<WidgetSpec>(initial);
  const [result, setResult] = useState<{ rows: Row[]; error?: string }>({ rows: [] });
  const [running, setRunning] = useState(false);
  const set = <K extends keyof WidgetSpec>(k: K, v: WidgetSpec[K]) => setSpec((s) => ({ ...s, [k]: v === "" ? undefined : v }));
  const rows = result.rows;
  const err = result.error;

  const run = async () => {
    if (!spec.sql) return;
    setRunning(true);
    const res = await runSql(spec.sql);
    setResult(res);
    setRunning(false);
  };
  useEffect(() => {
    if (!initial.sql) return;
    let alive = true;
    runSql(initial.sql).then((res) => alive && setResult(res));
    return () => {
      alive = false;
    };
  }, [initial.sql]);

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
