import { Shell } from "@/components/Shell";
import { BRANDS } from "@/lib/brands";
import { getDb } from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { ensureReady } from "@/lib/schema";

export const dynamic = "force-dynamic";

export default async function DataPage() {
  await ensureReady();
  const db = await getDb();
  const rows = await db.query<{ brand: string; posts: number; creators: number; views: number; engagement: number; comments: number }>(`
    SELECT p.brand, count(*)::int AS posts, count(DISTINCT p.influencer_id)::int AS creators, sum(p.views) AS views, sum(p.engagement) AS engagement,
           (SELECT count(*)::int FROM comments c WHERE c.brand = p.brand) AS comments
    FROM posts p GROUP BY p.brand ORDER BY posts DESC`);
  const [range] = await db.query<{ first: string; last: string }>(`SELECT min(published_at) AS first, max(published_at) AS last FROM posts`);
  const platforms = await db.query<{ platform: string; posts: number }>(`SELECT platform, count(*)::int AS posts FROM posts GROUP BY 1 ORDER BY 2 DESC`);
  const color = (b: string) => BRANDS.find((x) => x.name === b)?.color ?? "#9ca8be";
  return (
    <Shell title="Dataset">
      <div style={{ padding: "1.5rem", display: "grid", gap: "1rem", maxWidth: 1000 }}>
        <div className="im-card im-card--pad">
          <h2 className="im-text-header">Preloaded social-listening export</h2>
          <p className="im-text-description" style={{ marginTop: "0.3rem" }}>
            Posts from {new Date(range.first).toLocaleDateString("en-GB", { month: "short", year: "numeric" })} to {new Date(range.last).toLocaleDateString("en-GB", { month: "short", year: "numeric" })} across {platforms.map((p) => `${p.platform} (${formatNumber(p.posts)})`).join(", ")}. Every comment carries an AI analysis: sentiment, emotion, purchase intent, objections, competitor mentions, loyalty, safety complaints and more.
          </p>
        </div>
        <div className="im-card" style={{ overflow: "hidden" }}>
          <table className="tbl">
            <thead><tr><th>Brand</th><th className="num">Posts</th><th className="num">Creators</th><th className="num">Views</th><th className="num">Engagement</th><th className="num">Comments</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.brand}>
                  <td><span className="row"><i className="dot" style={{ background: color(r.brand) }} />{r.brand}</span></td>
                  <td className="num">{formatNumber(r.posts)}</td>
                  <td className="num">{formatNumber(r.creators)}</td>
                  <td className="num">{formatNumber(r.views, "compact")}</td>
                  <td className="num">{formatNumber(r.engagement, "compact")}</td>
                  <td className="num">{formatNumber(r.comments)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
