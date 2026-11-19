import { z } from "zod";

/**
 * A dashboard's brand scope: the industry it looks at, which brand is "us" and which of the
 * industry's other brands are the competitors. Brands left out are invisible to the dashboard.
 */
/** Who the brand wants to reach. Any part may be left out; creators are matched on the parts that are set. */
export const TargetAudienceSchema = z.object({
  gender: z.enum(["women", "men"]).nullable().optional(),
  ages: z.array(z.string().min(1).max(12)).max(8).optional(),
  markets: z.array(z.string().min(1).max(80)).max(12).optional(),
});
export type TargetAudience = z.infer<typeof TargetAudienceSchema>;
/** The age bands the creator audience data uses. */
export const AGE_BANDS = ["13-17", "18-24", "25-34", "35-44", "45-64", "65-"];
export const hasTarget = (t: TargetAudience | null | undefined): boolean => !!t && (!!t.gender || !!t.ages?.length || !!t.markets?.length);

export const DashboardScopeSchema = z.object({
  industry: z.string().min(1).max(80),
  focal: z.string().min(1).max(200),
  competitors: z.array(z.string().min(1).max(200)).max(60).default([]),
  /** The audience to match creators against (creator score). */
  target: TargetAudienceSchema.nullable().optional(),
});
export type DashboardScope = z.infer<typeof DashboardScopeSchema>;

/** Every brand the scope lets a query see, focal first. */
export function scopeBrands(scope: DashboardScope): string[] {
  return [scope.focal, ...scope.competitors.filter((c) => c !== scope.focal)];
}

/** A stable string for cache keys and equality checks. */
export function scopeKey(scope: DashboardScope | null | undefined): string {
  if (!scope) return "";
  const t = scope.target;
  const target = hasTarget(t) ? `|${t!.gender ?? ""}/${[...(t!.ages ?? [])].sort().join(",")}/${[...(t!.markets ?? [])].sort().join(",")}` : "";
  return `${scope.industry}|${scope.focal}|${[...scope.competitors].sort().join(",")}${target}`;
}

/** One brand as the catalogue describes it. */
export interface CatalogBrand {
  segmentId: number;
  name: string;
  industry: string;
  description: string | null;
  /** The company that owns the brand, when known. */
  owner: string | null;
  /** "topic", "destination", "team" or null for an ordinary brand. A topic is a market conversation, not a rival. */
  kind: string | null;
  aliases: string[];
  posts: number;
  comments: number;
  /** Posts in the source export for the period, before sampling (exports stop at 20,000). */
  sourcePosts: number | null;
}

export interface CatalogIndustry {
  id: string;
  name: string;
  /** The category in plain words, as given to the analyst. */
  category: string | null;
  region: string | null;
  summary: string | null;
  suggestedFocal: string | null;
  /** True for the industry that receives imports (new months); the others are fixed snapshots. */
  live: boolean;
  brands: CatalogBrand[];
  posts: number;
  comments: number;
  /** Months with posts, oldest first (YYYY-MM). */
  months: string[];
}

/** Statistics the brand picker shows next to each brand. */
export interface BrandDetails extends CatalogBrand {
  creators: number;
  engagement: number;
  views: number;
  paidPosts: number;
  platforms: { instagram: number; tiktok: number; youtube: number };
  medianFollowers: number | null;
  topCountry: string | null;
  firstPost: string | null;
  lastPost: string | null;
}

export interface IndustryDetails extends Omit<CatalogIndustry, "brands"> {
  brands: BrandDetails[];
  creators: number;
  engagement: number;
  platforms: { instagram: number; tiktok: number; youtube: number };
  /** A sentence or two of facts computed from the data. */
  facts: string;
  /** The default selection offered for this industry. */
  defaultScope: DashboardScope;
}
