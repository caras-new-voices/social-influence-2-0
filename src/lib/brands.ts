/** Fixed brand context for this proof of concept. Colors are assigned per entity and never re-ordered. */
export type BrandRole = "focal" | "competitor";

export interface Brand {
  segmentId: number;
  name: string;
  role: BrandRole;
  color: string;
  /** Lighter wash of the brand color for backgrounds. */
  wash: string;
}

/**
 * Categorical palette validated with the dataviz validator (light surface #ffffff):
 * worst adjacent CVD ΔE 10.6, normal-vision ΔE 19.8. Venus keeps the IMAI primary purple.
 */
export const BRANDS: Brand[] = [
  { segmentId: 520, name: "Venus", role: "focal", color: "#7132f5", wash: "rgba(113,50,245,0.10)" },
  { segmentId: 474, name: "Estrid", role: "competitor", color: "#eb6834", wash: "rgba(235,104,52,0.10)" },
  { segmentId: 522, name: "Philips OneBlade", role: "competitor", color: "#2a78d6", wash: "rgba(42,120,214,0.10)" },
  { segmentId: 478, name: "Veet", role: "competitor", color: "#c98500", wash: "rgba(201,133,0,0.10)" },
  { segmentId: 523, name: "Wilkinson Sword", role: "competitor", color: "#1baf7a", wash: "rgba(27,175,122,0.10)" },
  { segmentId: 485, name: "Mercadona", role: "competitor", color: "#872450", wash: "rgba(135,36,80,0.10)" },
];

export const FOCAL_BRAND = BRANDS[0];
export const COMPANY = "P&G";
export const CATEGORY = "female hair removal and shaving";

export const BRAND_COLORS: Record<string, string> = Object.fromEntries(BRANDS.map((b) => [b.name, b.color]));

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
  if (colorBy === "brand" && BRAND_COLORS[name]) return BRAND_COLORS[name];
  if (colorBy === "sentiment" && SENTIMENT_COLORS[name]) return SENTIMENT_COLORS[name];
  if (colorBy === "platform" && PLATFORM_COLORS[name]) return PLATFORM_COLORS[name];
  if (BRAND_COLORS[name]) return BRAND_COLORS[name];
  return SERIES_PALETTE[index % SERIES_PALETTE.length];
}
