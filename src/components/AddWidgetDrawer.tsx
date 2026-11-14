"use client";
import { useEffect } from "react";
import { starterCatalog } from "@/lib/starter";
import type { WidgetSpec } from "@/lib/widgets";
import { CHANGE_WIDGETS } from "@/lib/templates";

type Template = Omit<WidgetSpec, "id" | "layout">;

const STRUCTURE: Template[] = [
  { type: "section", title: "New section", rationale: "A header row to organise the dashboard." },
  { type: "text", title: "Note", content: "Write a note for your team here. **Bold** text and\n\n- bullet points\n- are supported.", rationale: "Free text for context, caveats or takeaways." },
];

export function AddWidgetDrawer({ onAdd, onClose }: { onAdd: (t: Template) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--wide" role="dialog" aria-label="Add element">
        <div className="modal__head">
          <div>
            <h3 className="im-text-header">Add an element</h3>
            <p className="im-text-description">Pick from the default catalog, or ask the assistant for something custom.</p>
          </div>
          <button className="im-btn im-btn-ghost im-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="modal__body">
          <span className="im-micro-label">Structure</span>
          <div className="catalog">
            {STRUCTURE.map((t) => (
              <button key={t.title} className="catalog__item" onClick={() => onAdd(t)}>
                <b>{t.title}</b><small>{t.rationale}</small>
              </button>
            ))}
          </div>
          <span className="im-micro-label">Starter elements</span>
          <div className="catalog">
            {starterCatalog().map((t) => (
              <button key={t.title} className="catalog__item" onClick={() => onAdd(t)}>
                <span className="im-badge" style={{ alignSelf: "flex-start" }}>{t.type.replace("_", " ")}</span>
                <b>{t.title}</b><small>{t.rationale}</small>
              </button>
            ))}
          </div>
          <span className="im-micro-label">Change over time</span>
          <div className="catalog">
            {CHANGE_WIDGETS.map((t) => (
              <button key={t.title} className="catalog__item" onClick={() => onAdd(t)}>
                <span className="im-badge" style={{ alignSelf: "flex-start" }}>{t.type.replace("_", " ")}</span>
                <b>{t.title}</b><small>{t.rationale}</small>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
