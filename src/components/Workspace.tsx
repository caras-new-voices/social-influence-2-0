"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Layout } from "react-grid-layout";
import { useRouter } from "next/navigation";
import { askAboutWidget, defaultSize, newId, nextY, type DashboardRecord, type WidgetSpec } from "@/lib/widgets";
import { AddWidgetDrawer } from "./AddWidgetDrawer";
import { ChatPanel } from "./ChatPanel";
import { DashboardCanvas } from "./DashboardCanvas";
import { Shell } from "./Shell";
import { useToast } from "./Toast";
import { WidgetEditor } from "./WidgetEditor";

export function Workspace({ dashboard }: { dashboard: DashboardRecord }) {
  const router = useRouter();
  const toast = useToast();
  const [widgets, setWidgets] = useState<WidgetSpec[]>(dashboard.widgets);
  const [name, setName] = useState(dashboard.name);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<WidgetSpec | null>(null);
  const [adding, setAdding] = useState(false);
  const [prefill, setPrefill] = useState<string | undefined>();
  const [ask, setAsk] = useState<{ text: string; instruction: string; nonce: number } | undefined>();
  const [demo, setDemo] = useState(false);
  const [savedAt, setSavedAt] = useState<string>(dashboard.updated_at);

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then((j: { llm?: string }) => setDemo(j.llm === "mock")).catch(() => {});
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const mutate = useCallback((fn: (ws: WidgetSpec[]) => WidgetSpec[]) => {
    setWidgets((ws) => fn(ws));
    setDirty(true);
  }, []);

  const addWidget = useCallback(
    (widget: WidgetSpec, replaces?: string) => {
      mutate((ws) => {
        if (replaces && ws.some((w) => w.id === replaces)) {
          return ws.map((w) => (w.id === replaces ? { ...widget, layout: { ...w.layout } } : w));
        }
        const size = defaultSize(widget.type);
        const layout = { x: 0, y: nextY(ws), w: widget.layout?.w ?? size.w, h: widget.layout?.h ?? size.h };
        return [...ws, { ...widget, layout }];
      });
      toast(replaces ? "Widget replaced" : `Added "${widget.title}"`);
    },
    [mutate, toast],
  );

  const addFromTemplate = (t: Omit<WidgetSpec, "id" | "layout">) => {
    const size = defaultSize(t.type);
    addWidget({ ...t, id: newId(), layout: { x: 0, y: 0, w: size.w, h: size.h } });
    setAdding(false);
  };

  const onLayoutChange = useCallback((layout: Layout) => {
    setWidgets((ws) => {
      let changed = false;
      const next = ws.map((w) => {
        const l = layout.find((it) => it.i === w.id);
        if (!l) return w;
        if (l.x !== w.layout.x || l.y !== w.layout.y || l.w !== w.layout.w || l.h !== w.layout.h) {
          changed = true;
          return { ...w, layout: { x: l.x, y: l.y, w: l.w, h: l.h } };
        }
        return w;
      });
      if (changed) setDirty(true);
      return changed ? next : ws;
    });
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(`/api/dashboards/${dashboard.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, widgets }),
      });
      const j = (await r.json()) as { dashboard?: DashboardRecord; error?: string };
      if (!r.ok) throw new Error(j.error ?? "Save failed");
      setDirty(false);
      setSavedAt(j.dashboard?.updated_at ?? new Date().toISOString());
      toast("Dashboard saved");
      router.refresh();
    } catch (e) {
      toast(`Could not save: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const comingSoon = (feature: string) => toast(`${feature} will be available in a future version.`);

  const widgetSummaries = useMemo(() => widgets, [widgets]);

  return (
    <Shell
      title={name}
      titleSlot={
        <div className="row title-edit" style={{ minWidth: 0 }}>
          <input
            id="dashboard-name"
            aria-label="Dashboard name"
            className="im-input title-edit__input"
            placeholder="Untitled dashboard"
            title="Click to rename this dashboard"
            value={name}
            onChange={(e) => { setName(e.target.value); setDirty(true); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          />
          <label htmlFor="dashboard-name" className="title-edit__pencil" title="Rename" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 20h4l10-10-4-4L4 16v4z" /><path d="M12.5 7.5l4 4" /></svg>
          </label>
          <span className="im-text-description" style={{ whiteSpace: "nowrap" }}>
            {dirty ? <span className="im-badge im-badge-warning">Unsaved changes</span> : <span className="im-badge im-badge-success">Saved {new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
          </span>
        </div>
      }
      actions={
        <>
          <button className="im-btn im-btn-secondary" onClick={() => setAdding(true)}>+ Add element</button>
          <button className="im-btn im-btn-secondary" onClick={() => comingSoon("Export")}>Export</button>
          <button className="im-btn im-btn-secondary" onClick={() => comingSoon("Sharing")}>Share</button>
          <button className="im-btn im-btn-primary" onClick={() => void save()} disabled={saving || !dirty}>{saving ? "Saving…" : "Save"}</button>
        </>
      }
    >
      <div className="ws">
        <ChatPanel
          dashboardId={dashboard.id}
          widgets={widgetSummaries}
          demoMode={demo}
          onAddWidget={addWidget}
          prefill={prefill}
          onPrefillConsumed={() => setPrefill(undefined)}
          ask={ask}
        />
        <div className="ws__canvas">
          <DashboardCanvas
            widgets={widgets}
            onLayoutChange={onLayoutChange}
            onEdit={(id) => setEditing(widgets.find((w) => w.id === id) ?? null)}
            onRemove={(id) => { mutate((ws) => ws.filter((w) => w.id !== id)); toast("Element removed"); }}
            onAsk={(id) => {
              const w = widgets.find((x) => x.id === id);
              if (w) setAsk({ ...askAboutWidget(w), nonce: Date.now() });
            }}
            onAddClick={() => setAdding(true)}
          />
        </div>
      </div>
      {editing && (
        <WidgetEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={(w) => { mutate((ws) => ws.map((x) => (x.id === w.id ? w : x))); setEditing(null); toast("Element updated"); }}
        />
      )}
      {adding && <AddWidgetDrawer onAdd={addFromTemplate} onClose={() => setAdding(false)} />}
    </Shell>
  );
}
