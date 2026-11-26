"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Layout } from "react-grid-layout";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ALL_TIME, formatWindow, periodFromParams, periodToParams, resolveCompare, resolveWindow, windowKey, type PeriodState } from "@/lib/period";
import type { UsageKind } from "@/lib/usage-shared";
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
import { leaderParts, summaryParts, DashboardCanvas } from "./DashboardCanvas";
import { LEADER_VIEWS } from "@/lib/tom8";
import { Shell } from "./Shell";
import { useToast } from "./Toast";
import { WidgetEditor } from "./WidgetEditor";
import { BrandPicker } from "./BrandPicker";
import { TargetAudience } from "./TargetAudience";
import { useConfirm } from "./Confirm";
import { useWorkspace } from "./WorkspaceProvider";
import { ShareDialog } from "./ShareDialog";
import { TemplateUpdate } from "./TemplateUpdate";
import { scopeKey, type DashboardScope } from "@/lib/scope-shared";

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
  const [ask, setAsk] = useState<{ text: string; instruction: string; nonce: number; kind?: UsageKind } | undefined>();
  const [focusId, setFocusId] = useState<string | null>(null);
  // The one-page summary: the headline measures and the answer to each question. It is the first thing shown on a
  // long dashboard that has those answers; "Everything" is one click away, and ?view= keeps the choice in the link.
  const summary = useMemo(() => summaryParts(widgets), [widgets]);
  const canSummarise = summary.length >= 3 && widgets.length > 20;
  // useSearchParams is known on the server too, so the first render matches on both sides.
  const viewParam = useSearchParams().get("view");
  const [viewChoice, setViewChoice] = useState<"summary" | "full" | null>(viewParam === "summary" || viewParam === "full" ? viewParam : null);
  const view = canSummarise ? viewChoice ?? "summary" : "full";
  // A shared link opens read-only: the same view, with the chat and every editing control hidden.
  const readOnly = useSearchParams().get("readonly") === "1";
  // The brief's three buyers each ask something different first: the summary can be read as any of them. ?for= keeps it in the link.
  const forParam = useSearchParams().get("for");
  const [leaderId, setLeaderId] = useState<string | null>(LEADER_VIEWS.some((l) => l.id === forParam) ? forParam : null);
  const leader = LEADER_VIEWS.find((l) => l.id === leaderId) ?? null;
  const leaderSummary = useMemo(() => (leader ? leaderParts(widgets, leader.asks) : null), [leader, widgets]);
  const pickLeader = (id: string | null) => {
    setLeaderId(id);
    const params = new URLSearchParams(window.location.search);
    if (id) params.set("for", id); else params.delete("for");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  };
  const setView = (next: "summary" | "full", scrollTo?: string | null) => {
    setViewChoice(next);
    const params = new URLSearchParams(window.location.search);
    params.set("view", next);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
    if (next === "full") {
      // The grid mounts after this render: go to the section once it is there.
      window.setTimeout(() => {
        const el = scrollTo ? document.querySelector(`[data-wid="${CSS.escape(scrollTo)}"]`) : null;
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        else document.querySelector(".ws__canvas")?.scrollTo({ top: 0 });
      }, 250);
    }
  };
  const [voice, setVoice] = useState<{ widget: WidgetSpec; rows: Row[] } | null>(null);
  const [demo, setDemo] = useState(false);
  const [savedAt, setSavedAt] = useState<string>(dashboard.updated_at);

  // The dashboard's brands (its scope): shown as a chip in the header, changed in the brand picker.
  const ws = useWorkspace();
  const confirmDialog = useConfirm();
  const currentScope = ws.scope ?? null;
  const [brandDraft, setBrandDraft] = useState<DashboardScope | null>(null);
  const [savingBrands, setSavingBrands] = useState(false);
  const reloadingRef = useRef(false);
  const saveBrands = async () => {
    if (!brandDraft) return;
    if (currentScope && brandDraft.industry !== currentScope.industry) {
      const ok = await confirmDialog({
        title: "Change the industry?",
        message: `The elements on this dashboard were made for ${ws.industry?.name ?? "the current industry"}. They will show the new brands, but their titles and notes may still refer to the old ones.`,
        confirmLabel: "Change industry",
      });
      if (!ok) return;
    }
    setSavingBrands(true);
    try {
      // Unsaved edits go along with the brands, since the page reloads afterwards.
      const body = dirty ? { scope: brandDraft, name, widgets } : { scope: brandDraft };
      const r = await fetch(`/api/dashboards/${dashboard.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "Could not change the brands");
      reloadingRef.current = true;
      window.location.reload();
    } catch (e) {
      toast((e as Error).message);
      setSavingBrands(false);
    }
  };

  // Global period: the URL wins (shareable links), then the saved dashboard period, then all time.
  // The URL wins (shareable links), then the saved dashboard period, then all time. useSearchParams is
  // known on the server too, so the first render matches on both sides.
  const searchParams = useSearchParams();
  const [period, setPeriodState] = useState<PeriodState>(() => {
    const fromUrl = periodFromParams(searchParams);
    if (!fromUrl) return dashboard.period ?? ALL_TIME;
    // A link that names a period but no market (a notification, an older shared link) keeps the dashboard's saved market.
    return fromUrl.market === undefined && dashboard.period?.market ? { ...fromUrl, market: dashboard.period.market } : fromUrl;
  });
  const periodSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The market as it is right now: the analyst's period tool keeps it, even if the person changed it while the answer was being written.
  const marketRef = useRef<string | null>(period.market ?? null);
  useEffect(() => { marketRef.current = period.market ?? null; }, [period.market]);
  const setPeriod = useCallback((next: PeriodState) => {
    setPeriodState(next);
    // Mirror in the URL without a navigation, and persist with the dashboard (debounced, no dirty flag).
    const params = new URLSearchParams(window.location.search);
    for (const k of ["period", "compare", "market"]) params.delete(k);
    for (const [k, v] of Object.entries(periodToParams(next))) if (!(k === "period" && v === "all")) params.set(k, v);
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    if (periodSaveTimer.current) clearTimeout(periodSaveTimer.current);
    periodSaveTimer.current = setTimeout(() => {
      // keepalive: the save can queue behind the boxes loading, and must still land if the person leaves the page first.
      void fetch(`/api/dashboards/${dashboard.id}`, { method: "PUT", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period: next.mode === "all" && !next.compare && !next.market ? null : next }) }).catch(() => {});
    }, 600);
  }, [dashboard.id]);
  // Counts are kept with the window they belong to, so the bar never shows one period's or market's counts next to another's label.
  const [countsFor, setCountsFor] = useState<{ key: string; posts: number; comments: number } | null>(null);
  const periodCounts = countsFor && countsFor.key === windowKey(resolveWindow(period)) ? countsFor : null;
  useEffect(() => {
    const win = resolveWindow(period);
    let alive = true;
    fetchWidgetRows("SELECT (SELECT count(*)::int FROM posts) AS posts, (SELECT count(*)::int FROM comments) AS comments", win)
      .then((res) => { if (alive && res.rows[0]) setCountsFor({ key: windowKey(win), posts: Number(res.rows[0].posts), comments: Number(res.rows[0].comments) }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [period]);

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then((j: { llm?: string }) => setDemo(j.llm === "mock")).catch(() => {});
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { if (!reloadingRef.current) e.preventDefault(); };
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

  const [exportOpen, setExportOpen] = useState(false);
  /** The period and market of this view, as a query string for a link. */
  const linkQuery = () => {
    const q = new URLSearchParams(Object.entries(periodToParams(period)).filter(([k, v]) => !(k === "period" && v === "all"))).toString();
    return q ? `?${q}` : "";
  };
  // Sharing: a link with its own key that opens this view and can change nothing (ShareDialog).
  const [sharing, setSharing] = useState(false);
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
          {ws.brands.length > 0 && (
            <button
              type="button"
              className="scope-chip"
              onClick={() => setBrandDraft(currentScope)}
              title={`${ws.focal} against ${ws.competitors.join(", ") || "no competitors"}${ws.industry ? ` (${ws.industry.name})` : ""}. Click to change the brands.`}
            >
              <i aria-hidden="true" />{ws.focal} vs {ws.competitors.length}
            </button>
          )}
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
          <button className="im-btn im-btn-secondary" onClick={() => setBrandDraft(currentScope)} title="Choose the company and competitors this dashboard shows">Brands</button>
          <button className="im-btn im-btn-secondary" onClick={() => setAdding(true)}>+ Add element</button>
          <Link className="im-btn im-btn-secondary" href={`/dashboard/${dashboard.id}/reports?market=${encodeURIComponent(period.market ?? "")}`} title="Month-by-month reports and the month in review">Reports</Link>
          <span className="menu">
            <button className="im-btn im-btn-secondary" onClick={() => setExportOpen((v) => !v)} aria-haspopup="menu" aria-expanded={exportOpen}>Export</button>
            {exportOpen && (
              <span className="menu__pop" role="menu" onClick={() => setExportOpen(false)}>
                <Link role="menuitem" href={`/dashboard/${dashboard.id}/example${linkQuery()}`}>The worked example, as a document</Link>
                <button role="menuitem" onClick={() => window.print()}>Print this view or save it as a PDF</button>
                <a role="menuitem" href={`/api/dashboards/${dashboard.id}/export${linkQuery()}`}>Every table, as a spreadsheet (CSV)</a>
              </span>
            )}
          </span>
          <button className="im-btn im-btn-secondary" onClick={() => setSharing(true)} title="A link that opens this view and can change nothing">Share</button>
          <button className="im-btn im-btn-primary" onClick={() => void save()} disabled={saving || !dirty}>{saving ? "Saving…" : "Save"}</button>
        </>
      }
    >
      <div className={`ws ${readOnly ? "ws--readonly" : ""}`}>
        {readOnly && <div className="readonly-note" role="status">Read-only view. <Link href={`/dashboard/${dashboard.id}`}>Open the dashboard to edit it</Link>.</div>}
        <ChatPanel
          dashboardId={dashboard.id}
          widgets={widgetSummaries}
          demoMode={demo}
          onAddWidget={addWidget}
          prefill={prefill}
          onPrefillConsumed={() => setPrefill(undefined)}
          ask={ask}
          onSetPeriod={(next) => setPeriod({ ...next, market: marketRef.current })}
        />
        <div className="ws__canvas">
          <NewDataBanner dashboardId={dashboard.id} />
          {dashboard.onboarding && !dashboard.onboarding.completedAt && (
            <div className="resume-banner" role="status">
              <span>Setup in progress: question {Math.min(dashboard.onboarding.currentStep, dashboard.onboarding.order.length)} of {dashboard.onboarding.order.length} answered. The elements land here when you finish.</span>
              <Link className="im-btn im-btn-primary im-btn-sm" href={`/dashboard/new/guided?dashboard=${dashboard.id}`}>Resume setup</Link>
            </div>
          )}
          {!readOnly && <TemplateUpdate dashboardId={dashboard.id} widgets={widgets} apply={(next, summary) => { mutate(() => next); toast(`Dashboard updated (${summary}). Press Save to keep it, or Undo to go back.`); }} />}
          <PeriodBar counts={periodCounts} />
          {canSummarise && (
            <div className="viewswitch" role="tablist" aria-label="How much of the dashboard to show">
              <button role="tab" aria-selected={view === "summary"} className={view === "summary" ? "is-on" : ""} onClick={() => setView("summary")}>Summary</button>
              <button role="tab" aria-selected={view === "full"} className={view === "full" ? "is-on" : ""} onClick={() => setView("full")}>Everything ({widgets.filter((w) => w.type !== "section" && w.type !== "text").length} boxes)</button>
              <span className="im-text-description">{view === "summary" ? "The eight measures and the answer to each question. The detail is one click away." : "Every box, section by section."}</span>
            </div>
          )}
          {canSummarise && view === "summary" && (
            <div className="leaders" role="tablist" aria-label="Whose summary">
              <button role="tab" aria-selected={!leader} className={!leader ? "is-on" : ""} onClick={() => pickLeader(null)}>The five answers</button>
              {LEADER_VIEWS.map((l) => (
                <button key={l.id} role="tab" aria-selected={leader?.id === l.id} className={leader?.id === l.id ? "is-on" : ""} onClick={() => pickLeader(l.id)}>{l.label}</button>
              ))}
              {leader && leader.links.map((k) => (
                <Link key={k.label} className="im-btn im-btn-ghost im-btn-sm" href={k.href === "reports" ? `/dashboard/${dashboard.id}/reports?market=${encodeURIComponent(period.market ?? "")}` : k.href}>{k.label} →</Link>
              ))}
            </div>
          )}
          <DashboardCanvas
            summary={view === "summary" ? leaderSummary ?? summary : null}
            onSeeDetail={(sectionId) => setView("full", sectionId)}
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
                setAsk({ ...askAboutWidget(w, ctx), nonce: Date.now(), kind: ctx ? "explain_change" : "ask_element" });
              });
            }}
            onChange={(id) => {
              const w = widgets.find((x) => x.id === id);
              // The chat input is filled with the element's name; the person says what to change.
              if (w) setPrefill(`Change "${w.title}": `);
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
          dashboardId={dashboard.id}
          onClose={() => setEditing(null)}
          onSave={(w) => { mutate((ws) => ws.map((x) => (x.id === w.id ? w : x))); setEditing(null); toast("Element updated"); }}
        />
      )}
      {brandDraft && (
        <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !savingBrands) setBrandDraft(null); }}>
          <div className="modal modal--picker" role="dialog" aria-modal="true" aria-label="Brands on this dashboard">
            <div className="modal__head"><h3 className="im-text-header">Brands on this dashboard</h3><button className="im-btn im-btn-ghost im-btn-sm" onClick={() => setBrandDraft(null)} disabled={savingBrands}>Close</button></div>
            <div className="modal__body">
              <BrandPicker value={brandDraft} onChange={(next) => setBrandDraft({ ...next, target: brandDraft.target })} />
              <TargetAudience value={brandDraft.target} scope={{ industry: brandDraft.industry, focal: brandDraft.focal, competitors: brandDraft.competitors }} onChange={(target) => setBrandDraft({ ...brandDraft, target })} />
            </div>
            <div className="modal__foot">
              <button className="im-btn im-btn-secondary" onClick={() => setBrandDraft(null)} disabled={savingBrands}>Cancel</button>
              <button className="im-btn im-btn-primary" onClick={() => void saveBrands()} disabled={savingBrands || scopeKey(brandDraft) === scopeKey(currentScope)}>{savingBrands ? "Saving…" : "Save and reload"}</button>
            </div>
          </div>
        </div>
      )}
      {sharing && <ShareDialog dashboardId={dashboard.id} period={period} view={view} leader={leaderId} onClose={() => setSharing(false)} />}
      {adding && <AddWidgetDrawer onAdd={addFromTemplate} onClose={() => setAdding(false)} />}
      {voice && <VoiceAgent key={voice.widget.id} dashboardId={dashboard.id} widget={voice.widget} rows={voice.rows} onClose={() => setVoice(null)} />}
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
