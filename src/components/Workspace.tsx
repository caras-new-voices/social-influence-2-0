"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Layout } from "react-grid-layout";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ALL_TIME, formatWindow, periodFromParams, periodToParams, resolveCompare, resolveWindow, type PeriodState } from "@/lib/period";
import { askAboutWidget, defaultSize, newId, nextY, type DashboardRecord, type WidgetSpec } from "@/lib/widgets";
import { NewDataBanner } from "./NewDataBanner";
import { PeriodBar } from "./PeriodBar";
import { PeriodProvider } from "./PeriodContext";
import { fetchWidgetRows } from "./WidgetCard";
import { AddWidgetDrawer } from "./AddWidgetDrawer";
import { FocusView } from "./FocusView";
import { VoiceAgent } from "./VoiceAgent";
import type { Row } from "@/lib/chart-data";
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
  const [focusId, setFocusId] = useState<string | null>(null);
  const [voice, setVoice] = useState<{ widget: WidgetSpec; rows: Row[] } | null>(null);
  const [demo, setDemo] = useState(false);
  const [savedAt, setSavedAt] = useState<string>(dashboard.updated_at);

  // Global period: the URL wins (shareable links), then the saved dashboard period, then all time.
  // The URL wins (shareable links), then the saved dashboard period, then all time. useSearchParams is
  // known on the server too, so the first render matches on both sides.
  const searchParams = useSearchParams();
  const [period, setPeriodState] = useState<PeriodState>(() => periodFromParams(searchParams) ?? dashboard.period ?? ALL_TIME);
  const periodSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setPeriod = useCallback((next: PeriodState) => {
    setPeriodState(next);
    // Mirror in the URL without a navigation, and persist with the dashboard (debounced, no dirty flag).
    const params = new URLSearchParams(window.location.search);
    for (const k of ["period", "compare"]) params.delete(k);
    for (const [k, v] of Object.entries(periodToParams(next))) if (!(k === "period" && v === "all")) params.set(k, v);
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    if (periodSaveTimer.current) clearTimeout(periodSaveTimer.current);
    periodSaveTimer.current = setTimeout(() => {
      void fetch(`/api/dashboards/${dashboard.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period: next.mode === "all" && !next.compare ? null : next }) }).catch(() => {});
    }, 600);
  }, [dashboard.id]);
  const [periodCounts, setPeriodCounts] = useState<{ posts: number; comments: number } | null>(null);
  useEffect(() => {
    const win = resolveWindow(period);
    let alive = true;
    fetchWidgetRows("SELECT (SELECT count(*)::int FROM posts) AS posts, (SELECT count(*)::int FROM comments) AS comments", win)
      .then((res) => { if (alive && res.rows[0]) setPeriodCounts({ posts: Number(res.rows[0].posts), comments: Number(res.rows[0].comments) }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [period]);

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then((j: { llm?: string }) => setDemo(j.llm === "mock")).catch(() => {});
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // Undo / redo: every discrete change (add, remove, edit, drag, resize) pushes the previous state.
  const widgetsRef = useRef(widgets);
  useEffect(() => {
    widgetsRef.current = widgets;
  }, [widgets]);
  const pastRef = useRef<WidgetSpec[][]>([]);
  const futureRef = useRef<WidgetSpec[][]>([]);
  const lastCommitAt = useRef(0);
  const [history, setHistory] = useState({ past: 0, future: 0 });
  const syncHistory = () => setHistory({ past: pastRef.current.length, future: futureRef.current.length });

  const commit = useCallback((next: WidgetSpec[]) => {
    pastRef.current.push(widgetsRef.current);
    if (pastRef.current.length > 60) pastRef.current.shift();
    futureRef.current = [];
    widgetsRef.current = next;
    lastCommitAt.current = Date.now();
    setWidgets(next);
    setDirty(true);
    syncHistory();
  }, []);

  const mutate = useCallback(
    (fn: (ws: WidgetSpec[]) => WidgetSpec[]) => {
      const cur = widgetsRef.current;
      const next = fn(cur);
      if (next !== cur) commit(next);
    },
    [commit],
  );

  const undo = useCallback(() => {
    const prev = pastRef.current.pop();
    if (!prev) return;
    futureRef.current.push(widgetsRef.current);
    widgetsRef.current = prev;
    lastCommitAt.current = Date.now();
    setWidgets(prev);
    setDirty(true);
    syncHistory();
    toast("Undone");
  }, [toast]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(widgetsRef.current);
    widgetsRef.current = next;
    lastCommitAt.current = Date.now();
    setWidgets(next);
    setDirty(true);
    syncHistory();
    toast("Redone");
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

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

  const onLayoutChange = useCallback(
    (layout: Layout) => {
      const ws = widgetsRef.current;
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
      if (!changed) return;
      // The grid compacts positions right after we change the widget list; fold that into the same undo step.
      if (Date.now() - lastCommitAt.current < 500) {
        widgetsRef.current = next;
        setWidgets(next);
        setDirty(true);
        return;
      }
      commit(next);
    },
    [commit],
  );

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
  const focusWidget = focusId ? widgets.find((w) => w.id === focusId) ?? null : null;

  const widgetSummaries = useMemo(() => widgets, [widgets]);

  return (
    <PeriodProvider state={period} onChange={setPeriod}>
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
          <span className="row" style={{ gap: "0.15rem", marginRight: "0.25rem" }}>
            <button className="im-btn im-btn-ghost im-btn-icon" onClick={undo} disabled={history.past === 0} aria-label="Undo" title="Undo (Ctrl+Z)">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-4" /></svg>
            </button>
            <button className="im-btn im-btn-ghost im-btn-icon" onClick={redo} disabled={history.future === 0} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M15 14l5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h4" /></svg>
            </button>
          </span>
          <button className="im-btn im-btn-secondary" onClick={() => setAdding(true)}>+ Add element</button>
          <Link className="im-btn im-btn-secondary" href={`/dashboard/${dashboard.id}/reports`} title="Month-by-month reports and the month in review">Reports</Link>
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
          onSetPeriod={setPeriod}
        />
        <div className="ws__canvas">
          <NewDataBanner dashboardId={dashboard.id} />
          {dashboard.onboarding && !dashboard.onboarding.completedAt && (
            <div className="resume-banner" role="status">
              <span>Setup in progress: question {Math.min(dashboard.onboarding.currentStep, dashboard.onboarding.order.length)} of {dashboard.onboarding.order.length} answered. The elements land here when you finish.</span>
              <Link className="im-btn im-btn-primary im-btn-sm" href={`/dashboard/new/guided?dashboard=${dashboard.id}`}>Resume setup</Link>
            </div>
          )}
          <PeriodBar counts={periodCounts} />
          <DashboardCanvas
            widgets={widgets}
            onLayoutChange={onLayoutChange}
            onEdit={(id) => setEditing(widgets.find((w) => w.id === id) ?? null)}
            onRemove={(id) => { mutate((ws) => ws.filter((w) => w.id !== id)); toast("Element removed"); }}
            onAsk={(id) => {
              const w = widgets.find((x) => x.id === id);
              if (!w) return;
              // In compare mode "Ask AI" becomes "Explain the change": both result sets go to the analyst.
              const compareWin = resolveCompare(period);
              const inherits = !w.period || w.period === "inherit";
              if (!compareWin || !inherits || !w.sql) {
                setAsk({ ...askAboutWidget(w), nonce: Date.now() });
                return;
              }
              const win = resolveWindow(period);
              void fetchWidgetRows(w.sql, win, compareWin).then((res) => {
                const ctx = res.error ? undefined : { periodLabel: formatWindow(win), compareLabel: formatWindow(compareWin), rows: res.rows, compareRows: res.compareRows };
                setAsk({ ...askAboutWidget(w, ctx), nonce: Date.now() });
              });
            }}
            onExpand={(id) => setFocusId(id)}
            onVoice={(id, rows) => {
              const w = widgets.find((x) => x.id === id);
              if (w) setVoice({ widget: w, rows });
            }}
            onAddClick={() => setAdding(true)}
            onSetPeriod={(id, p) => { mutate((ws) => ws.map((w) => (w.id === id ? { ...w, period: p } : w))); toast(p === "all" ? "This element now shows all time" : "Element period changed"); }}
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
      {voice && <VoiceAgent key={voice.widget.id} widget={voice.widget} rows={voice.rows} onClose={() => setVoice(null)} />}
      {focusWidget && (
        <FocusView
          widget={focusWidget}
          widgets={widgets}
          dashboardId={dashboard.id}
          demoMode={demo}
          onClose={() => setFocusId(null)}
          onEdit={() => setEditing(focusWidget)}
          onAddWidget={addWidget}
        />
      )}
    </Shell>
    </PeriodProvider>
  );
}
