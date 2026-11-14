/**
 * Brand context for the workspace. Nothing here names a brand: the tracked brands, which one is
 * "us", the company and the category are loaded from the data (see workspace.ts) into a small
 * registry that server code and client components both read.
 */
export type BrandRole = "focal" | "competitor";

export interface Brand {
  segmentId: number;
  name: string;
  role: BrandRole;
  color: string;
  /** Lighter wash of the brand color for backgrounds. */
  wash: string;
}

export interface Workspace {
  brands: Brand[];
  /** The client company, when known (shown in the shell and given to the analyst). */
  company: string | null;
  /** The category the tracked brands compete in, in plain words. */
  category: string | null;
  /** ILIKE patterns that also mean the focal brand (parent brand, common misspellings). */
  aliases: string[];
}

/**
 * Categorical palette validated with the dataviz validator (light surface #ffffff):
 * worst adjacent CVD ΔE 10.6, normal-vision ΔE 19.8. The focal brand always gets the IMAI primary
 * purple; competitors take the rest in a stable order (most posts first).
 */
export const BRAND_PALETTE = ["#7132f5", "#eb6834", "#2a78d6", "#c98500", "#1baf7a", "#872450", "#595ffc", "#e34948"];

function wash(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0.10)`;
}

/** Orders brands (focal first, then competitors by volume) and assigns their colours. */
export function makeBrands(rows: Array<{ id: number; brand: string; role: string | null; posts: number }>): Brand[] {
  if (!rows.length) return [];
  const focal = rows.find((r) => r.role === "focal") ?? [...rows].sort((a, b) => b.posts - a.posts)[0];
  const rest = rows.filter((r) => r !== focal).sort((a, b) => b.posts - a.posts || a.id - b.id);
  return [focal, ...rest].map((r, i) => {
    const color = BRAND_PALETTE[i % BRAND_PALETTE.length];
    return { segmentId: Number(r.id), name: r.brand, role: r === focal ? "focal" : "competitor", color, wash: wash(color) };
  });
}

const EMPTY: Workspace = { brands: [], company: null, category: null, aliases: [] };
// On globalThis so every server bundle (pages, route handlers) and the browser share one registry.
const g = globalThis as unknown as { __siWorkspace?: Workspace };

export function setWorkspace(ws: Workspace) {
  g.__siWorkspace = ws;
}
export function getWorkspace(): Workspace {
  return g.__siWorkspace ?? EMPTY;
}
export function getBrands(): Brand[] {
  return getWorkspace().brands;
}
/** The focal brand's name ("us"). Falls back to a neutral phrase before the workspace is loaded. */
export function focalName(): string {
  return getBrands().find((b) => b.role === "focal")?.name ?? "our brand";
}
export function competitorNames(): string[] {
  return getBrands().filter((b) => b.role === "competitor").map((b) => b.name);
}
export function brandColor(name: string): string | undefined {
  return getBrands().find((b) => b.name === name)?.color;
}

/** Palette for series that are not brands (platforms, sentiment, tiers...). Same validated order. */
export const SERIES_PALETTE = ["#7132f5", "#eb6834", "#2a78d6", "#c98500", "#1baf7a", "#872450", "#595ffc", "#e34948"];

export const SENTIMENT_COLORS: Record<string, string> = {
  positive: "#1baf7a",
  neutral: "#9ca8be",
  negative: "#e34948",
};

export const PLATFORM_COLORS: Record<string, string> = {
  tiktok: "#2f313c",
  instagram: "#e1306c",
  youtube: "#d03b3b",
};

export function colorForSeries(name: string, index: number, colorBy?: string): string {
  const brand = brandColor(name);
  if (colorBy === "brand" && brand) return brand;
  if (colorBy === "sentiment" && SENTIMENT_COLORS[name]) return SENTIMENT_COLORS[name];
  if (colorBy === "platform" && PLATFORM_COLORS[name]) return PLATFORM_COLORS[name];
  if (brand) return brand;
  return SERIES_PALETTE[index % SERIES_PALETTE.length];
}
