"use client";
import Link from "next/link";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { selfCompares,
  cmpKey,
  compareTable,
  delta,
  desaturate,
  overlayCompare,
  seriesColor,
  shapeCompare,
  shapeRows,
  X_CMP,
  X_CUR,
  type CompareTableRow,
  type Row,
} from "@/lib/chart-data";
import { formatNumber, prettyKey, type NumberFormat } from "@/lib/format";
import type { WidgetSpec } from "@/lib/widgets";

const AXIS_TICK = { fontSize: 11, fill: "#8490ad" };
const GRID = "#e9ebf0";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Category tick that wraps long names onto two lines so every category stays labelled. */
function WrappedTick({ x, y, payload }: { x?: number; y?: number; payload?: { value?: unknown } }) {
  const text = tickLabel(payload?.value);
  const words = text.split(" ");
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + " " + w).length <= 12) lines[lines.length - 1] = last + " " + w;
    else lines.push(w);
  }
  const shown = lines.slice(0, 2);
  if (lines.length > 2) shown[1] = shown[1].slice(0, 10) + "…";
  return (
    <g transform={`translate(${x ?? 0},${y ?? 0})`}>
      <text textAnchor="middle" fill="#8490ad" fontSize={11}>
        {shown.map((l, i) => (
          <tspan key={i} x={0} dy={i === 0 ? 12 : 12}>{l}</tspan>
        ))}
      </text>
    </g>
  );
}

/** Shortens ISO-ish month and date labels ("2026-02" -> "Feb 26", "2026-02-14" -> "14 Feb"). */
function tickLabel(v: unknown): string {
  const s = String(v ?? "");
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(s);
  if (!m) return s;
  const mon = MONTHS[Number(m[2]) - 1] ?? m[2];
  return m[3] ? `${Number(m[3])} ${mon}` : `${mon} ${m[1].slice(2)}`;
}

function Legend({ series, colors, line }: { series: string[]; colors: Record<string, string>; line?: boolean }) {
  if (series.length < 2) return null;
  return (
    <div className="chart__legend" aria-label="Legend">
      {series.map((s) => (
        <span key={s}>
          <i className={line ? "line" : ""} style={{ background: colors[s] }} /> {prettyKey(s)}
        </span>
      ))}
    </div>
  );
}

interface TipProps {
  active?: boolean;
  label?: unknown;
  payload?: Array<{ name?: string; value?: unknown; color?: string }>;
  fmt: NumberFormat;
}
function TipContent({ active, label, payload, fmt }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tip">
      <div className="tip__title">{String(label ?? "")}</div>
      {payload.map((p) => (
        <div className="tip__row" key={String(p.name)}>
          <span><i className="tip__key" style={{ background: p.color }} />{prettyKey(String(p.name))}</span>
          <b>{formatNumber(p.value, fmt)}</b>
        </div>
      ))}
    </div>
  );
}

export function BarChartW({ rows, spec, stacked }: { rows: Row[]; spec: WidgetSpec; stacked?: boolean }) {
  const shaped = useMemo(() => shapeRows(rows, spec), [rows, spec]);
  const fmt = (spec.format ?? (spec.normalize ? "percent" : "compact")) as NumberFormat;
  const horizontal = !!spec.horizontal;
  const tickFmt = (v: unknown) => formatNumber(v, fmt);
  const { data, xKey, series, colors } = shaped;
  if (!data.length) return <div className="widget__state">No data</div>;
  const catWidth = Math.min(150, Math.max(60, Math.max(...data.map((d) => String(d[xKey]).length)) * 6.5));
  return (
    <>
      <Legend series={series} colors={colors} />
      <div className="chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 6, right: 12, left: 0, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid stroke={GRID} vertical={horizontal} horizontal={!horizontal} />
            {horizontal ? (
              <>
                <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={tickFmt} domain={spec.normalize ? [0, 1] : undefined} />
                <YAxis type="category" dataKey={xKey} tick={AXIS_TICK} axisLine={false} tickLine={false} width={catWidth} interval={0} />
              </>
            ) : (
              <>
                {data.length <= 12 ? (
                  <XAxis dataKey={xKey} tick={<WrappedTick />} axisLine={false} tickLine={false} interval={0} height={34} />
                ) : (
                  <XAxis dataKey={xKey} tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={16} tickFormatter={tickLabel} />
                )}
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={tickFmt} width={48} domain={spec.normalize ? [0, 1] : undefined} />
              </>
            )}
            <Tooltip content={<TipContent fmt={fmt} />} cursor={{ fill: "rgba(113,50,245,0.06)" }} labelFormatter={(l) => tickLabel(l)} />
            {series.map((s, i) => {
              const last = i === series.length - 1;
              const radius: [number, number, number, number] = stacked
                ? last ? (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : [0, 0, 0, 0]
                : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0];
              // A single series whose categories are entities with fixed identity colors (brands,
              // platforms, sentiment) keeps those colors so the chart matches the dashboard legend.
              const perCategory = !stacked && series.length === 1 && !!spec.colorBy && spec.colorBy !== "auto";
              return (
                <Bar
                  key={s}
                  dataKey={s}
                  stackId={stacked ? "a" : undefined}
                  fill={colors[s]}
                  maxBarSize={24}
                  radius={radius}
                  stroke={stacked ? "#fff" : undefined}
                  strokeWidth={stacked ? 2 : 0}
                  isAnimationActive={false}
                >
                  {perCategory && data.map((d, j) => <Cell key={j} fill={seriesColor(String(d[xKey]), j, spec.colorBy)} />)}
                </Bar>
              );
            })}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

export function LineChartW({ rows, spec }: { rows: Row[]; spec: WidgetSpec }) {
  const shaped = useMemo(() => shapeRows(rows, spec), [rows, spec]);
  const fmt = (spec.format ?? "compact") as NumberFormat;
  const { data, xKey, series, colors } = shaped;
  if (!data.length) return <div className="widget__state">No data</div>;
  return (
    <>
      <Legend series={series} colors={colors} line />
      <div className="chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey={xKey} tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={28} tickFormatter={tickLabel} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v) => formatNumber(v, fmt)} width={48} />
            <Tooltip content={<TipContent fmt={fmt} />} cursor={{ stroke: "#cfd5e0", strokeWidth: 1 }} labelFormatter={(l) => tickLabel(l)} />
            {series.map((s) => (
              <Line
                key={s}
                type="monotone"
                dataKey={s}
                stroke={colors[s]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

export function SegmentedBar({ rows, spec }: { rows: Row[]; spec: WidgetSpec }) {
  const shaped = useMemo(() => shapeRows(rows, { ...spec, normalize: false }), [rows, spec]);
  const { data, xKey, series } = shaped;
  const valueKey = series[0];
  if (!data.length) return <div className="widget__state">No data</div>;
  const sorted = [...data].sort((a, b) => Number(b[valueKey]) - Number(a[valueKey]));
  const parts = sorted.slice(0, 6);
  const rest = sorted.slice(6).reduce((s, r) => s + Number(r[valueKey] ?? 0), 0);
  if (rest > 0) parts.push({ [xKey]: "Other", [valueKey]: rest });
  const total = parts.reduce((s, r) => s + Number(r[valueKey] ?? 0), 0) || 1;
  const colors = parts.map((p, i) => seriesColor(String(p[xKey]), i, spec.colorBy));
  return (
    <div className="seg">
      <div className="seg__bar" role="img" aria-label={parts.map((p) => `${p[xKey]} ${Math.round((Number(p[valueKey]) / total) * 100)}%`).join(", ")}>
        {parts.map((p, i) => {
          const share = Number(p[valueKey]) / total;
          return (
            <div key={String(p[xKey])} className="seg__part" style={{ width: `${share * 100}%`, background: colors[i] }} title={`${p[xKey]}: ${formatNumber(p[valueKey], spec.format ?? "compact")} (${Math.round(share * 100)}%)`}>
              {share > 0.08 ? `${Math.round(share * 100)}%` : ""}
            </div>
          );
        })}
      </div>
      <div className="chart__legend">
        {parts.map((p, i) => (
          <span key={String(p[xKey])}><i style={{ background: colors[i] }} /> {String(p[xKey])}</span>
        ))}
      </div>
    </div>
  );
}

export function KpiRow({ rows, spec, compareLabel }: { rows: Row[]; spec: WidgetSpec; compareLabel?: string }) {
  // A query that reads period_start() compares with the period before, not with a benchmark.
  const ownPeriod = selfCompares(spec.sql);
  if (!rows.length) return <div className="widget__state">No data</div>;
  const tiles = rows.slice(0, 8);
  return (
    <div className="kpis">
      {tiles.map((r, i) => {
        const fmt = ((r.fmt as string) || spec.format || "compact") as NumberFormat;
        const value = r.value ?? Object.values(r).find((v) => typeof v === "number");
        const compare = typeof r.compare === "number" ? r.compare : undefined;
        const delta = compare !== undefined && compare !== 0 && typeof value === "number" ? (value - compare) / Math.abs(compare) : undefined;
        const dir = delta === undefined ? "flat" : delta > 0.005 ? "up" : delta < -0.005 ? "down" : "flat";
        return (
          <div className="kpi" key={i}>
            <div className="kpi__label" title={String(r.label ?? "")}>{String(r.label ?? prettyKey(Object.keys(r)[0]))}</div>
            <div className="kpi__value">{formatNumber(value, fmt)}</div>
            {delta !== undefined && (
              <div
                className={`kpi__delta kpi__delta--${dir}`}
                title={r.__cmpFilled && compareLabel ? `Versus ${compareLabel}: ${formatNumber(compare, fmt)}` : `${ownPeriod ? "Previous period" : "Benchmark"} ${formatNumber(compare, fmt)}`}
              >
                {dir === "up" ? "▲" : dir === "down" ? "▼" : "•"} {Math.abs(delta * 100).toFixed(0)}% vs {r.__cmpFilled && compareLabel ? compareLabel : ownPeriod ? "previous period" : "benchmark"}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const CREATOR_COLUMNS = new Set(["username", "creator", "influencer", "handle", "creator_handle", "influencer_username"]);
const PLATFORM_COLUMNS = ["platform", "network"];

function creatorHref(row: Row, value: string): string {
  const platform = PLATFORM_COLUMNS.map((k) => row[k]).find((v) => typeof v === "string") as string | undefined;
  const id = typeof row.influencer_id === "number" ? row.influencer_id : undefined;
  const params = new URLSearchParams();
  if (platform) params.set("platform", platform);
  if (id) params.set("id", String(id));
  const q = params.toString();
  return `/creator/${encodeURIComponent(value)}${q ? `?${q}` : ""}`;
}

function compareValues(a: unknown, b: unknown): number {
  const an = a === null || a === undefined || a === "";
  const bn = b === null || b === undefined || b === "";
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/** How one table cell renders (links, creator pages, dates, numbers, arrays). */
function cellContent(r: Row, c: string, fmt?: NumberFormat): ReactNode {
  const v = r[c];
  const isLink = typeof v === "string" && /^https?:\/\//.test(v);
  const isIsoDate = typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v);
  const isCreator = typeof v === "string" && v.length > 0 && CREATOR_COLUMNS.has(c.toLowerCase());
  return isLink ? <a href={v} target="_blank" rel="noreferrer">Open ↗</a>
    : isCreator ? <Link href={creatorHref(r, v)} className="tbl__creator" title={`Open ${v}'s creator page`}>{v}</Link>
    : isIsoDate ? v.slice(0, 10)
    : typeof v === "number" ? formatNumber(v, fmt ?? (Number.isInteger(v) ? "number" : "decimal"))
    : v === null || v === undefined ? "–"
    : Array.isArray(v) ? v.join(", ")
    : typeof v === "object" ? JSON.stringify(v)
    : String(v);
}

export function DataTable({ rows, fmt }: { rows: Row[]; fmt?: NumberFormat }) {
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" } | null>(null);
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const out = [...rows].sort((a, b) => compareValues(a[sort.col], b[sort.col]));
    return sort.dir === "desc" ? out.reverse() : out;
  }, [rows, sort]);
  if (!rows.length) return <div className="widget__state">No data</div>;
  const numeric = cols.filter((c) => rows.some((r) => typeof r[c] === "number"));
  // Click cycle: first click sorts the natural way (numbers high to low, text A to Z), second flips, third clears.
  const toggle = (c: string) =>
    setSort((s) => {
      const first: "asc" | "desc" = numeric.includes(c) ? "desc" : "asc";
      if (s?.col !== c) return { col: c, dir: first };
      if (s.dir === first) return { col: c, dir: first === "asc" ? "desc" : "asc" };
      return null;
    });
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            {cols.map((c) => {
              const active = sort?.col === c;
              return (
                <th key={c} className={`${numeric.includes(c) ? "num" : ""} tbl__sortable ${active ? "is-sorted" : ""}`} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                  <button type="button" className="tbl__sort" onClick={() => toggle(c)} title={`Sort by ${prettyKey(c)}`}>
                    {prettyKey(c)}
                    <span className="tbl__arrow" aria-hidden="true">{active ? (sort.dir === "asc" ? "▲" : "▼") : "⇅"}</span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => {
                const v = r[c];
                return (
                  <td key={c} className={numeric.includes(c) ? "num" : ""} title={typeof v === "string" && v.length > 24 ? v : undefined}>
                    {cellContent(r, c, fmt)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Comparison mode: two periods in one element                           */
/* ------------------------------------------------------------------ */

export interface PeriodLabels {
  current: string;
  compare: string;
}

/** Opacity of the comparison period's bars (same hue as the current period). */
const CMP_OPACITY = 0.45;

function signedNumber(n: number, fmt: NumberFormat): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "±";
  return `${sign}${formatNumber(Math.abs(n), fmt)}`;
}
function signedPct(p: number): string {
  const v = Math.abs(p * 100);
  const sign = p > 0 ? "+" : p < 0 ? "−" : "±";
  return `${sign}${v.toFixed(v < 10 ? 1 : 0)}%`;
}
function deltaClass(n: number | null): string {
  if (n === null || Math.abs(n) < 1e-9) return "";
  return n > 0 ? "is-up" : "is-down";
}

interface LegendItem { label: string; color: string; kind: "bar" | "bar-faded" | "line" | "line-dashed" }
function CompareLegend({ items, note }: { items: LegendItem[]; note?: string }) {
  return (
    <div className="chart__legend chart__legend--compare" aria-label="Legend">
      {items.map((it, i) => (
        <span key={`${i}:${it.kind}:${it.label}`}>
          {it.kind === "line-dashed" ? (
            <i className="line line--dashed" style={{ borderTopColor: it.color }} />
          ) : (
            <i className={it.kind === "line" ? "line" : ""} style={{ background: it.color, opacity: it.kind === "bar-faded" ? CMP_OPACITY : 1 }} />
          )}{" "}
          {it.label}
        </span>
      ))}
      {note && <span className="chart__legend-note">{note}</span>}
    </div>
  );
}

interface CompareTipProps {
  active?: boolean;
  label?: unknown;
  payload?: Array<{ payload?: Row }>;
  series: string[];
  colors: Record<string, string>;
  fmt: NumberFormat;
  labels: PeriodLabels;
  title: (row: Row, label: unknown) => string;
}
function CompareTip({ active, label, payload, series, colors, fmt, labels, title }: CompareTipProps) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const shown = series.filter((s) => row[s] !== null || row[cmpKey(s)] !== null);
  return (
    <div className="tip tip--compare">
      <div className="tip__title">{title(row, label)}</div>
      <div className="tip__grid">
        <span />
        <span className="tip__colhead">{labels.current}</span>
        <span className="tip__colhead">{labels.compare}</span>
        <span className="tip__colhead">Change</span>
        {shown.map((s) => {
          const cur = row[s];
          const prev = row[cmpKey(s)];
          const d = delta(cur, prev);
          return (
            <Fragment key={s}>
              <span className="tip__name"><i className="tip__key" style={{ background: colors[s] }} />{prettyKey(s)}</span>
              <b>{formatNumber(cur, fmt)}</b>
              <span>{formatNumber(prev, fmt)}</span>
              <span className={`tip__delta ${deltaClass(d.abs)}`}>
                {d.abs === null ? "–" : `${signedNumber(d.abs, fmt)}${d.pct !== null ? ` (${signedPct(d.pct)})` : ""}`}
              </span>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Bars for two periods. Single and multi-series: grouped, the comparison in the same hue at
 * reduced opacity. Stacked: two stacks per category (current, then comparison).
 */
export function CompareBarChart({ rows, compareRows, spec, stacked, labels }: { rows: Row[]; compareRows: Row[]; spec: WidgetSpec; stacked?: boolean; labels: PeriodLabels }) {
  const shaped = useMemo(() => shapeCompare(rows, compareRows, spec), [rows, compareRows, spec]);
  const fmt = (spec.format ?? (spec.normalize ? "percent" : "compact")) as NumberFormat;
  const horizontal = !!spec.horizontal;
  const tickFmt = (v: unknown) => formatNumber(v, fmt);
  const { data, xKey, series, colors } = shaped;
  if (!data.length) return <div className="widget__state">No data</div>;
  const catWidth = Math.min(150, Math.max(60, Math.max(...data.map((d) => String(d[xKey]).length)) * 6.5));
  const perCategory = !stacked && series.length === 1 && !!spec.colorBy && spec.colorBy !== "auto";
  const single = series.length === 1;
  const swatch = perCategory ? "#5b6478" : colors[series[0]];
  const legend = single
    ? <CompareLegend items={[{ label: labels.current, color: swatch, kind: "bar" }, { label: labels.compare, color: swatch, kind: "bar-faded" }]} />
    : <CompareLegend items={series.map((s) => ({ label: prettyKey(s), color: colors[s], kind: "bar" as const }))} note={`Solid: ${labels.current} · faded: ${labels.compare}`} />;
  const endRadius: [number, number, number, number] = horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0];
  const bars = (period: "cur" | "cmp") =>
    series.map((s, i) => {
      const last = i === series.length - 1;
      const key = period === "cur" ? s : cmpKey(s);
      const opacity = period === "cur" ? 1 : CMP_OPACITY;
      return (
        <Bar
          key={key}
          dataKey={key}
          name={key}
          stackId={stacked ? period : undefined}
          fill={colors[s]}
          fillOpacity={opacity}
          maxBarSize={stacked ? 22 : 18}
          radius={stacked ? (last ? endRadius : [0, 0, 0, 0]) : endRadius}
          stroke={stacked ? "#fff" : undefined}
          strokeWidth={stacked ? 1.5 : 0}
          isAnimationActive={false}
        >
          {perCategory && data.map((d, j) => <Cell key={j} fill={seriesColor(String(d[xKey]), j, spec.colorBy)} fillOpacity={opacity} />)}
        </Bar>
      );
    });
  // Grouped: current and comparison next to each other per series; stacked: one stack per period.
  const curBars = bars("cur");
  const cmpBars = bars("cmp");
  const ordered = stacked ? [...curBars, ...cmpBars] : curBars.flatMap((b, i) => [b, cmpBars[i]]);
  return (
    <>
      {legend}
      <div className="chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 6, right: 12, left: 0, bottom: 0 }} barCategoryGap="22%" barGap={2}>
            <CartesianGrid stroke={GRID} vertical={horizontal} horizontal={!horizontal} />
            {horizontal ? (
              <>
                <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={tickFmt} domain={spec.normalize ? [0, 1] : undefined} />
                <YAxis type="category" dataKey={xKey} tick={AXIS_TICK} axisLine={false} tickLine={false} width={catWidth} interval={0} />
              </>
            ) : (
              <>
                {data.length <= 12 ? (
                  <XAxis dataKey={xKey} tick={<WrappedTick />} axisLine={false} tickLine={false} interval={0} height={34} />
                ) : (
                  <XAxis dataKey={xKey} tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={16} tickFormatter={tickLabel} />
                )}
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={tickFmt} width={48} domain={spec.normalize ? [0, 1] : undefined} />
              </>
            )}
            <Tooltip
              content={<CompareTip series={series} colors={colors} fmt={fmt} labels={labels} title={(_r, l) => tickLabel(l)} />}
              cursor={{ fill: "rgba(113,50,245,0.06)" }}
            />
            {ordered}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

/** Lines for two periods overlaid; the comparison is dashed and desaturated. */
export function CompareLineChart({ rows, compareRows, spec, labels, starts }: { rows: Row[]; compareRows: Row[]; spec: WidgetSpec; labels: PeriodLabels; starts?: { current?: string; compare?: string } }) {
  const shaped = useMemo(() => overlayCompare(rows, compareRows, spec, starts), [rows, compareRows, spec, starts]);
  const fmt = (spec.format ?? "compact") as NumberFormat;
  const { data, xKey, series, colors, grain } = shaped;
  if (!data.length) return <div className="widget__state">No data</div>;
  const single = series.length === 1;
  // Up to three series: one legend entry per series and period. More: series once, periods in a note.
  const compactLegend = series.length > 3;
  const items: LegendItem[] = compactLegend
    ? series.map((s) => ({ label: prettyKey(s), color: colors[s], kind: "line" as const }))
    : series.flatMap((s) => [
    { label: single ? labels.current : `${prettyKey(s)} (${labels.current})`, color: colors[s], kind: "line" as const },
    { label: single ? labels.compare : `${prettyKey(s)} (${labels.compare})`, color: desaturate(colors[s]), kind: "line-dashed" as const },
  ]);
  const title = (row: Row, l: unknown) =>
    grain
      ? `${String(row.__idx)} · ${row[X_CUR] ? tickLabel(row[X_CUR]) : "–"} vs ${row[X_CMP] ? tickLabel(row[X_CMP]) : "–"}`
      : tickLabel(l);
  const dot = data.length <= 2 ? { r: 3 } : false;
  return (
    <>
      <CompareLegend
        items={items}
        note={[compactLegend ? `Solid: ${labels.current} · dashed: ${labels.compare}` : "", grain ? `x axis: ${grain} of each period` : ""].filter(Boolean).join(" · ") || undefined}
      />
      <div className="chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey={xKey} tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={20} tickFormatter={grain ? undefined : tickLabel} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v) => formatNumber(v, fmt)} width={48} />
            <Tooltip content={<CompareTip series={series} colors={colors} fmt={fmt} labels={labels} title={title} />} cursor={{ stroke: "#cfd5e0", strokeWidth: 1 }} />
            {series.map((s) => (
              <Line key={s} type="monotone" dataKey={s} stroke={colors[s]} strokeWidth={2} dot={dot} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} isAnimationActive={false} connectNulls />
            ))}
            {series.map((s) => (
              <Line
                key={cmpKey(s)}
                type="monotone"
                dataKey={cmpKey(s)}
                stroke={desaturate(colors[s])}
                strokeWidth={1.75}
                strokeDasharray="5 4"
                dot={dot}
                activeDot={{ r: 3, strokeWidth: 2, stroke: "#fff" }}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

/**
 * Table for two periods: rows joined on the first text column, with Δ and Δ% after every
 * numeric column. Rows only in the current period are marked new; rows only in the comparison
 * are appended greyed and marked gone.
 */
export function CompareTable({ rows, compareRows, fmt, labels }: { rows: Row[]; compareRows: Row[]; fmt?: NumberFormat; labels: PeriodLabels }) {
  const data = useMemo(() => compareTable(rows, compareRows), [rows, compareRows]);
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" } | null>(null);
  const sorted = useMemo(() => {
    if (!sort) return data.rows;
    const value = (r: CompareTableRow): unknown => {
      const [c, part] = sort.col.split("::");
      if (part === "abs") return r.deltas[c]?.abs;
      if (part === "pct") return r.deltas[c]?.pct;
      return r.row[c];
    };
    const present = data.rows.filter((r) => r.status !== "gone");
    const gone = data.rows.filter((r) => r.status === "gone");
    const by = (list: CompareTableRow[]) => {
      const out = [...list].sort((a, b) => compareValues(value(a), value(b)));
      return sort.dir === "desc" ? out.reverse() : out;
    };
    return [...by(present), ...by(gone)];
  }, [data, sort]);
  if (!data.rows.length) return <div className="widget__state">No data</div>;
  const { columns, numeric, keyColumns } = data;
  const keyCol = keyColumns[0];
  const isNum = (id: string) => id.includes("::") || numeric.includes(id);
  const toggle = (id: string) =>
    setSort((s) => {
      const first: "asc" | "desc" = isNum(id) ? "desc" : "asc";
      if (s?.col !== id) return { col: id, dir: first };
      if (s.dir === first) return { col: id, dir: first === "asc" ? "desc" : "asc" };
      return null;
    });
  const head = (id: string, text: string, title: string, extra = "") => {
    const active = sort?.col === id;
    return (
      <th key={id} className={`${isNum(id) ? "num" : ""} tbl__sortable ${active ? "is-sorted" : ""} ${extra}`} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" className="tbl__sort" onClick={() => toggle(id)} title={title}>
          {text}
          <span className="tbl__arrow" aria-hidden="true">{active ? (sort.dir === "asc" ? "▲" : "▼") : "⇅"}</span>
        </button>
      </th>
    );
  };
  const numFmt = (v: number) => fmt ?? (Number.isInteger(v) ? "number" : "decimal");
  const vs = `${labels.current} vs ${labels.compare}`;
  return (
    <>
      <div className="cmp-caption">
        {vs}
        {numeric[0] && !sort ? ` · sorted by the largest change in ${prettyKey(numeric[0]).toLowerCase()}` : ""}
      </div>
      <div className="tbl-wrap">
        <table className="tbl tbl--compare">
          <thead>
            <tr>
              {columns.flatMap((c) =>
                numeric.includes(c)
                  ? [
                      head(c, prettyKey(c), `Sort by ${prettyKey(c)} (${labels.current})`),
                      head(`${c}::abs`, "Δ", `Change in ${prettyKey(c)}, ${vs}`, "tbl__dhead"),
                      head(`${c}::pct`, "Δ%", `Relative change in ${prettyKey(c)}, ${vs}`, "tbl__dhead"),
                    ]
                  : [head(c, prettyKey(c), `Sort by ${prettyKey(c)}`)],
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={`${r.status}:${r.key}`} className={r.status === "gone" ? "tbl__row--gone" : r.status === "new" ? "tbl__row--new" : ""}>
                {columns.flatMap((c) => {
                  const v = r.row[c];
                  if (!numeric.includes(c)) {
                    return [
                      <td key={c} title={typeof v === "string" && v.length > 24 ? v : undefined}>
                        {cellContent(r.row, c, fmt)}
                        {c === keyCol && r.status !== "both" && (
                          <span className={`tbl__status tbl__status--${r.status}`} title={r.status === "new" ? `Not in ${labels.compare}` : `Only in ${labels.compare}`}>{r.status}</span>
                        )}
                      </td>,
                    ];
                  }
                  const d = r.deltas[c];
                  const prevTitle = d.prev !== null ? `${labels.compare}: ${formatNumber(d.prev, numFmt(d.prev))}` : `Not in ${labels.compare}`;
                  return [
                    <td key={c} className="num" title={r.status === "gone" ? `${labels.compare} value` : prevTitle}>{cellContent(r.row, c, fmt)}</td>,
                    <td key={`${c}::abs`} className={`num tbl__delta ${deltaClass(d.abs)}`} title={prevTitle}>
                      {d.abs === null ? "–" : signedNumber(d.abs, numFmt(d.abs))}
                    </td>,
                    <td key={`${c}::pct`} className={`num tbl__delta ${deltaClass(d.pct)}`}>
                      {d.pct === null ? "–" : signedPct(d.pct)}
                    </td>,
                  ];
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
