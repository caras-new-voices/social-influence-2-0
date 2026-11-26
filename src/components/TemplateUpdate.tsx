"use client";
import { useEffect, useState } from "react";
import type { WidgetSpec } from "@/lib/widgets";

interface Plan { template: string | null; added: WidgetSpec[]; moves: Record<string, number>; changed: Array<{ id: string; title: string; next: WidgetSpec }>; own: number }

/**
 * Tells the person when the template their dashboard was made from has moved on, and brings the
 * dashboard up to date: new boxes are added where the template has them, and boxes whose
 * definition changed are refreshed. Their own boxes, the layout and each box's own period stay.
 * The change lands as one unsaved step, so Undo takes it back and Save keeps it.
 */
export function TemplateUpdate({ dashboardId, widgets, apply }: { dashboardId: string; widgets: WidgetSpec[]; apply: (next: WidgetSpec[], summary: string) => void }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [addNew, setAddNew] = useState(true);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  useEffect(() => {
    let live = true;
    // After the boxes have had a head start: this check builds the template and should not slow the page.
    const t = window.setTimeout(() => {
      fetch(`/api/dashboards/${dashboardId}/template-update`).then((r) => (r.ok ? r.json() : null)).then((j: Plan | null) => { if (live && j && !("error" in j)) setPlan(j); }).catch(() => {});
    }, 2500);
    return () => { live = false; window.clearTimeout(t); };
  }, [dashboardId]);
  if (!plan || hidden) return null;
  // Only what is still true of the boxes on screen (the person may have removed or edited some since).
  const ids = new Set(widgets.map((w) => w.id));
  const changed = plan.changed.filter((c) => ids.has(c.id));
  const added = plan.added;
  if (!added.length && !changed.length) return null;
  const refresh = changed.filter((c) => !skip.has(c.id));
  const run = () => {
    const byId = new Map(refresh.map((c) => [c.id, c.next]));
    let next = widgets.map((w) => {
      const fresh = byId.get(w.id);
      // The refreshed definition, in the place and with the period the box has now.
      return fresh ? { ...fresh, id: w.id, layout: w.layout, ...(w.period ? { period: w.period } : {}) } : w;
    });
    if (addNew && added.length) next = [...next.map((w) => (plan.moves[w.id] !== undefined ? { ...w, layout: { ...w.layout, y: plan.moves[w.id] } } : w)), ...added];
    const parts = [addNew && added.length ? `${added.length} new` : "", refresh.length ? `${refresh.length} refreshed` : ""].filter(Boolean).join(", ");
    apply(next, parts);
    setOpen(false);
    setHidden(true);
  };
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <>
      <div className="tplup no-print" role="status">
        <span>
          <b>This dashboard can be brought up to date.</b> The template it was made from has changed:{" "}
          {[added.length ? count(added.length, "new box", "new boxes") : "", changed.length ? count(changed.length, "improved box", "improved boxes") : ""].filter(Boolean).join(" and ")}.
        </span>
        <span className="row" style={{ gap: "0.4rem" }}>
          <button className="im-btn im-btn-primary im-btn-sm" onClick={() => setOpen(true)}>See what changes</button>
          <button className="im-btn im-btn-ghost im-btn-sm" onClick={() => setHidden(true)} aria-label="Not now">Not now</button>
        </span>
      </div>
      {open && (
        <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Bring this dashboard up to date">
            <div className="modal__head"><h3 className="im-text-header">Bring this dashboard up to date</h3><button className="im-btn im-btn-ghost im-btn-sm" onClick={() => setOpen(false)}>Close</button></div>
            <div className="modal__body tplup__body">
              <p>Nothing is removed. Your layout, each box&apos;s own period{plan.own ? ` and the ${count(plan.own, "box that is", "boxes that are")} yours alone` : ""} stay as they are. The update is one step: Undo takes it back, and it is kept only when you press Save.</p>
              {added.length > 0 && (
                <section>
                  <label className="tplup__check"><input type="checkbox" checked={addNew} onChange={(e) => setAddNew(e.target.checked)} /> <b>Add the {count(added.length, "new box", "new boxes")}</b>, each where the template has it</label>
                  <ul className="tplup__list">{added.map((w) => <li key={w.id}>{w.title}{w.type === "section" ? " (a section heading)" : ""}</li>)}</ul>
                </section>
              )}
              {changed.length > 0 && (
                <section>
                  <p><b>Refresh the {count(changed.length, "box", "boxes")} whose definition changed.</b> Untick any you edited yourself and want to keep as it is.</p>
                  <ul className="tplup__list tplup__list--checks">
                    {changed.map((c) => (
                      <li key={c.id}><label className="tplup__check"><input type="checkbox" checked={!skip.has(c.id)} onChange={(e) => setSkip((s) => { const n = new Set(s); if (e.target.checked) n.delete(c.id); else n.add(c.id); return n; })} /> {c.title}</label></li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
            <div className="modal__foot">
              <button className="im-btn im-btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
              <button className="im-btn im-btn-primary" onClick={run} disabled={!(addNew && added.length) && !refresh.length}>Update the dashboard</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
