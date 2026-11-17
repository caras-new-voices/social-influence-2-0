"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Row } from "@/lib/chart-data";
import { columnKind, kpiKind, KIND_LABEL, prettyKey, type MeasureKind, type NumberFormat } from "@/lib/format";
import { formatWindow } from "@/lib/period";
import type { WidgetSpec } from "@/lib/widgets";

const KIND_SHORT: Record<MeasureKind, string> = {
  count: "absolute numbers",
  share: "percentages of a whole",
  change: "percent change against the period before",
  points: "a gap between two shares, in points",
  ratio: "one number against another; 1.0 means equal",
  rate: "an average or a per-unit figure, not a total",
  money: "currency",
};

/** What the element shows, in a sentence, when it has no subtitle of its own. */
function fallbackDescription(spec: WidgetSpec): string {
  const y = spec.y ? prettyKey(spec.y).toLowerCase() : "the value";
  const x = spec.x ? prettyKey(spec.x).toLowerCase() : "category";
  switch (spec.type) {
    case "kpi":
      return "Headline numbers, one per tile.";
    case "bar":
      return `${prettyKey(y)} for each ${x}.`;
    case "stacked_bar":
      return `${prettyKey(y)} for each ${x}, split by ${spec.series ? prettyKey(spec.series).toLowerCase() : "series"}${spec.normalize ? ", as shares of each bar" : ""}.`;
    case "line":
      return `How ${y} moves over ${x}${spec.series ? `, one line per ${prettyKey(spec.series).toLowerCase()}` : ""}.`;
    case "segmented":
      return `How one whole splits by ${x}.`;
    case "table":
      return "A table of the underlying rows.";
    case "insight":
      return "A written summary drawn from the data.";
    case "text":
      return "A note added to the dashboard.";
    default:
      return "";
  }
}

/** How to read the element, by type. */
function readingTip(spec: WidgetSpec): string | null {
  switch (spec.type) {
    case "kpi":
      return "Each tile says whether it is a count, a share or a rate. Arrows compare with the period before.";
    case "table":
      return "Click a column header to sort.";
    case "bar":
    case "stacked_bar":
    case "line":
    case "segmented":
      return "Hover the chart for exact values. The table button in the corner shows the same numbers as a table.";
    default:
      return null;
  }
}

/** The numbers in the element grouped by kind: counts, shares, rates and so on. */
function numberKinds(spec: WidgetSpec, rows: Row[]): Array<{ kind: MeasureKind; names: string[] }> {
  const groups = new Map<MeasureKind, string[]>();
  const add = (kind: MeasureKind, name: string) => {
    const list = groups.get(kind) ?? [];
    if (!list.includes(name)) list.push(name);
    groups.set(kind, list);
  };
  if (spec.type === "kpi") {
    for (const r of rows.slice(0, 8)) {
      const label = String(r.label ?? "");
      if (!label) continue;
      const fmt = ((r.fmt as string) || spec.format || "compact") as NumberFormat;
      add(kpiKind(label, fmt), label);
    }
  } else if (spec.type === "table") {
    const cols = rows[0] ? Object.keys(rows[0]) : [];
    for (const c of cols) if (rows.some((r) => typeof r[c] === "number")) add(spec.format === "percent" ? "share" : columnKind(c), prettyKey(c));
  } else if (["bar", "stacked_bar", "line", "segmented"].includes(spec.type)) {
    const name = prettyKey(spec.y ?? "value");
    const f = spec.format;
    const kind: MeasureKind =
      spec.normalize || f === "percent" ? "share"
        : f === "ratio" ? "ratio"
        : f === "points" ? "points"
        : f === "currency" ? "money"
        : f === "decimal" ? "rate"
        : columnKind(spec.y ?? "value");
    add(kind, spec.normalize ? `${name} (as a share of each bar)` : name);
    if (spec.type === "segmented") add("share", "Each part's share of the whole");
  }
  return [...groups.entries()].map(([kind, names]) => ({ kind, names }));
}

function periodText(spec: WidgetSpec, current: string): string {
  if (spec.period === "all") return "All time. This box ignores the dashboard period.";
  if (spec.period && spec.period !== "inherit") return `${formatWindow(spec.period)}. This box is pinned to that window.`;
  return `${current}, the dashboard period.`;
}

/**
 * The "i" button on a dashboard element: a short explanation of what the element shows, why it
 * matters and what kind of numbers it holds, with buttons to ask the analyst for more or to
 * change the element in the chat.
 */
export function WidgetInfo({
  spec,
  rows,
  periodLabel,
  onAsk,
  onChange,
}: {
  spec: WidgetSpec;
  rows: Row[];
  periodLabel: string;
  onAsk: () => void;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const place = () => {
      const r = btn.current!.getBoundingClientRect();
      const width = 320;
      const left = Math.max(12, Math.min(r.left - 12, window.innerWidth - width - 12));
      const below = r.bottom + 8;
      const height = pop.current?.offsetHeight ?? 260;
      const top = below + height > window.innerHeight - 12 ? Math.max(12, r.top - height - 8) : below;
      setPos({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const kinds = open ? numberKinds(spec, rows) : [];
  const tip = readingTip(spec);
  const description = spec.subtitle?.trim() || fallbackDescription(spec);
  const id = `winfo-${spec.id}`;

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`winfo__btn no-drag ${open ? "is-open" : ""}`}
        aria-label={`What "${spec.title}" shows`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title="What this shows"
        onClick={() => setOpen((o) => !o)}
      >
        i
      </button>
      {open &&
        createPortal(
          <div
            ref={pop}
            id={id}
            role="dialog"
            aria-label={`About ${spec.title}`}
            className="winfo__pop"
            style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
          >
            <div className="winfo__head">{spec.title}</div>
            {description && (
              <section>
                <h4>What it shows</h4>
                <p>{description}</p>
              </section>
            )}
            {spec.rationale && (
              <section>
                <h4>Why it matters</h4>
                <p>{spec.rationale}</p>
              </section>
            )}
            {kinds.length > 0 && (
              <section>
                <h4>The numbers</h4>
                <ul>
                  {kinds.map((k) => (
                    <li key={k.kind}>
                      <span className={`winfo__kind kpi__kind--${k.kind}`}>{KIND_LABEL[k.kind]}</span>
                      <span>
                        {k.names.join(", ")}
                        <span className="winfo__muted"> · {KIND_SHORT[k.kind]}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <h4>Period</h4>
              <p>{periodText(spec, periodLabel)}</p>
            </section>
            {tip && <p className="winfo__muted">{tip}</p>}
            <div className="winfo__actions">
              <button
                type="button"
                className="im-btn im-btn-primary im-btn-sm"
                onClick={() => {
                  setOpen(false);
                  onAsk();
                }}
              >
                Ask AI for more detail
              </button>
              <button
                type="button"
                className="im-btn im-btn-secondary im-btn-sm"
                onClick={() => {
                  setOpen(false);
                  onChange();
                }}
              >
                Change this box
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
