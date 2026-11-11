export type NumberFormat = "number" | "compact" | "percent" | "currency" | "decimal";

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
      return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    default:
      return Math.abs(n) >= 10000 ? compact(n) : n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  }
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
