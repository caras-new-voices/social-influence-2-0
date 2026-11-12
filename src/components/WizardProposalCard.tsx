"use client";
import { useState } from "react";
import { Lightbox } from "./Lightbox";
import type { Proposal } from "./ProposalCard";
import { useWidgetRows } from "./WidgetCard";
import { WidgetBody } from "./WidgetBody";

/**
 * The guided setup's proposal card: the same live preview and look as ProposalCard, with the
 * wizard's copy (Add, Adjust, Dismiss) and an undo once added.
 */
export function WizardProposalCard({
  proposal,
  added,
  onAdd,
  onRemove,
  onAdjust,
  onDismiss,
}: {
  proposal: Proposal;
  added: boolean;
  onAdd: () => void;
  onRemove: () => void;
  onAdjust: () => void;
  onDismiss: () => void;
}) {
  const { widget } = proposal;
  const { rows, loading, error } = useWidgetRows(widget, proposal.data);
  const [expanded, setExpanded] = useState(false);
  const short = widget.type === "section" || widget.type === "text" || widget.type === "kpi";
  return (
    <div className={`proposal wiz__card ${added ? "is-added" : ""}`}>
      <div className="proposal__head">
        <div className="grow">
          <span className="im-badge im-badge-primary" style={{ marginBottom: "0.3rem" }}>{widget.type.replace("_", " ")}{proposal.replaces ? " · replacement" : ""}</span>
          <div className="proposal__title">{widget.title}</div>
          {widget.subtitle && <div className="proposal__sub">{widget.subtitle}</div>}
        </div>
        {widget.type !== "section" && widget.type !== "text" && (
          <button className="im-btn im-btn-ghost im-btn-icon" onClick={() => setExpanded(true)} aria-label={`Expand ${widget.title}`} title="Expand">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5" /></svg>
          </button>
        )}
      </div>
      {expanded && <Lightbox widget={widget} rows={rows} onClose={() => setExpanded(false)} />}
      {widget.type !== "section" && (
        <div className={`proposal__body ${short ? "proposal__body--short" : ""}`} style={widget.type === "kpi" ? { height: 110 } : undefined}>
          {loading ? <div className="widget__state"><span className="spinner" /></div> : error ? <div className="widget__state widget__state--error">{error}</div> : <WidgetBody spec={widget} rows={rows} />}
        </div>
      )}
      {widget.rationale && <div className="proposal__rationale">{widget.rationale}</div>}
      <div className="proposal__actions">
        {added ? (
          <>
            <span className="proposal__added">✓ Added</span>
            <button className="im-btn im-btn-ghost im-btn-sm" onClick={onRemove}>Remove</button>
          </>
        ) : (
          <>
            <button className="im-btn im-btn-primary im-btn-sm" onClick={onAdd}>Add</button>
            <button className="im-btn im-btn-secondary im-btn-sm" onClick={onAdjust}>Adjust</button>
            <button className="im-btn im-btn-ghost im-btn-sm" onClick={onDismiss}>Dismiss</button>
          </>
        )}
      </div>
    </div>
  );
}
