import { BRANDS, colorForSeries } from "./brands";
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
    const order = BRANDS.map((b) => b.name);
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
