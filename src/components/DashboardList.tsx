"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { useWorkspace } from "./WorkspaceProvider";
import { relativeTime } from "@/lib/format";
import { DEFAULT_TEMPLATE, TEMPLATES } from "@/lib/templates";
import type { DashboardRecord } from "@/lib/widgets";
import type { DashboardScope } from "@/lib/scope-shared";
import { BrandPicker } from "./BrandPicker";
import { useConfirm } from "./Confirm";
import { useToast } from "./Toast";

const Ico = {
  spark: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" /></svg>,
  grid: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="8" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /><rect x="13" y="13" width="8" height="8" rx="2" /></svg>,
  blank: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="3" strokeDasharray="4 3" /></svg>,
};

/** The brands a dashboard looks at, computed on the server (see app/page.tsx). */
export interface ScopeLabel {
  focal: string;
  competitors: number;
  industry: string | null;
}

export function DashboardList({ initial, labels: initialLabels = {} }: { initial: DashboardRecord[]; labels?: Record<string, ScopeLabel> }) {
  const router = useRouter();
  const [labels, setLabels] = useState(initialLabels);
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [dashboards, setDashboards] = useState(initial);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const ws = useWorkspace();
  const [creating, setCreating] = useState(false);
  // The default path is the default dashboard: pick the brands, name it, done. Guided setup and a
  // blank canvas are still there under "More ways to start", for people who want to build their own.
  const [path, setPath] = useState<"guided" | "template" | "blank">("template");
  const [screen, setScreen] = useState<"choose" | "brands" | "name">("brands");
  const [scope, setScope] = useState<DashboardScope | null>(null);
  const defaultName = `${scope?.focal ?? ws.focal} dashboard`;

  const openDialog = () => { setScreen("brands"); setPath("template"); setScope(null); setName(""); setDescription(""); setCreating(false); setOpen(true); };

  const create = async () => {
    if (!scope) return;
    setCreating(true);
    try {
      const r = await fetch("/api/dashboards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() || defaultName, description, template: path === "blank" ? "blank" : DEFAULT_TEMPLATE, scope }) });
      const j = (await r.json()) as { dashboard?: DashboardRecord; error?: string };
      if (!r.ok || !j.dashboard) throw new Error(j.error ?? "Could not create the dashboard");
      setOpen(false);
      router.push(`/dashboard/${j.dashboard.id}`);
    } catch (e) {
      toast((e as Error).message);
      setCreating(false);
    }
  };

  /** After the brands, the guided path leaves the dialog for the wizard page; the others ask for a name. */
  const next = () => {
    if (screen === "choose") {
      setScreen("brands");
      return;
    }
    if (!scope) return;
    if (path === "guided") {
      setCreating(true);
      router.push(`/dashboard/new/guided?scope=${encodeURIComponent(JSON.stringify(scope))}`);
      return;
    }
    setScreen("name");
  };
  const back = () => setScreen(screen === "name" ? "brands" : path === "template" ? "brands" : "choose");
  const defaultTemplate = TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE);

  const remove = async (d: DashboardRecord) => {
    const ok = await confirmDialog({
      title: `Delete "${d.name}"?`,
      message: "The dashboard and its conversation will be removed for everyone. This cannot be undone.",
      confirmLabel: "Delete dashboard",
      danger: true,
    });
    if (!ok) return;
    await fetch(`/api/dashboards/${d.id}`, { method: "DELETE" });
    setDashboards((ds) => ds.filter((x) => x.id !== d.id));
    toast("Dashboard deleted");
  };

  const duplicate = async (d: DashboardRecord) => {
    const r = await fetch(`/api/dashboards/${d.id}`, { method: "POST" });
    const j = (await r.json()) as { dashboard: DashboardRecord };
    setDashboards((ds) => [j.dashboard, ...ds]);
    // A copy keeps the brands of the original.
    if (labels[d.id]) setLabels((l) => ({ ...l, [j.dashboard.id]: l[d.id] }));
    toast("Dashboard duplicated");
  };

  return (
    <div style={{ padding: "1.5rem" }}>
      <div className="hero">
        <div>
          <h1>Social influence dashboards</h1>
          <p>Pick an industry, your company and its competitors. Then chat with an analyst over the creator posts about them, approve the charts it proposes, and shape a dashboard your team can keep.</p>
        </div>
        <button className="im-btn im-btn-primary" onClick={openDialog}>+ New dashboard</button>
      </div>

      {dashboards.length === 0 ? (
        <div className="empty im-card">
          <p className="im-text-sub-header">No dashboards yet</p>
          <p className="im-text-description" style={{ margin: "0.3rem 0 1rem" }}>Pick your company and its competitors. You get a full dashboard that answers the five questions every brand asks, ready to read.</p>
          <div className="row" style={{ justifyContent: "center", gap: "0.5rem" }}>
            <button className="im-btn im-btn-primary" onClick={openDialog}>+ New dashboard</button>
          </div>
        </div>
      ) : (
        <div className="dash-grid">
          {dashboards.map((d) => (
            <Link key={d.id} href={`/dashboard/${d.id}`} className="im-card im-card--hoverable dash-card" style={{ color: "inherit", textDecoration: "none" }}>
              <h3>{d.name}{d.onboarding && !d.onboarding.completedAt && <span className="im-badge im-badge-warning" style={{ marginLeft: "0.5rem", verticalAlign: "middle" }}>Setup in progress</span>}</h3>
              {labels[d.id] && (
                <span className="dash-card__scope" title={`${labels[d.id].focal} against ${labels[d.id].competitors} competitors${labels[d.id].industry ? ` in ${labels[d.id].industry}` : ""}`}>
                  <span className="scope-chip"><i aria-hidden="true" />{labels[d.id].focal} vs {labels[d.id].competitors}</span>
                  {labels[d.id].industry && <span>{labels[d.id].industry}</span>}
                </span>
              )}
              {d.description && <p className="im-text-description">{d.description}</p>}
              <div className="dash-card__meta">
                <span>{d.widgets.length} elements</span>
                <span>Updated {relativeTime(d.updated_at)}</span>
              </div>
              <div className="dash-card__menu">
                <button className="im-btn im-btn-ghost im-btn-sm" onClick={(e) => { e.preventDefault(); void duplicate(d); }}>Duplicate</button>
                <button className="im-btn im-btn-ghost im-btn-sm" onClick={(e) => { e.preventDefault(); void remove(d); }} style={{ color: "#b91c1c" }}>Delete</button>
              </div>
            </Link>
          ))}
        </div>
      )}

      {open && (
        <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className={`modal ${screen === "brands" ? "modal--picker" : ""}`} role="dialog" aria-modal="true" aria-label="New dashboard">
            <div className="modal__head"><h3 className="im-text-header">{screen === "brands" ? "Choose your brands" : "New dashboard"}</h3><button className="im-btn im-btn-ghost im-btn-sm" onClick={() => setOpen(false)}>Close</button></div>
            <div className="modal__body">
              {screen === "choose" ? (
                <>
                  <p className="im-text-description" style={{ marginTop: 0 }}>Most people should use the standard dashboard. These are for building your own.</p>
                  <div className="start-grid">
                    <button className={`start-card ${path === "template" ? "is-active" : ""}`} onClick={() => setPath("template")} aria-pressed={path === "template"}>
                      <span className="start-card__icon">{Ico.grid}</span>
                      <b>The standard dashboard</b>
                      <span className="im-badge im-badge-primary">Recommended</span>
                      <small>{defaultTemplate?.name}: eight measures and five questions, answered for your brands.</small>
                    </button>
                    <button className={`start-card ${path === "guided" ? "is-active" : ""}`} onClick={() => setPath("guided")} aria-pressed={path === "guided"}>
                      <span className="start-card__icon">{Ico.spark}</span>
                      <b>Build your own with the analyst</b>
                      <small>Answer a few questions and choose the elements yourself. About 5 minutes.</small>
                    </button>
                    <button className={`start-card ${path === "blank" ? "is-active" : ""}`} onClick={() => setPath("blank")} aria-pressed={path === "blank"}>
                      <span className="start-card__icon">{Ico.blank}</span>
                      <b>Start blank</b>
                      <small>An empty canvas; ask the analyst for anything.</small>
                    </button>
                  </div>
                </>
              ) : screen === "brands" ? (
                <BrandPicker value={scope} onChange={setScope} />
              ) : (
                <>
                  <p className="im-text-description">{scope ? `${scope.focal} against ${scope.competitors.length} ${scope.competitors.length === 1 ? "competitor" : "competitors"}. ` : ""}{path === "template" ? `You get the standard dashboard (${defaultTemplate?.name ?? "the default"}). You can change it later.` : "Starting with an empty dashboard."}</p>
                  <label><span className="im-label">Name</span><input className="im-input" autoFocus placeholder={defaultName} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void create(); }} /></label>
                  <label><span className="im-label">Description (optional)</span><input className="im-input" placeholder="What is this dashboard for?" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
                </>
              )}
            </div>
            <div className="modal__foot">
              {screen === "name" || (screen === "brands" && path !== "template") ? (
                <button className="im-btn im-btn-secondary" onClick={back} disabled={creating}>Back</button>
              ) : (
                <button className="im-btn im-btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
              )}
              {screen === "brands" && path === "template" && (
                <button className="im-btn im-btn-ghost" onClick={() => setScreen("choose")} disabled={creating} title="Guided setup with the analyst, or a blank dashboard">More ways to start</button>
              )}
              <span className="grow" />
              {screen === "choose" ? (
                <button className="im-btn im-btn-primary" onClick={next}>Next: choose brands</button>
              ) : screen === "brands" ? (
                <button className="im-btn im-btn-primary" onClick={next} disabled={creating || !scope} title={!scope ? "Pick an industry first" : undefined}>{path === "guided" ? (creating ? "Starting…" : "Start setup") : "Next"}</button>
              ) : (
                <button className="im-btn im-btn-primary" onClick={() => void create()} disabled={creating}>{creating ? "Creating…" : "Create dashboard"}</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
