import { Shell } from "@/components/Shell";
import { getCatalog } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { ACCURACY_JUDGE, LIMITS, MEASURES, THRESHOLDS, readAccuracy } from "@/lib/method";
import { ensureReady } from "@/lib/schema";
import "@/app/data/data.css";
import "./method.css";

export const dynamic = "force-dynamic";

type CoverageRow = { industry: string; posts: number; first: string | null; last: string | null; themed: number; about_read: number; product_read: number; owned: number; comments: number; comments_read: number };

/** The coverage counts scan three whole tables, so one answer is kept for ten minutes. */
let cached: { at: number; rows: CoverageRow[] } | null = null;
async function coverage(): Promise<CoverageRow[]> {
  if (cached && Date.now() - cached.at < 600_000) return cached.rows;
  const rows = await readCoverage();
  cached = { at: Date.now(), rows };
  return rows;
}

async function readCoverage(): Promise<CoverageRow[]> {
  await ensureReady();
  const db = await getDb();
  return db.query<CoverageRow>(`
WITH p AS (
  SELECT s.industry, count(*)::int AS posts, to_char(min(p.published_at), 'YYYY-MM') AS first, to_char(max(p.published_at), 'YYYY-MM') AS last,
         count(*) FILTER (WHERE p.about IS NOT NULL)::int AS about_read, count(*) FILTER (WHERE p.product IS NOT NULL OR p.claims IS NOT NULL)::int AS product_read,
         count(*) FILTER (WHERE p.is_owned)::int AS owned
  FROM posts_raw p JOIN segments_raw s ON s.id = p.segment_id WHERE s.industry IS NOT NULL GROUP BY 1
), t AS (
  SELECT s.industry, count(DISTINCT (l.segment_id, l.post_id))::int AS themed
  FROM post_labels_raw l JOIN segments_raw s ON s.id = l.segment_id WHERE l.kind = 'theme' AND l.source = 'model' GROUP BY 1
), c AS (
  SELECT s.industry, count(*)::int AS comments, count(*) FILTER (WHERE c.about IS NOT NULL)::int AS comments_read
  FROM comments_raw c JOIN segments_raw s ON s.id = c.segment_id GROUP BY 1
)
SELECT p.*, coalesce(t.themed, 0) AS themed, coalesce(c.comments, 0) AS comments, coalesce(c.comments_read, 0) AS comments_read
FROM p LEFT JOIN t USING (industry) LEFT JOIN c USING (industry) ORDER BY p.posts DESC`);
}

const month = (ym: string | null) => (ym ? new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }) : "–");
const share = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "–");

export default async function MethodPage() {
  // The page must still explain the method when the coverage cannot be read.
  const rows = await coverage().catch((e) => { console.error("[method] coverage failed:", (e as Error).message); return null; });
  const { pass: PASS_MARK, lines: ACCURACY } = readAccuracy();
  const names = new Map(getCatalog().industries.map((i) => [i.id, i.name]));
  return (
    <Shell title="Method">
      <div className="ds method">
        <section className="ds__section">
          <h2 className="im-text-header">How the numbers are made</h2>
          <p className="im-text-description">For whoever has to trust or challenge a number on a dashboard: what each measure is, the fixed lines it is judged against, how much data stands behind it, how accurate the readings are, and what it cannot show. Every dashboard uses the same definitions, so a change is a change and not a new definition.</p>
        </section>

        <section className="ds__section">
          <h2 className="im-text-header">The eight measures</h2>
          <div className="im-card" style={{ overflow: "hidden" }}>
            <table className="tbl">
              <thead><tr><th>Measure</th><th>How it is worked out</th><th>To know</th></tr></thead>
              <tbody>{MEASURES.map((m) => <tr key={m.name}><td><b>{m.name}</b></td><td>{m.formula}</td><td className="method__note">{m.note}</td></tr>)}</tbody>
            </table>
          </div>
        </section>

        <section className="ds__section">
          <h2 className="im-text-header">Fixed lines and minimum samples</h2>
          <p className="im-text-description">These do not change from month to month or from brand to brand. What falls under a minimum is hidden, not estimated.</p>
          <div className="im-card" style={{ overflow: "hidden" }}>
            <table className="tbl">
              <tbody>{THRESHOLDS.map(([k, v]) => <tr key={k}><td><b>{k}</b></td><td>{v}</td></tr>)}</tbody>
            </table>
          </div>
        </section>

        <section className="ds__section">
          <h2 className="im-text-header">Coverage</h2>
          <p className="im-text-description">What is loaded for each industry, and how much of it has been read by a model. Posts counts every post loaded, including the ones later judged not to be about the brand, which dashboards leave out. A market is the creator&apos;s country, and a comment takes the market of its post.</p>
          <div className="im-card" style={{ overflow: "auto" }}>
            <table className="tbl">
              <thead><tr><th>Industry</th><th className="num">Posts</th><th>From</th><th>To</th><th className="num">Theme read by a model</th><th className="num">Checked: about the brand</th><th className="num">From brand-owned accounts</th><th className="num">Product or claim found</th><th className="num">Comments</th><th className="num">Comments read</th></tr></thead>
              <tbody>
                {rows === null && <tr><td colSpan={10}>The coverage could not be read just now. Reload the page to try again.</td></tr>}
                {(rows ?? []).map((r) => (
                  <tr key={r.industry}>
                    <td>{names.get(r.industry) ?? r.industry}</td>
                    <td className="num">{r.posts.toLocaleString("en-US")}</td><td>{month(r.first)}</td><td>{month(r.last)}</td>
                    <td className="num">{share(r.themed, r.posts)}</td><td className="num">{share(r.about_read, r.posts)}</td><td className="num">{share(r.owned, r.posts)}</td>
                    <td className="num">{r.product_read ? share(r.product_read, r.posts) : "not read"}</td>
                    <td className="num">{r.comments ? r.comments.toLocaleString("en-US") : "none"}</td><td className="num">{r.comments ? share(r.comments_read, r.comments) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="ds__section">
          <h2 className="im-text-header">Measured accuracy</h2>
          <p className="im-text-description">{ACCURACY_JUDGE} The pass mark is {PASS_MARK}%. Read anything below it as a direction, not to the point.</p>
          <div className="im-card" style={{ overflow: "hidden" }}>
            <table className="tbl">
              <thead><tr><th>What is read</th><th>Where</th><th>Sample</th><th>Measured</th><th className="num">Agreement</th><th>Result</th></tr></thead>
              <tbody>
                {ACCURACY.map((a) => (
                  <tr key={a.key}>
                    <td>{a.what}</td><td>{a.scope}</td><td>{a.sample}</td><td>{a.measured}</td><td className="num">{a.agreement}%</td>
                    <td><span className={`im-badge ${a.agreement >= PASS_MARK ? "im-badge-success" : "im-badge-warning"}`}>{a.agreement >= PASS_MARK ? "Pass" : "Below the mark"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="im-text-description">The arithmetic is checked separately: 946 numbers on the default dashboard are worked out a second time from the raw files, without the dashboard&apos;s own queries, and must match.</p>
        </section>

        <section className="ds__section">
          <h2 className="im-text-header">What it cannot show</h2>
          <ul className="method__limits">{LIMITS.map((l) => <li key={l}>{l}</li>)}</ul>
        </section>
      </div>
    </Shell>
  );
}
