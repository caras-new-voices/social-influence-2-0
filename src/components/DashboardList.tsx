"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { BRANDS } from "@/lib/brands";
import { relativeTime } from "@/lib/format";
import { TEMPLATES, type TemplateId } from "@/lib/templates";
import type { DashboardRecord } from "@/lib/widgets";
import { useConfirm } from "./Confirm";
import { useToast } from "./Toast";

export function DashboardList({ initial }: { initial: DashboardRecord[] }) {
  const router = useRouter();
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [dashboards, setDashboards] = useState(initial);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState<TemplateId>("default");
  const [creating, setCreating] = useState(false);

  const create = async () => {
    setCreating(true);
    const r = await fetch("/api/dashboards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description, template }) });
    const j = (await r.json()) as { dashboard: DashboardRecord };
    setCreating(false);
    setOpen(false);
    router.push(`/dashboard/${j.dashboard.id}`);
  };

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
    toast("Dashboard duplicated");
  };

  return (
    <div style={{ padding: "1.5rem" }}>
      <div className="hero">
        <div>
          <h1>Social influence for Venus</h1>
          <p>Chat with an analyst over creator posts and audience comments about Venus and its competitors, approve the charts it proposes, and shape a dashboard your team can keep.</p>
          <div className="brand-chips">
            {BRANDS.map((b) => (
              <span className="brand-chip" key={b.name}><i className="dot" style={{ background: b.color }} />{b.name}{b.role === "focal" ? " · focal brand" : ""}</span>
            ))}
          </div>
        </div>
        <button className="im-btn im-btn-primary" onClick={() => setOpen(true)}>+ New dashboard</button>
      </div>

      {dashboards.length === 0 ? (
        <div className="empty im-card">
          <p className="im-text-sub-header">No dashboards yet</p>
          <p className="im-text-description" style={{ margin: "0.3rem 0 1rem" }}>Start from a template, or start blank and build with the assistant.</p>
          <button className="im-btn im-btn-primary" onClick={() => setOpen(true)}>Create your first dashboard</button>
        </div>
      ) : (
        <div className="dash-grid">
          {dashboards.map((d) => (
            <Link key={d.id} href={`/dashboard/${d.id}`} className="im-card im-card--hoverable dash-card" style={{ color: "inherit", textDecoration: "none" }}>
              <h3>{d.name}</h3>
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
          <div className="modal" role="dialog" aria-label="New dashboard">
            <div className="modal__head"><h3 className="im-text-header">New dashboard</h3><button className="im-btn im-btn-ghost im-btn-sm" onClick={() => setOpen(false)}>Close</button></div>
            <div className="modal__body">
              <label><span className="im-label">Name</span><input className="im-input" autoFocus placeholder="Venus vs competitors, Q2 review" value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label><span className="im-label">Description (optional)</span><input className="im-input" placeholder="What is this dashboard for?" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
              <div>
                <span className="im-label">Start from</span>
                <div className="grid-2">
                  {TEMPLATES.map((t) => (
                    <button key={t.id} className="catalog__item" style={{ borderColor: template === t.id ? "var(--Primary-600)" : undefined }} onClick={() => setTemplate(t.id)} aria-pressed={template === t.id}>
                      <b>{t.name}</b><small>{t.description}</small>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal__foot">
              <button className="im-btn im-btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
              <button className="im-btn im-btn-primary" onClick={() => void create()} disabled={creating}>{creating ? "Creating…" : "Create dashboard"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
