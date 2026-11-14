import { Shell } from "@/components/Shell";
import { getBrands, getWorkspace } from "@/lib/brands";
import { getDatasetStats } from "@/lib/dataset-stats";
import { formatNumber, languageName, prettyKey } from "@/lib/format";
import "./data.css";

export const dynamic = "force-dynamic";

const fmtDate = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–");
const fmtMonth = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "–");
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "–");
const color = (b: string) => getBrands().find((x) => x.name === b)?.color ?? "#9ca8be";

function Meter({ value, total, label }: { value: number; total: number; label?: string }) {
  const share = total ? value / total : 0;
  return (
    <div className="meter" title={`${formatNumber(value)} of ${formatNumber(total)}`}>
      <div className="meter__track"><div className="meter__fill" style={{ width: `${Math.max(1, share * 100)}%` }} /></div>
      <span className="meter__label">{label ?? pct(value, total)}</span>
    </div>
  );
}

function Columns({ data, valueKey, labelKey, total }: { data: Array<Record<string, unknown>>; valueKey: string; labelKey: string; total?: number }) {
  const max = Math.max(...data.map((d) => Number(d[valueKey]) || 0), 1);
  return (
    <div className="cols">
      {data.map((d) => {
        const v = Number(d[valueKey]) || 0;
        return (
          <div className="cols__item" key={String(d[labelKey])} title={`${d[labelKey]}: ${formatNumber(v)}`}>
            <span className="cols__value">{formatNumber(v, v >= 10000 ? "compact" : "number")}</span>
            <div className="cols__bar" style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
            <span className="cols__label">{String(d[labelKey])}</span>
            {total !== undefined && <span className="cols__share">{pct(v, total)}</span>}
          </div>
        );
      })}
    </div>
  );
}

function Rows({ data, valueKey, labelKey, total, labelTitle }: { data: Array<Record<string, unknown>>; valueKey: string; labelKey: string; total: number; labelTitle?: (label: string) => string }) {
  return (
    <div className="rows">
      {data.map((d) => (
        <div className="rows__item" key={String(d[labelKey])}>
          <span className={`rows__label ${labelTitle ? "rows__label--hint" : ""}`} title={labelTitle ? labelTitle(String(d[labelKey])) : undefined}>{String(d[labelKey])}</span>
          <Meter value={Number(d[valueKey])} total={total} label={`${formatNumber(Number(d[valueKey]))} · ${pct(Number(d[valueKey]), total)}`} />
        </div>
      ))}
    </div>
  );
}

export default async function DataPage() {
  const s = await getDatasetStats();
  const { counts } = s;
  return (
    <Shell title="Dataset">
      <div className="ds">
        {/* 1. Overview */}
        <section className="ds__section">
          <h2 className="im-text-header">What this dataset is</h2>
          <p className="im-text-description">A social-listening export covering creator posts about {getBrands().length} {getWorkspace().category ? `${getWorkspace().category} ` : ""}brands, the audience comments on those posts, and profiles of the creators. Collected per brand by IMAI&apos;s social listening, enriched with creator data, and loaded here as four tables. Everything on this page describes the data as it is; it does not interpret it.</p>
          <div className="ds__cards">
            <div className="ds__card"><span className="im-micro-label">Posts</span><b>{formatNumber(counts.posts)}</b><small>one row per creator post per brand</small></div>
            <div className="ds__card"><span className="im-micro-label">Comments</span><b>{formatNumber(counts.comments)}</b><small>one row per comment, each with an AI analysis</small></div>
            <div className="ds__card"><span className="im-micro-label">Creator profiles</span><b>{formatNumber(counts.influencers)}</b><small>{formatNumber(counts.creators)} distinct creators, one row per creator per brand</small></div>
            <div className="ds__card"><span className="im-micro-label">Brand segments</span><b>{counts.segments}</b><small>the query and precomputed outputs per brand</small></div>
          </div>
          <div className="ds__timeline">
            <div><span className="im-micro-label">Posts</span><div>{fmtDate(s.dates.firstPost)} to {fmtDate(s.dates.lastPost)}</div></div>
            <div><span className="im-micro-label">Comments</span><div>{fmtDate(s.dates.firstComment)} to {fmtDate(s.dates.lastComment)}</div></div>
            <div><span className="im-micro-label">Export taken</span><div>{fmtDate(s.dates.exported)}</div></div>
          </div>
          <div className="ds__grid-3">
            {s.platforms.map((p) => (
              <div className="ds__mini" key={p.platform}>
                <b>{p.platform}</b>
                <div>{formatNumber(p.posts)} posts · {formatNumber(p.comments)} comments</div>
                <div className="im-text-description">{formatNumber(p.video)} video · {formatNumber(p.image)} image</div>
              </div>
            ))}
          </div>
        </section>

        {/* 2. Brands */}
        <section className="ds__section">
          <h2 className="im-text-header">Brands</h2>
          <p className="im-text-description">Each brand is a tracked segment: posts were collected per brand with a keyword query covering the brand, its product names and its official accounts.</p>
          <div className="im-card" style={{ overflow: "hidden" }}>
            <table className="tbl">
              <thead><tr><th>Brand</th><th>Role</th><th className="num">Posts</th><th className="num">Creators</th><th className="num">Comments</th><th className="num">TikTok</th><th className="num">Instagram</th><th className="num">YouTube</th><th>Posts from</th><th>Posts to</th></tr></thead>
              <tbody>
                {s.brands.map((b) => (
                  <tr key={b.brand}>
                    <td><span className="row"><i className="dot" style={{ background: color(b.brand) }} />{b.brand}</span></td>
                    <td>{b.role}</td>
                    <td className="num">{formatNumber(b.posts)}</td><td className="num">{formatNumber(b.creators)}</td><td className="num">{formatNumber(b.comments)}</td>
                    <td className="num">{formatNumber(b.tiktok)}</td><td className="num">{formatNumber(b.instagram)}</td><td className="num">{formatNumber(b.youtube)}</td>
                    <td>{fmtMonth(b.first)}</td><td>{fmtMonth(b.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 3. Distributions */}
        <section className="ds__section">
          <h2 className="im-text-header">Distributions</h2>
          <div className="ds__grid-2">
            <div className="im-card im-card--pad ds__span">
              <h3 className="im-text-sub-header">Posts and comments per month</h3>
              <p className="im-text-description">Posts by publication month. Comments by the month they were written.</p>
              <div className="ds__dual">
                <div><span className="im-micro-label">Posts</span><Columns data={s.monthly} valueKey="posts" labelKey="month" /></div>
                <div><span className="im-micro-label">Comments</span><Columns data={s.monthly} valueKey="comments" labelKey="month" /></div>
              </div>
            </div>
            <div className="im-card im-card--pad">
              <h3 className="im-text-sub-header">Creator tiers</h3>
              <p className="im-text-description">Follower bands as they appear in the data (min and max followers observed per tier).</p>
              <table className="tbl">
                <thead><tr><th>Tier</th><th>Followers observed</th><th className="num">Posts</th><th className="num">Creators</th><th>Share of posts</th></tr></thead>
                <tbody>
                  {s.tiers.map((t) => (
                    <tr key={t.tier}><td>{t.tier}</td><td>{formatNumber(t.minFollowers, "compact")} to {formatNumber(t.maxFollowers, "compact")}</td><td className="num">{formatNumber(t.posts)}</td><td className="num">{formatNumber(t.creators)}</td><td><Meter value={t.posts} total={counts.posts} /></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="im-card im-card--pad">
              <h3 className="im-text-sub-header">Creator countries (posts)</h3>
              <Rows data={s.countries} valueKey="posts" labelKey="country" total={counts.posts} />
            </div>
            <div className="im-card im-card--pad">
              <h3 className="im-text-sub-header">Comments per post</h3>
              <p className="im-text-description">How many posts carry comments, and therefore comment analysis.</p>
              <Rows data={s.commentsPerPost} valueKey="posts" labelKey="bucket" total={counts.posts} />
            </div>
            <div className="im-card im-card--pad">
              <h3 className="im-text-sub-header">Post languages</h3>
              <p className="im-text-description">Detected caption language. Unknown is common because captions are short or emoji-only.</p>
              <Rows data={s.languages.posts} valueKey="n" labelKey="language" total={counts.posts} labelTitle={languageName} />
            </div>
            <div className="im-card im-card--pad">
              <h3 className="im-text-sub-header">Comment languages</h3>
              <p className="im-text-description">Hover a code for the language name.</p>
              <Rows data={s.languages.comments} valueKey="n" labelKey="language" total={counts.comments} labelTitle={languageName} />
            </div>
          </div>
        </section>

        {/* 5. AI analysis layer */}
        <section className="ds__section">
          <h2 className="im-text-header">What the AI analysis layer contains</h2>
          <p className="im-text-description">Each comment was run through an analysis model that assigns labels and extracts phrases. For every analysis field: the values that occur, how many comments carry one, and one real comment as an example (handles removed).</p>
          <div className="ds__grid-2">
            {s.analysis.map((a) => (
              <div className="im-card im-card--pad ds__analysis" key={a.col}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div><h3 className="im-text-sub-header">{a.label}</h3><code className="im-text-description">{a.col}</code></div>
                  <span className="im-badge">{formatNumber(a.filled)} comments · {a.kind === "label" ? `${a.distinct} values` : `${formatNumber(a.distinct)} distinct phrases`}</span>
                </div>
                <Meter value={a.filled} total={counts.comments} label={`${pct(a.filled, counts.comments)} of comments`} />
                <div className="ds__values">
                  {a.values.map((v) => (
                    <span className="ds__value" key={v.value} title={`${formatNumber(v.n)} comments`}>{v.value} <b>{formatNumber(v.n)}</b></span>
                  ))}
                  {a.kind === "free" && a.distinct > a.values.length && <span className="ds__value ds__value--more">+{formatNumber(a.distinct - a.values.length)} more</span>}
                </div>
                {a.example && (
                  <blockquote className="ds__example">
                    “{a.example.text}”
                    <footer>labelled <b>{a.example.value}</b> · on {a.example.brand} content</footer>
                  </blockquote>
                )}
              </div>
            ))}
          </div>
          <div className="im-card im-card--pad" style={{ marginTop: "1rem" }}>
            <h3 className="im-text-sub-header">Precomputed outputs per brand (segments table)</h3>
            <p className="im-text-description">Besides per-comment labels, each brand segment carries strategy text and a comment-insights payload produced in September 2026.</p>
            <table className="tbl">
              <thead><tr><th>Brand</th><th>Strategy text fields</th><th>Per-platform versions</th><th>Comment-insights payload keys</th><th>Model recorded</th></tr></thead>
              <tbody>
                {s.segmentOutputs.map((o) => (
                  <tr key={o.brand}>
                    <td><span className="row"><i className="dot" style={{ background: color(o.brand) }} />{o.brand}</span></td>
                    <td>{o.insightFields.join(", ") || "–"}</td>
                    <td>{o.platforms.join(", ") || "–"}</td>
                    <td style={{ whiteSpace: "normal" }}>{o.commentPayloadKeys.join(", ") || "–"}</td>
                    <td>{o.model ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 6. Samples */}
        <section className="ds__section">
          <h2 className="im-text-header">Sample rows</h2>
          <p className="im-text-description">A few records with their fields visible, so the shape of the data is clear. Text is truncated.</p>
          <div className="ds__grid-2">
            <div className="im-card im-card--pad"><h3 className="im-text-sub-header">posts</h3>{s.samples.posts.map((r, i) => <RecordView key={i} row={r} />)}</div>
            <div className="im-card im-card--pad"><h3 className="im-text-sub-header">comments</h3>{s.samples.comments.map((r, i) => <RecordView key={i} row={r} />)}</div>
          </div>
        </section>

        {/* 7. Provenance */}
        <section className="ds__section">
          <h2 className="im-text-header">Provenance and caveats</h2>
          <div className="ds__grid-2">
            <div className="im-card im-card--pad">
              <h3 className="im-text-sub-header">Where the data comes from</h3>
              <ol className="ds__list">
                <li>Posts were collected per brand by IMAI&apos;s social listening, using a keyword query per brand across TikTok, Instagram and YouTube.</li>
                <li>IMAI enriched each post with creator data (tier, followers, country, estimated fee, earned media value) and fetched the comments.</li>
                <li>Every comment was run through an analysis model that assigned the labels listed above and extracted verbatim phrases.</li>
                <li>Creator profiles were pulled from IMAI reports where available, including audience demographics.</li>
                <li>The four CSV exports were reduced to the columns on this page and loaded into this app&apos;s database. Raw report JSON was not kept.</li>
              </ol>
            </div>
            <div className="im-card im-card--pad">
              <h3 className="im-text-sub-header">Known limitations</h3>
              <ul className="ds__list">
                <li>Views are present on {pct(s.caveats.viewsFilled, counts.posts)} of posts. Sums of views undercount.</li>
                <li>Caption language is known for {pct(s.caveats.languageKnown, counts.posts)} of posts; comment language is more complete.</li>
                <li>Audience demographics exist for {formatNumber(s.caveats.audienceCoverage)} of {formatNumber(counts.influencers)} creator rows ({pct(s.caveats.audienceCoverage, counts.influencers)}); a profile report exists for {pct(s.caveats.reportCoverage, counts.influencers)}.</li>
                <li>Posts are keyed by brand and post, so a post that mentions two brands appears once under each; {s.caveats.crossSegmentPosts} posts do.</li>
                {s.caveats.smallBrands.map((b) => <li key={b.brand}>{b.brand} has {b.posts} posts. Treat its figures as anecdotal.</li>)}
                <li>Free-text analysis fields (safety complaint type, FAQ topic, backlash type, brand affinity) are not normalised: the same idea appears with different spellings.</li>
                <li>Counts for likes, views and comments are as of collection time, not live.</li>
                <li>The focal brand and competitor set come from the tracked segments in the data.</li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </Shell>
  );
}

function RecordView({ row }: { row: Record<string, unknown> }) {
  return (
    <dl className="ds__record">
      {Object.entries(row).map(([k, v]) => (
        <div key={k}><dt>{prettyKey(k)}</dt><dd>{v === null || v === undefined ? <span className="im-muted">null</span> : Array.isArray(v) ? v.join(", ") : v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v)}</dd></div>
      ))}
    </dl>
  );
}
