"use client";
import { useMemo } from "react";
import GridLayout, { useContainerWidth, type Layout } from "react-grid-layout";
import { BRANDS } from "@/lib/brands";
import type { Row } from "@/lib/chart-data";
import type { WidgetSpec } from "@/lib/widgets";
import { WidgetCard } from "./WidgetCard";

export const ROW_HEIGHT = 56;

export function DashboardCanvas({
  widgets,
  onLayoutChange,
  onEdit,
  onRemove,
  onAsk,
  onExpand,
  onVoice,
  onAddClick,
}: {
  widgets: WidgetSpec[];
  onLayoutChange: (layout: Layout) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onAsk: (id: string) => void;
  onExpand: (id: string) => void;
  onVoice: (id: string, rows: Row[]) => void;
  onAddClick: () => void;
}) {
  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 1100 });
  const layout = useMemo<Layout>(
    () => widgets.map((w) => ({ i: w.id, x: w.layout.x, y: w.layout.y, w: w.layout.w, h: w.layout.h, minW: 2, minH: 1 })),
    [widgets],
  );

  return (
    <div ref={containerRef}>
      <div className="canvas__legend" style={{ marginBottom: "0.75rem" }}>
        {BRANDS.map((b) => (
          <span key={b.name}><i className="dot" style={{ background: b.color }} />{b.name}{b.role === "focal" ? " (you)" : ""}</span>
        ))}
      </div>
      {widgets.length === 0 ? (
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
              <div key={w.id}>
                <WidgetCard spec={w} onEdit={() => onEdit(w.id)} onRemove={() => onRemove(w.id)} onAsk={() => onAsk(w.id)} onExpand={() => onExpand(w.id)} onVoice={(rows) => onVoice(w.id, rows)} />
              </div>
            ))}
          </GridLayout>
        )
      )}
    </div>
  );
}
