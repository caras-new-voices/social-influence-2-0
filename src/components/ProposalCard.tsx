"use client";
import type { Row } from "@/lib/chart-data";
import type { WidgetSpec } from "@/lib/widgets";
import { useWidgetRows } from "./WidgetCard";
import { WidgetBody } from "./WidgetBody";

export interface Proposal {
  widget: WidgetSpec;
  data?: Row[];
  replaces?: string;
}

export function ProposalCard({
  proposal,
  added,
  replacedTitle,
  onAdd,
  onDismiss,
  onRefine,
}: {
  proposal: Proposal;
  added: boolean;
  replacedTitle?: string;
  onAdd: () => void;
  onDismiss: () => void;
  onRefine: () => void;
}) {
  const { widget } = proposal;
  const { rows, loading, error } = useWidgetRows(widget, proposal.data);
  const short = widget.type === "section" || widget.type === "text" || widget.type === "kpi";
  return (
    <div className="proposal">
      <div className="proposal__head">
        <div>
          <span className="im-badge im-badge-primary" style={{ marginBottom: "0.3rem" }}>{widget.type.replace("_", " ")}{proposal.replaces ? " · replacement" : ""}</span>
          <div className="proposal__title">{widget.title}</div>
          {widget.subtitle && <div className="proposal__sub">{widget.subtitle}</div>}
        </div>
      </div>
      {widget.type !== "section" && (
        <div className={`proposal__body ${short ? "proposal__body--short" : ""}`} style={widget.type === "kpi" ? { height: 110 } : undefined}>
          {loading ? <div className="widget__state"><span className="spinner" /></div> : error ? <div className="widget__state widget__state--error">{error}</div> : <WidgetBody spec={widget} rows={rows} />}
        </div>
      )}
      {widget.rationale && <div className="proposal__rationale">{widget.rationale}</div>}
      <div className="proposal__actions">
        {added ? (
          <span className="proposal__added">✓ {proposal.replaces ? "Replaced on dashboard" : "Added to dashboard"}</span>
        ) : (
          <>
            <button className="im-btn im-btn-primary im-btn-sm" onClick={onAdd}>
              {proposal.replaces ? `Replace "${replacedTitle ?? "widget"}"` : "Add to dashboard"}
            </button>
            <button className="im-btn im-btn-secondary im-btn-sm" onClick={onRefine}>Refine</button>
            <button className="im-btn im-btn-ghost im-btn-sm" onClick={onDismiss}>Dismiss</button>
          </>
        )}
      </div>
    </div>
  );
}
