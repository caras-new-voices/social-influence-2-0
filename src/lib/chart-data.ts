import { colorForSeries, getBrands } from "./brands";
import { isNumericColumn } from "./format";
import type { WidgetSpec } from "./widgets";

export type Row = Record<string, unknown>;

export interface ShapedData {
  data: Row[];
  xKey: string;
  series: string[];
  colors: Record<string, string>;
}

const TIER_ORDER = ["nano", "micro", "mid", "macro", "mega"];
const SENTIMENT_ORDER = ["positive", "neutral", "negative"];
/** Ordinal ramp for creator tiers: one hue, light to dark. */
const TIER_COLORS: Record<string, string> = { nano: "#cbbcff", micro: "#a98cff", mid: "#8a5cff", macro: "#7132f5", mega: "#4a1bb8" };

function orderSeries(names: string[], colorBy?: string): string[] {
  if (colorBy === "brand") {
    const order = getBrands().map((b) => b.name);
    const rank = (n: string) => (order.indexOf(n) === -1 ? 99 : order.indexOf(n));
    return [...names].sort((a, b) => rank(a) - rank(b));
  }
  if (colorBy === "tier") return [...names].sort((a, b) => TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b));
  if (colorBy === "sentiment") return [...names].sort((a, b) => SENTIMENT_ORDER.indexOf(a) - SENTIMENT_ORDER.indexOf(b));
  return names;
}

export function seriesColor(name: string, index: number, colorBy?: string): string {
  if (colorBy === "tier" && TIER_COLORS[name]) return TIER_COLORS[name];
  return colorForSeries(name, index, colorBy);
}

/** Turns query rows into recharts-ready wide data with an ordered series list. */
export function shapeRows(rows: Row[], spec: Pick<WidgetSpec, "x" | "y" | "series" | "colorBy" | "normalize">): ShapedData {
  if (!rows.length) return { data: [], xKey: spec.x ?? "x", series: [], colors: {} };
  const keys = Object.keys(rows[0]);
  const xKey = spec.x && keys.includes(spec.x) ? spec.x : (keys.find((k) => !isNumericColumn(rows, k)) ?? keys[0]);
  const yKey =
    spec.y && keys.includes(spec.y)
      ? spec.y
      : keys.includes("value")
        ? "value"
        : (keys.find((k) => k !== xKey && isNumericColumn(rows, k)) ?? keys[1]);
  let data: Row[] = [];
  let series: string[] = [];

  if (spec.series && keys.includes(spec.series)) {
    const sKey = spec.series;
    const byX = new Map<string, Row>();
    const seen: string[] = [];
    for (const r of rows) {
      const x = String(r[xKey] ?? "");
      const s = String(r[sKey] ?? "");
      if (!seen.includes(s)) seen.push(s);
      if (!byX.has(x)) byX.set(x, { [xKey]: x });
      const row = byX.get(x)!;
      row[s] = Number(row[s] ?? 0) + Number(r[yKey] ?? 0);
    }
    series = orderSeries(seen, spec.colorBy);
    data = [...byX.values()];
  } else {
    const numeric = keys.filter((k) => k !== xKey && isNumericColumn(rows, k));
    series = spec.y && numeric.includes(spec.y) && numeric.length > 1 ? [spec.y] : numeric;
    if (!series.length) series = [yKey];
    data = rows.map((r) => ({ ...r, [xKey]: String(r[xKey] ?? "") }));
  }

  if (spec.normalize) {
    data = data.map((r) => {
      const total = series.reduce((s, k) => s + Number(r[k] ?? 0), 0) || 1;
      const out: Row = { ...r };
      for (const k of series) out[k] = Number(r[k] ?? 0) / total;
      return out;
    });
  }
  const colors: Record<string, string> = {};
  series.forEach((s, i) => (colors[s] = seriesColor(s, i, spec.colorBy)));
  return { data, xKey, series, colors };
}

/* ------------------------------------------------------------------ */
/* Comparison (two result sets for two periods)                          */
/* ------------------------------------------------------------------ */

/** Suffix for the comparison-period copy of a series key in merged chart data. */
export const CMP_SUFFIX = "__cmp";
export function cmpKey(series: string): string {
  return `${series}${CMP_SUFFIX}`;
}

export interface AlignedCategory {
  x: string;
  cur?: Row;
  cmp?: Row;
}

/**
 * Joins the current and comparison rows on `xKey`. Categories keep the current order; categories
 * found only in the comparison are appended at the end. The first row wins on duplicate keys.
 */
export function alignCompare(rows: Row[], compareRows: Row[], xKey: string): AlignedCategory[] {
  const out: AlignedCategory[] = [];
  const idx = new Map<string, number>();
  for (const r of rows) {
    const x = String(r[xKey] ?? "");
    if (idx.has(x)) continue;
    idx.set(x, out.length);
    out.push({ x, cur: r });
  }
  for (const r of compareRows) {
    const x = String(r[xKey] ?? "");
    const i = idx.get(x);
    if (i === undefined) {
      idx.set(x, out.length);
      out.push({ x, cmp: r });
    } else if (!out[i].cmp) out[i].cmp = r;
  }
  return out;
}

function unionSeries(a: ShapedData, b: ShapedData, colorBy?: string): { series: string[]; colors: Record<string, string> } {
  const series = [...a.series, ...b.series.filter((s) => !a.series.includes(s))];
  const colors: Record<string, string> = {};
  series.forEach((s, i) => (colors[s] = a.colors[s] ?? seriesColor(s, i, colorBy)));
  return { series, colors };
}

/** Rewrites rows shaped with another x key so both periods share one. */
function rekey(data: Row[], from: string, to: string): Row[] {
  return from === to ? data : data.map((r) => ({ ...r, [to]: r[from] }));
}

/**
 * Wide chart data for both periods on a shared category axis: every series `s` carries the
 * current value under `s` and the comparison value under `cmpKey(s)`. Each period is shaped
 * (and normalised, for 100 percent stacks) on its own.
 */
export function shapeCompare(rows: Row[], compareRows: Row[], spec: Pick<WidgetSpec, "x" | "y" | "series" | "colorBy" | "normalize">): ShapedData {
  const a = shapeRows(rows, spec);
  const b = shapeRows(compareRows, spec);
  const xKey = a.data.length ? a.xKey : b.xKey;
  const { series, colors } = unionSeries(a, b, spec.colorBy);
  const data = alignCompare(rekey(a.data, a.xKey, xKey), rekey(b.data, b.xKey, xKey), xKey).map(({ x, cur, cmp }) => {
    const row: Row = { [xKey]: x };
    for (const s of series) {
      row[s] = cur?.[s] ?? null;
      row[cmpKey(s)] = cmp?.[s] ?? null;
    }
    return row;
  });
  return { data, xKey, series, colors };
}

export type TimeGrain = "month" | "day";

/** "month" when every value looks like YYYY-MM, "day" when every value starts with YYYY-MM-DD, else null. */
export function detectTimeGrain(values: unknown[]): TimeGrain | null {
  const vals = values.filter((v) => v !== null && v !== undefined && v !== "").map(String);
  if (!vals.length) return null;
  if (vals.every((v) => /^\d{4}-\d{2}$/.test(v))) return "month";
  if (vals.every((v) => /^\d{4}-\d{2}-\d{2}/.test(v))) return "day";
  return null;
}

function monthOrdinal(v: string): number {
  return Number(v.slice(0, 4)) * 12 + Number(v.slice(5, 7)) - 1;
}
function dayOrdinal(v: string): number {
  return Math.round(Date.parse(`${v.slice(0, 10)}T00:00:00Z`) / 86_400_000);
}

/**
 * 1-based position of each time value inside its period. With the period's start date the
 * position is the calendar offset (so gaps stay gaps); without it, the rank among the values.
 */
export function timelineIndex(values: string[], grain: TimeGrain, start?: string): Map<string, number> {
  const distinct = [...new Set(values)].sort();
  const ord = grain === "month" ? monthOrdinal : dayOrdinal;
  const out = new Map<string, number>();
  if (start) {
    const base = ord(start);
    const ok = distinct.every((v) => ord(v) - base >= 0);
    if (ok) {
      for (const v of distinct) out.set(v, ord(v) - base + 1);
      return out;
    }
  }
  distinct.forEach((v, i) => out.set(v, i + 1));
  return out;
}

export interface OverlayData extends ShapedData {
  /** Set when x was a month or a date and both periods were put on a 1..N index. */
  grain: TimeGrain | null;
}
/** Key of the x value of the current period in overlay rows (comparison: X_CMP). */
export const X_CUR = "__x";
export const X_CMP = "__xc";

/**
 * Line overlay: when x is a month or a date, both periods are re-indexed to 1..N ("M1", "Day 1")
 * so they sit on top of each other; otherwise the categories are aligned as for bars.
 */
export function overlayCompare(
  rows: Row[],
  compareRows: Row[],
  spec: Pick<WidgetSpec, "x" | "y" | "series" | "colorBy" | "normalize">,
  starts: { current?: string; compare?: string } = {},
): OverlayData {
  const a = shapeRows(rows, spec);
  const b = shapeRows(compareRows, spec);
  const xa = a.data.map((r) => r[a.xKey]);
  const xb = b.data.map((r) => r[b.xKey]);
  const grain = detectTimeGrain([...xa, ...xb]);
  if (!grain) return { ...shapeCompare(rows, compareRows, spec), grain: null };
  const { series, colors } = unionSeries(a, b, spec.colorBy);
  const ia = timelineIndex(xa.map(String), grain, starts.current);
  const ib = timelineIndex(xb.map(String), grain, starts.compare);
  const byIdx = new Map<number, Row>();
  const label = (i: number) => (grain === "month" ? `M${i}` : `Day ${i}`);
  const slot = (i: number) => {
    if (!byIdx.has(i)) {
      const row: Row = { __idx: label(i) };
      for (const s of series) { row[s] = null; row[cmpKey(s)] = null; }
      byIdx.set(i, row);
    }
    return byIdx.get(i)!;
  };
  for (const r of a.data) {
    const row = slot(ia.get(String(r[a.xKey]))!);
    row[X_CUR] = r[a.xKey];
    for (const s of a.series) row[s] = r[s] ?? null;
  }
  for (const r of b.data) {
    const row = slot(ib.get(String(r[b.xKey]))!);
    row[X_CMP] = r[b.xKey];
    for (const s of b.series) row[cmpKey(s)] = r[s] ?? null;
  }
  const data = [...byIdx.entries()].sort((p, q) => p[0] - q[0]).map(([, r]) => r);
  return { data, xKey: "__idx", series, colors, grain };
}

/** Change from `prev` to `cur`: absolute and relative (null when not computable). */
export function delta(cur: unknown, prev: unknown): { abs: number | null; pct: number | null } {
  if (typeof cur !== "number" || typeof prev !== "number" || !Number.isFinite(cur) || !Number.isFinite(prev)) return { abs: null, pct: null };
  return { abs: cur - prev, pct: prev !== 0 ? (cur - prev) / Math.abs(prev) : null };
}

function firstNumber(r: Row): number | undefined {
  const v = r.value ?? Object.values(r).find((x) => typeof x === "number");
  return typeof v === "number" ? v : undefined;
}

/**
 * KPI tiles: fills `compare` from the comparison row with the same label (by position when the
 * rows have no label). Rows that already carry their own non-zero `compare` keep it. Filled rows are
 * marked with `__cmpFilled` so the tile can say which period the delta is against.
 */
export function kpiWithCompare(rows: Row[], compareRows: Row[]): Row[] {
  const byLabel = new Map<string, Row>();
  for (const r of compareRows) if (r.label !== undefined && r.label !== null && !byLabel.has(String(r.label))) byLabel.set(String(r.label), r);
  return rows.map((r, i) => {
    // A zero or missing own compare draws no delta, so the period comparison takes its place.
    if (typeof r.compare === "number" && r.compare !== 0) return r;
    const c = r.label !== undefined && r.label !== null ? byLabel.get(String(r.label)) : compareRows[i];
    const v = c ? firstNumber(c) : undefined;
    return v === undefined ? r : { ...r, compare: v, __cmpFilled: true };
  });
}

export type CompareStatus = "both" | "new" | "gone";
export interface DeltaCell {
  prev: number | null;
  abs: number | null;
  pct: number | null;
}
export interface CompareTableRow {
  key: string;
  status: CompareStatus;
  /** The current row, or the comparison row when the key is gone. */
  row: Row;
  deltas: Record<string, DeltaCell>;
}
export interface CompareTableData {
  columns: string[];
  numeric: string[];
  keyColumns: string[];
  rows: CompareTableRow[];
}

/**
 * Joins two result sets for a table. The join key is the first text column, extended with the
 * following text columns when needed to make it unique. Every numeric column gets a delta.
 * Order: rows present now, by the largest absolute change of the first numeric column (rows
 * without a change last), then rows only in the comparison.
 */
export function compareTable(rows: Row[], compareRows: Row[]): CompareTableData {
  const columns: string[] = [];
  for (const r of [...rows.slice(0, 1), ...compareRows.slice(0, 1)]) for (const k of Object.keys(r)) if (!columns.includes(k)) columns.push(k);
  const isNum = (c: string) => isNumericColumn(rows, c) || (!rows.some((r) => r[c] !== null && r[c] !== undefined) && isNumericColumn(compareRows, c));
  const text = columns.filter((c) => !isNum(c));
  const keyCols: string[] = text.length ? [text[0]] : columns.slice(0, 1);
  const keyOf = (r: Row, cols: string[]) => cols.map((c) => String(r[c] ?? "")).join(" | ");
  const unique = (cols: string[]) => [rows, compareRows].every((set) => new Set(set.map((r) => keyOf(r, cols))).size === set.length);
  for (const c of text.slice(1)) {
    if (unique(keyCols)) break;
    keyCols.push(c);
  }
  const numeric = columns.filter((c) => isNum(c) && !keyCols.includes(c));
  // Still duplicated keys: pair them up by occurrence.
  const keyed = (set: Row[]) => {
    const seen = new Map<string, number>();
    return set.map((r) => {
      const k = keyOf(r, keyCols);
      const n = (seen.get(k) ?? 0) + 1;
      seen.set(k, n);
      return { key: n > 1 ? `${k} #${n}` : k, row: r };
    });
  };
  const prevByKey = new Map(keyed(compareRows).map((e) => [e.key, e.row]));
  const curKeys = new Set<string>();
  const present: CompareTableRow[] = keyed(rows).map(({ key, row }) => {
    curKeys.add(key);
    const prev = prevByKey.get(key);
    const deltas: Record<string, DeltaCell> = {};
    for (const c of numeric) {
      const p = prev && typeof prev[c] === "number" ? (prev[c] as number) : null;
      deltas[c] = { prev: p, ...(prev ? delta(row[c], prev[c]) : { abs: null, pct: null }) };
    }
    return { key, status: prev ? "both" : "new", row, deltas };
  });
  const gone: CompareTableRow[] = keyed(compareRows)
    .filter((e) => !curKeys.has(e.key))
    .map(({ key, row }) => {
      const deltas: Record<string, DeltaCell> = {};
      for (const c of numeric) deltas[c] = { prev: typeof row[c] === "number" ? (row[c] as number) : null, abs: null, pct: null };
      return { key, status: "gone", row, deltas };
    });
  const first = numeric[0];
  if (first) {
    const mag = (r: CompareTableRow) => (r.deltas[first].abs === null ? -1 : Math.abs(r.deltas[first].abs!));
    present.sort((p, q) => mag(q) - mag(p));
    gone.sort((p, q) => Number(q.row[first] ?? 0) - Number(p.row[first] ?? 0));
  }
  return { columns, numeric, keyColumns: keyCols, rows: [...present, ...gone] };
}

/** A muted version of a hex colour (lower saturation, a little lighter) for the comparison period. */
export function desaturate(hex: string, amount = 0.55): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const grey = 0.3 * r + 0.59 * g + 0.11 * b;
  const mix = (c: number) => Math.round(Math.min(255, (c + (grey - c) * amount) * 0.85 + 255 * 0.15));
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * True for SQL that computes its own previous period (reads period_start() or period_end() and
 * the unfiltered posts_all / comments_all tables), such as the "What changed" elements. Those
 * already show a movement, so the dashboard comparison is not drawn on top of them.
 */
export function selfCompares(sql: string | undefined): boolean {
  return !!sql && /\bperiod_(start|end)\s*\(\s*\)/i.test(sql) && /\b(posts_all|comments_all)\b/i.test(sql);
}
