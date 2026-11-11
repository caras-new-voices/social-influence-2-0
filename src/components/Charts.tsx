"use client";
import { useMemo } from "react";
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
import { seriesColor, shapeRows, type Row } from "@/lib/chart-data";
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

export function KpiRow({ rows, spec }: { rows: Row[]; spec: WidgetSpec }) {
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
              <div className={`kpi__delta kpi__delta--${dir}`} title={`Benchmark ${formatNumber(compare, fmt)}`}>
                {dir === "up" ? "▲" : dir === "down" ? "▼" : "•"} {Math.abs(delta * 100).toFixed(0)}% vs benchmark
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function DataTable({ rows, fmt }: { rows: Row[]; fmt?: NumberFormat }) {
  if (!rows.length) return <div className="widget__state">No data</div>;
  const cols = Object.keys(rows[0]);
  const numeric = cols.filter((c) => rows.some((r) => typeof r[c] === "number"));
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>{cols.map((c) => <th key={c} className={numeric.includes(c) ? "num" : ""}>{prettyKey(c)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => {
                const v = r[c];
                const isLink = typeof v === "string" && /^https?:\/\//.test(v);
                const isIsoDate = typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v);
                return (
                  <td key={c} className={numeric.includes(c) ? "num" : ""} title={typeof v === "string" ? v : undefined}>
                    {isLink ? <a href={v} target="_blank" rel="noreferrer">Open ↗</a>
                      : isIsoDate ? v.slice(0, 10)
                      : typeof v === "number" ? formatNumber(v, fmt ?? (Number.isInteger(v) ? "number" : "decimal"))
                      : v === null || v === undefined ? "–"
                      : Array.isArray(v) ? v.join(", ")
                      : typeof v === "object" ? JSON.stringify(v)
                      : String(v)}
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
