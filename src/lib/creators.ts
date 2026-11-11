import { getDb, type Row } from "./db";
import { ensureReady } from "./schema";

export interface CreatorProfile {
  influencer_id: number;
  username: string;
  fullname: string | null;
  network: string;
  url: string | null;
  picture: string | null;
  followers: number | null;
  engagements: number | null;
  engagement_rate: number | null;
  avg_views: number | null;
  is_verified: boolean | null;
  imai_score: number | null;
  country: string | null;
  language: string | null;
  ai_summary: string | null;
  audience_female: number | null;
  audience_male: number | null;
  audience_ages: Record<string, number> | null;
  audience_countries: Array<{ name: string; weight: number }> | null;
  audience_credibility: number | null;
  brand_safety_score: number | null;
  brands: string[];
}

export interface CreatorPost extends Row {
  post_id: number;
  brand: string;
  platform: string;
  post_type: string;
  url: string;
  text: string | null;
  published_at: string;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  views: number | null;
  engagement: number | null;
  is_paid: boolean | null;
  sentiment: string | null;
  emv: number | null;
}

export interface CreatorPage {
  profile: CreatorProfile;
  posts: CreatorPost[];
  totals: { posts: number; views: number; engagement: number; emv: number; comments: number };
  commentSentiment: Array<{ sentiment: string; n: number }>;
  topTopics: Array<{ topic: string; n: number }>;
}

const parseJson = <T,>(v: unknown): T | null => (v === null || v === undefined ? null : ((typeof v === "string" ? JSON.parse(v) : v) as T));

/** Finds a creator by handle (and optionally platform or id) and gathers their activity in the dataset. */
export async function getCreatorPage(handle: string, opts: { platform?: string; id?: number } = {}): Promise<CreatorPage | null> {
  await ensureReady();
  const db = await getDb();
  const params: unknown[] = [handle.toLowerCase()];
  let where = `lower(username) = $1`;
  if (opts.id) {
    params.push(opts.id);
    where = `(influencer_id = $${params.length} OR ${where})`;
  }
  if (opts.platform) {
    params.push(opts.platform.toLowerCase());
    where += ` AND lower(network) = $${params.length}`;
  }
  const rows = await db.query(
    `SELECT * FROM influencers WHERE ${where} ORDER BY has_report DESC NULLS LAST, followers DESC NULLS LAST`,
    params,
  );

  // Fall back to the posts table for creators that have no profile row.
  let profile: CreatorProfile | null = null;
  if (rows.length) {
    const r = rows[0];
    profile = {
      influencer_id: Number(r.influencer_id),
      username: String(r.username ?? handle),
      fullname: (r.fullname as string | null) ?? null,
      network: String(r.network),
      url: (r.url as string | null) ?? null,
      picture: (r.picture as string | null) ?? null,
      followers: r.followers as number | null,
      engagements: r.engagements as number | null,
      engagement_rate: r.engagement_rate as number | null,
      avg_views: r.avg_views as number | null,
      is_verified: r.is_verified as boolean | null,
      imai_score: r.imai_score as number | null,
      country: (r.country as string | null) ?? null,
      language: (r.language as string | null) ?? null,
      ai_summary: (r.ai_summary as string | null) ?? null,
      audience_female: r.audience_female as number | null,
      audience_male: r.audience_male as number | null,
      audience_ages: parseJson<Record<string, number>>(r.audience_ages),
      audience_countries: parseJson<Array<{ name: string; weight: number }>>(r.audience_countries),
      audience_credibility: r.audience_credibility as number | null,
      brand_safety_score: r.brand_safety_score as number | null,
      brands: [...new Set(rows.map((x) => String(x.brand)))],
    };
  }

  const postParams: unknown[] = [handle.toLowerCase()];
  let postWhere = `lower(username) = $1`;
  if (profile) {
    postParams.push(profile.influencer_id);
    postWhere = `(influencer_id = $2 OR ${postWhere})`;
  }
  if (opts.platform) {
    postParams.push(opts.platform.toLowerCase());
    postWhere += ` AND lower(platform) = $${postParams.length}`;
  }
  const posts = (await db.query(
    `SELECT post_id, segment_id, brand, platform, post_type, url, left(text, 240) AS text, published_at, likes, comments, shares, views, engagement, is_paid, sentiment, emv, tier, country, followers
     FROM posts WHERE ${postWhere} ORDER BY published_at DESC LIMIT 200`,
    postParams,
  )) as CreatorPost[];
  if (!profile && !posts.length) return null;

  if (!profile) {
    const p = posts[0];
    profile = {
      influencer_id: Number(p.influencer_id ?? 0),
      username: handle,
      fullname: null,
      network: p.platform,
      url: null,
      picture: null,
      followers: (p.followers as number | null) ?? null,
      engagements: null,
      engagement_rate: null,
      avg_views: null,
      is_verified: null,
      imai_score: null,
      country: (p.country as string | null) ?? null,
      language: null,
      ai_summary: null,
      audience_female: null,
      audience_male: null,
      audience_ages: null,
      audience_countries: null,
      audience_credibility: null,
      brand_safety_score: null,
      brands: [...new Set(posts.map((x) => x.brand))],
    };
  }

  const totals = posts.reduce(
    (t, p) => ({
      posts: t.posts + 1,
      views: t.views + (p.views ?? 0),
      engagement: t.engagement + (p.engagement ?? 0),
      emv: t.emv + (p.emv ?? 0),
      comments: t.comments + (p.comments ?? 0),
    }),
    { posts: 0, views: 0, engagement: 0, emv: 0, comments: 0 },
  );

  const postKeys = posts.map((p) => [p.segment_id, p.post_id]);
  let commentSentiment: CreatorPage["commentSentiment"] = [];
  let topTopics: CreatorPage["topTopics"] = [];
  if (postKeys.length) {
    const ids = posts.map((p) => Number(p.post_id));
    commentSentiment = (await db.query(
      `SELECT sentiment, count(*)::int AS n FROM comments WHERE post_id = ANY($1::bigint[]) AND sentiment IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`,
      [ids],
    )) as CreatorPage["commentSentiment"];
    topTopics = (await db.query(
      `SELECT t AS topic, count(*)::int AS n FROM comments, unnest(topics) AS t WHERE post_id = ANY($1::bigint[]) GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
      [ids],
    )) as CreatorPage["topTopics"];
  }

  return { profile, posts, totals, commentSentiment, topTopics };
}

/** Public profile URL on the creator's platform, used when the dataset has no stored URL. */
export function platformProfileUrl(network: string, username: string): string {
  const u = encodeURIComponent(username.replace(/^@/, ""));
  switch (network) {
    case "tiktok": return `https://www.tiktok.com/@${u}`;
    case "instagram": return `https://www.instagram.com/${u}/`;
    case "youtube": return `https://www.youtube.com/@${u}`;
    default: return `https://www.google.com/search?q=${u}`;
  }
}
