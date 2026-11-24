"use client";
import { useMemo } from "react";
import GridLayout, { useContainerWidth, type Layout } from "react-grid-layout";
import { useWorkspace } from "./WorkspaceProvider";
import type { Row } from "@/lib/chart-data";
import type { WidgetPeriod } from "@/lib/period";
import type { WidgetSpec } from "@/lib/widgets";
import { WidgetCard } from "./WidgetCard";

export const ROW_HEIGHT = 56;

/** One part of a summary: a heading, the boxes under it, how many boxes sit behind it, and the section to open for the detail. */
export interface SummaryPart { heading: string; sectionId: string | null; boxes: WidgetSpec[]; behind: number }

const ordered = (widgets: WidgetSpec[]) => [...widgets].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);

/**
 * The one-page summary of a dashboard: the outcomes and headline measures, then the one box that
 * answers each section's question. A box belongs to the summary when its title starts with
 * "The answer" or "The three outcomes"; the first section also gives its first KPI box.
 * Dashboards without such boxes have no summary.
 */
export function summaryParts(widgets: WidgetSpec[]): SummaryPart[] {
  const parts: SummaryPart[] = [];
  let section: WidgetSpec | null = null;
  let group: WidgetSpec[] = [];
  const close = () => {
    const boxes = group.filter((w) => /^the (answer|three outcomes)\b/i.test(w.title));
    const kpi = parts.length === 0 ? group.find((w) => w.type === "kpi") : undefined;
    if (kpi) boxes.push(kpi);
    if (boxes.length) parts.push({ heading: section?.title ?? "The headline numbers", sectionId: section?.id ?? null, boxes, behind: group.filter((w) => !boxes.includes(w) && w.type !== "text").length });
  };
  for (const w of ordered(widgets)) {
    if (w.type === "section") { close(); section = w; group = []; } else group.push(w);
  }
  close();
  return parts;
}

/** A leader's summary: for each question they ask first, the boxes of this dashboard that answer it. */
export function leaderParts(widgets: WidgetSpec[], asks: Array<{ question: string; titles: string[] }>): SummaryPart[] {
  const list = ordered(widgets);
  const sectionOf = (w: WidgetSpec) => {
    let section: WidgetSpec | null = null;
    for (const x of list) { if (x.type === "section") section = x; if (x.id === w.id) break; }
    return section?.id ?? null;
  };
  return asks
    .map((a) => ({ heading: a.question, boxes: a.titles.map((t) => list.find((w) => w.title === t)).filter((w): w is WidgetSpec => !!w) }))
    .filter((p) => p.boxes.length)
    .map((p) => ({ ...p, sectionId: sectionOf(p.boxes[0]), behind: 0 }));
}

export function DashboardCanvas({
  widgets,
  onLayoutChange,
  onEdit,
  onRemove,
  onAsk,
  onChange,
  onExpand,
  onVoice,
  onAddClick,
  onSetPeriod,
  summary,
  onSeeDetail,
}: {
  onSetPeriod: (id: string, p: WidgetPeriod) => void;
  /** When set, the summary is shown in place of the grid: one answer per section. */
  summary?: SummaryPart[] | null;
  /** Opens the full dashboard at a section (or at the top when the answer has no section). */
  onSeeDetail?: (sectionId: string | null) => void;
  widgets: WidgetSpec[];
  onLayoutChange: (layout: Layout) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onAsk: (id: string) => void;
  /** Starts a chat to change one element. */
  onChange?: (id: string) => void;
  onExpand: (id: string) => void;
  onVoice: (id: string, rows: Row[]) => void;
  onAddClick: () => void;
}) {
  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 1100 });
  const { brands } = useWorkspace();
  const layout = useMemo<Layout>(
    () => widgets.map((w) => ({ i: w.id, x: w.layout.x, y: w.layout.y, w: w.layout.w, h: w.layout.h, minW: 2, minH: 1 })),
    [widgets],
  );

  return (
    <div ref={containerRef}>
      <div className="canvas__legend" style={{ marginBottom: "0.75rem" }}>
        {brands.map((b) => (
          <span key={b.name}><i className="dot" style={{ background: b.color }} />{b.name}{b.role === "focal" ? " (you)" : ""}</span>
        ))}
      </div>
      {summary ? (
        <div className="summary">
          {summary.map((p) => (
            <section key={p.heading} className="summary__part">
              <div className="summary__head">
                <h2 className="im-text-header">{p.heading}</h2>
                {onSeeDetail && (p.behind > 0 ? (
                  <button className="im-btn im-btn-ghost im-btn-sm" onClick={() => onSeeDetail(p.sectionId)}>See the {p.behind} {p.behind === 1 ? "box" : "boxes"} behind this →</button>
                ) : p.sectionId ? (
                  <button className="im-btn im-btn-ghost im-btn-sm" onClick={() => onSeeDetail(p.sectionId)}>See it in the full dashboard →</button>
                ) : null)}
              </div>
              <div className="summary__boxes">
                {p.boxes.map((w) => (
                  <WidgetCard key={w.id} spec={w} onEdit={() => onEdit(w.id)} onRemove={() => onRemove(w.id)} onAsk={() => onAsk(w.id)} onChange={onChange ? () => onChange(w.id) : undefined} onExpand={() => onExpand(w.id)} onVoice={(rows) => onVoice(w.id, rows)} onSetPeriod={(per) => onSetPeriod(w.id, per)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : widgets.length === 0 ? (
        <div className="canvas__empty">
          <p className="im-text-sub-header" style={{ marginBottom: "0.4rem" }}>Your dashboard is empty</p>
          <p className="im-text-description" style={{ marginBottom: "1rem" }}>Ask the assistant for a chart, or add an element from the catalog.</p>
          <button className="im-btn im-btn-primary" onClick={onAddClick}>Add element</button>
        </div>
      ) : (
        mounted && (
          <GridLayout
            layout={layout}
            width={width}
            gridConfig={{ cols: 12, rowHeight: ROW_HEIGHT, margin: [12, 12], containerPadding: [0, 0] }}
            dragConfig={{ handle: ".drag-handle", cancel: ".no-drag" }}
            resizeConfig={{ handles: ["se"] }}
            onLayoutChange={onLayoutChange}
          >
            {widgets.map((w) => (
              <div key={w.id} data-wid={w.id}>
                <WidgetCard spec={w} onEdit={() => onEdit(w.id)} onRemove={() => onRemove(w.id)} onAsk={() => onAsk(w.id)} onChange={onChange ? () => onChange(w.id) : undefined} onExpand={() => onExpand(w.id)} onVoice={(rows) => onVoice(w.id, rows)} onSetPeriod={(p) => onSetPeriod(w.id, p)} />
              </div>
            ))}
          </GridLayout>
        )
      )}
    </div>
  );
}
