import { catalogGeneration, defaultScope, getCatalog } from "./catalog";
import { getDb, type Row } from "./db";
import { formatMonth } from "./period";
import { ensureReady } from "./schema";
import type { BrandDetails, IndustryDetails } from "./scope-shared";

/**
 * The catalogue with the statistics the brand picker shows: per brand, how much there is and
 * where it comes from; per industry, totals and a short factual summary. Computed from the data
 * and cached until the catalogue changes.
 */
const g = globalThis as unknown as { __siCatalogDetails?: { gen: number; value: Promise<IndustryDetails[]> } };

export function getCatalogDetails(): Promise<IndustryDetails[]> {
  const cached = g.__siCatalogDetails;
  if (cached && cached.gen === catalogGeneration()) return cached.value;
  const value = (async () => {
    await ensureReady();
    return compute();
  })();
  value.catch(() => {
    g.__siCatalogDetails = undefined;
  });
  // ensureReady can reload the catalogue (packs still loading), so key the cache after it settles.
  void value.then(() => {
    if (g.__siCatalogDetails?.value === value) g.__siCatalogDetails.gen = catalogGeneration();
  }).catch(() => {});
  g.__siCatalogDetails = { gen: catalogGeneration(), value };
  return value;
}

const num = (v: unknown) => Number(v ?? 0) || 0;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const n = (v: number) => Math.round(v).toLocaleString("en-US");

function ordinal(i: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = i % 100;
  return `${i}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

async function compute(): Promise<IndustryDetails[]> {
  const db = await getDb();
  const stats = await db.query<Row>(`
    SELECT segment_id, count(DISTINCT influencer_id)::int AS creators, coalesce(sum(engagement), 0) AS engagement, coalesce(sum(views), 0) AS views,
           (count(*) FILTER (WHERE is_paid))::int AS paid,
           (count(*) FILTER (WHERE platform = 'instagram'))::int AS instagram, (count(*) FILTER (WHERE platform = 'tiktok'))::int AS tiktok,
           (count(*) FILTER (WHERE platform = 'youtube'))::int AS youtube,
           min(published_at) AS first_post, max(published_at) AS last_post,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY followers) AS median_followers
      FROM posts_raw GROUP BY 1`);
  const countries = await db.query<Row>(`
    SELECT DISTINCT ON (segment_id) segment_id, country FROM (
      SELECT segment_id, country, count(*) AS n FROM posts_raw WHERE country IS NOT NULL AND country <> 'Unknown' GROUP BY 1, 2
    ) c ORDER BY segment_id, n DESC`);
  const creators = await db.query<Row>(`
    SELECT s.industry, count(DISTINCT p.influencer_id)::int AS creators FROM posts_raw p JOIN segments_raw s ON s.id = p.segment_id GROUP BY 1`);
  const bySeg = new Map(stats.map((r) => [num(r.segment_id), r]));
  const countryBySeg = new Map(countries.map((r) => [num(r.segment_id), String(r.country)]));
  const cat = getCatalog();
  const live = cat.industries.find((i) => i.live)?.id;
  const creatorsByInd = new Map(creators.map((r) => [r.industry ? String(r.industry) : live, num(r.creators)]));

  return cat.industries.map((ind) => {
    const brands: BrandDetails[] = ind.brands.map((b) => {
      const s = bySeg.get(b.segmentId);
      return {
        ...b,
        creators: num(s?.creators),
        engagement: num(s?.engagement),
        views: num(s?.views),
        paidPosts: num(s?.paid),
        platforms: { instagram: num(s?.instagram), tiktok: num(s?.tiktok), youtube: num(s?.youtube) },
        medianFollowers: s?.median_followers == null ? null : num(s.median_followers),
        topCountry: countryBySeg.get(b.segmentId) ?? null,
        firstPost: iso(s?.first_post),
        lastPost: iso(s?.last_post),
      };
    });
    const platforms = brands.reduce(
      (acc, b) => ({ instagram: acc.instagram + b.platforms.instagram, tiktok: acc.tiktok + b.platforms.tiktok, youtube: acc.youtube + b.platforms.youtube }),
      { instagram: 0, tiktok: 0, youtube: 0 },
    );
    const details: IndustryDetails = {
      ...ind,
      brands,
      creators: creatorsByInd.get(ind.id) ?? 0,
      engagement: brands.reduce((t, b) => t + b.engagement, 0),
      platforms,
      facts: "",
      defaultScope: defaultScope(ind.id) ?? { industry: ind.id, focal: brands[0]?.name ?? "", competitors: [] },
    };
    details.facts = facts(details);
    return details;
  });
}

/** Two or three sentences of facts about an industry, written from its numbers. */
function facts(ind: IndustryDetails): string {
  const out: string[] = [];
  const months = ind.months;
  const period = months.length === 0 ? "" : months.length === 1 ? formatMonth(months[0]) : `${formatMonth(months[0])} to ${formatMonth(months[months.length - 1])}`;
  const brandWord = ind.brands.length === 1 ? "1 tracked topic" : `${ind.brands.length} brands`;
  out.push(`${brandWord}, ${n(ind.posts)} posts by ${n(ind.creators)} creators${period ? `, ${period}` : ""}.`);
  const total = ind.platforms.instagram + ind.platforms.tiktok + ind.platforms.youtube;
  if (total) {
    const top = (Object.entries(ind.platforms) as Array<[string, number]>).sort((a, b) => b[1] - a[1]);
    const name = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" } as Record<string, string>;
    out.push(`${name[top[0][0]]} carries ${Math.round((100 * top[0][1]) / total)}% of posts, ${name[top[1][0]]} ${Math.round((100 * top[1][1]) / total)}%.`);
  }
  if (ind.brands.length > 1) {
    const byEng = [...ind.brands].sort((a, b) => b.engagement - a.engagement);
    out.push(`${byEng[0].name} has the most engagement.`);
    const focal = ind.brands.find((b) => b.name === ind.suggestedFocal);
    if (focal && focal !== byEng[0]) out.push(`${focal.name} ranks ${ordinal(byEng.indexOf(focal) + 1)} of ${ind.brands.length}.`);
  }
  out.push(ind.comments > 0 ? `Includes ${n(ind.comments)} audience comments with comment analysis.` : "Posts only: no audience comments, so sentiment, buying intent and objection sections are left out.");
  const capped = ind.brands.filter((b) => b.sourcePosts !== null && b.sourcePosts > b.posts);
  if (capped.length) {
    const cap = n(Math.max(...capped.map((b) => b.posts)));
    const who = ind.brands.length === 1 ? "It is a random sample" : capped.length === ind.brands.length ? "Every brand is a random sample" : `${capped.length} of the ${ind.brands.length} brands are random samples`;
    out.push(`${who} of up to ${cap} posts from a larger export.`);
  }
  return out.join(" ");
}
