export type NumberFormat = "number" | "compact" | "percent" | "currency" | "decimal" | "ratio" | "points";
export const NUMBER_FORMATS: NumberFormat[] = ["number", "compact", "percent", "currency", "decimal", "ratio", "points"];

export function formatNumber(v: unknown, fmt: NumberFormat = "number"): string {
  if (v === null || v === undefined || v === "") return "–";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  switch (fmt) {
    case "percent":
      return `${(n * 100).toFixed(Math.abs(n * 100) < 10 ? 1 : 0)}%`;
    case "currency":
      return `$${compact(n)}`;
    case "compact":
      return compact(n);
    case "decimal":
      return n.toLocaleString("en-US", { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2 });
    case "ratio":
      return `${n.toFixed(2)}×`;
    case "points":
      return `${n.toFixed(Math.abs(n) < 10 ? 1 : 0)} pts`;
    default:
      return Math.abs(n) >= 10000 ? compact(n) : n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  }
}

/**
 * What a number measures, so a count is never read as a rate or the other way round.
 * - count: an absolute number (posts, creators, views).
 * - share: a percentage of a whole, 0 to 100 in tables ("share of voice %"), 0 to 1 in KPI tiles.
 * - change: a percent change of a count ("momentum %").
 * - ratio: one number against another, 1.0 meaning equal ("vs norm", "times the usual").
 * - rate: an average or a per-unit figure ("per 1K comments", "per post").
 * - points: a difference between two shares or scores, in points ("vs our average pts").
 * - money: a currency amount.
 */
export type MeasureKind = "count" | "share" | "change" | "points" | "ratio" | "rate" | "money";

export const KIND_LABEL: Record<MeasureKind, string> = {
  count: "Count",
  share: "Share",
  change: "Change",
  points: "Difference",
  ratio: "Ratio",
  rate: "Rate",
  money: "Amount",
};

const KIND_HELP: Record<MeasureKind, string> = {
  count: "an absolute number",
  share: "a percentage of a whole",
  change: "a percent change against the period before",
  points: "a difference between two shares or scores, in points",
  ratio: "one number against another; 1.0 means equal",
  rate: "an average or a per-unit figure, not a total",
  money: "a currency amount",
};

/** A short sentence for a tooltip: "Share: a percentage of a whole." */
export function kindHelp(kind: MeasureKind): string {
  return `${KIND_LABEL[kind]}: ${KIND_HELP[kind]}.`;
}

const PCT = /%|\bpct\b|percent/;

/** The kind of a table column, from its name. Template and analyst columns follow these naming rules. */
export function columnKind(name: string): MeasureKind {
  const n = name.toLowerCase().replace(/_/g, " ");
  if (PCT.test(n)) return /momentum|change|growth/.test(n) ? "change" : "share";
  if (/\bpts\b|\bpoints\b/.test(n)) return "points";
  if (/vs norm|\btimes\b|\bratio\b|multiple/.test(n)) return "ratio";
  if (/\bfee\b|\bcost\b|\bemv\b|budget|spend|\$/.test(n)) return "money";
  if (/\bper\b|\brate\b|average|\bavg\b|\bmedian\b|\bscore\b|net sentiment/.test(n)) return "rate";
  return "count";
}

/** The kind of a KPI tile, from its format and label. */
export function kpiKind(label: string, fmt: NumberFormat): MeasureKind {
  const l = label.toLowerCase();
  if (fmt === "percent") return /momentum|change|growth/.test(l) ? "change" : "share";
  if (fmt === "points") return "points";
  if (fmt === "ratio") return "ratio";
  if (fmt === "currency") return "money";
  if (fmt === "decimal") return columnKind(l) === "ratio" ? "ratio" : "rate";
  return columnKind(l);
}

/** A table cell in its unit: shares as "30.7%", changes as "+12%", ratios as "1.62×". */
export function formatByKind(v: number, kind: MeasureKind): string {
  switch (kind) {
    case "share":
      return `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
    case "change":
      return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
    case "points":
      return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 1 })} pts`;
    case "ratio":
      return `${v.toFixed(2)}×`;
    case "money":
      return `$${compact(v)}`;
    default:
      return formatNumber(v, Number.isInteger(v) ? "number" : "decimal");
  }
}

/**
 * The change between two values of a measure, said the way that measure is read: counts and
 * money as a percent ("+12%"), shares as percentage points ("+4.2 pts"), ratios and rates in
 * their own unit ("+0.12×", "+1.3"). `fractions` is true when shares are 0 to 1 (KPI tiles).
 */
export function describeChange(cur: number, prev: number, kind: MeasureKind, fractions = false): string | null {
  const sign = (d: number) => (d > 0 ? "+" : d < 0 ? "−" : "±");
  if (kind === "count" || kind === "money") {
    if (prev === 0) return null;
    const p = ((cur - prev) / Math.abs(prev)) * 100;
    return `${sign(p)}${Math.abs(p).toFixed(Math.abs(p) < 10 ? 1 : 0)}%`;
  }
  const d = (cur - prev) * (fractions && (kind === "share" || kind === "change") ? 100 : 1);
  const abs = Math.abs(d);
  if (kind === "share" || kind === "change" || kind === "points") return `${sign(d)}${abs.toFixed(abs < 10 ? 1 : 0)} pts`;
  if (kind === "ratio") return `${sign(d)}${abs.toFixed(2)}×`;
  return `${sign(d)}${abs.toLocaleString("en-US", { maximumFractionDigits: abs < 10 ? 2 : 1 })}`;
}

export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${trim(n / 1e9)}B`;
  if (abs >= 1e6) return `${trim(n / 1e6)}M`;
  if (abs >= 1e4) return `${trim(n / 1e3)}K`;
  if (abs >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toLocaleString("en-US", { maximumFractionDigits: abs < 10 ? 1 : 0 });
}

function trim(x: number): string {
  return x >= 100 ? x.toFixed(0) : x.toFixed(1).replace(/\.0$/, "");
}

export function prettyKey(k: string): string {
  return k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function isNumericColumn(rows: Record<string, unknown>[], key: string): boolean {
  let seen = 0;
  for (const r of rows) {
    const v = r[key];
    if (v === null || v === undefined) continue;
    seen++;
    if (typeof v !== "number") return false;
    if (seen > 20) break;
  }
  return seen > 0;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Serialises rows to CSV with raw values (no display formatting). */
export function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = Array.isArray(v) ? v.join("; ") : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}

const SPECIAL_LANGUAGES: Record<string, string> = {
  und: "Undetermined (could not be detected)",
  unknown: "Unknown (not detected)",
  null: "Not recorded",
};

/** Full language name for an ISO 639-1 code, e.g. "de" -> "German". */
export function languageName(code: string | null | undefined): string {
  const c = (code ?? "null").toLowerCase();
  if (SPECIAL_LANGUAGES[c]) return SPECIAL_LANGUAGES[c];
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(c);
    return name && name !== c ? `${name} (${c})` : c;
  } catch {
    return c;
  }
}

const ALLOWED_TAGS = new Set(["h3", "h4", "p", "ul", "ol", "li", "strong", "em", "b", "i", "br", "span"]);

/** Minimal HTML sanitizer for the precomputed insight fragments: allow-listed tags, no attributes. */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*\/?\s*([a-zA-Z0-9]+)[^>]*>/g, (m, tag: string) => {
      const t = tag.toLowerCase();
      if (!ALLOWED_TAGS.has(t)) return "";
      const closing = /^<\s*\//.test(m);
      return closing ? `</${t}>` : `<${t}>`;
    });
}
