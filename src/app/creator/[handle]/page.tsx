import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { CreatorPosts } from "@/components/CreatorPosts";
import { getBrands, SENTIMENT_COLORS } from "@/lib/brands";
import { getCreatorPage, platformProfileUrl } from "@/lib/creators";
import { formatNumber } from "@/lib/format";
import "./creator.css";

export const dynamic = "force-dynamic";

export default async function CreatorPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ platform?: string; id?: string; from?: string }>;
}) {
  const { handle } = await params;
  const sp = await searchParams;
  const page = await getCreatorPage(decodeURIComponent(handle), { platform: sp.platform, id: sp.id ? Number(sp.id) : undefined });
  if (!page) notFound();
  const { profile: p, posts, totals, commentSentiment, topTopics } = page;
  const profileUrl = p.url ?? platformProfileUrl(p.network, p.username);
  const brandColor = (b: string) => getBrands().find((x) => x.name === b)?.color ?? "#9ca8be";
  const sentimentTotal = commentSentiment.reduce((s, r) => s + r.n, 0);
  const ages = p.audience_ages ? Object.entries(p.audience_ages).filter(([, v]) => typeof v === "number").sort(([a], [b]) => a.localeCompare(b)) : [];

  return (
    <Shell
      title={p.username}
      titleSlot={
        <div className="row" style={{ gap: "0.75rem", minWidth: 0 }}>
          <Link href={sp.from ? `/dashboard/${sp.from}` : "/"} className="im-btn im-btn-ghost im-btn-sm">← Back</Link>
          <h1 className="truncate">@{p.username}</h1>
          <span className="im-badge">{p.network}</span>
        </div>
      }
      actions={<a className="im-btn im-btn-secondary" href={profileUrl} target="_blank" rel="noreferrer">Open on {p.network} ↗</a>}
    >
      <div className="cr">
        <section className="cr__hero im-card im-card--pad">
          <div className="cr__identity">
            {p.picture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.picture} alt="" className="cr__avatar" referrerPolicy="no-referrer" />
            ) : (
              <div className="cr__avatar cr__avatar--empty">{p.username.slice(0, 2).toUpperCase()}</div>
            )}
            <div className="grow">
              <h2 className="im-text-header">{p.fullname ?? p.username}{p.is_verified ? <span className="im-badge im-badge-primary" style={{ marginLeft: "0.5rem" }}>Verified</span> : null}</h2>
              <p className="im-text-description">
                @{p.username} on {p.network}{p.country ? ` · ${p.country}` : ""}{p.language ? ` · ${p.language}` : ""}
              </p>
              <div className="row" style={{ marginTop: "0.5rem", flexWrap: "wrap" }}>
                <span className="im-text-description">Posts about:</span>
                {p.brands.map((b) => (
                  <span key={b} className="brand-chip" style={{ background: "var(--Base-02)" }}><i className="dot" style={{ background: brandColor(b) }} />{b}</span>
                ))}
              </div>
            </div>
          </div>
          {p.ai_summary && <p className="cr__summary">{p.ai_summary}</p>}
        </section>

        <section className="kpis cr__kpis">
          <Tile label="Followers" value={formatNumber(p.followers, "compact")} />
          <Tile label="Engagement rate" value={p.engagement_rate !== null ? formatNumber(p.engagement_rate, "percent") : "–"} />
          <Tile label="Avg views per post" value={formatNumber(p.avg_views, "compact")} />
          <Tile label="Posts in dataset" value={formatNumber(totals.posts)} />
          <Tile label="Views in dataset" value={formatNumber(totals.views, "compact")} />
          <Tile label="Engagement in dataset" value={formatNumber(totals.engagement, "compact")} />
          <Tile label="EMV in dataset" value={formatNumber(totals.emv, "currency")} />
        </section>

        <div className="cr__grid">
          <section className="im-card im-card--pad">
            <h3 className="im-text-sub-header">Audience</h3>
            {p.audience_female === null && !ages.length && !p.audience_countries?.length ? (
              <p className="im-text-description" style={{ marginTop: "0.4rem" }}>No audience report for this creator in the dataset.</p>
            ) : (
              <div className="stack" style={{ marginTop: "0.6rem" }}>
                {p.audience_female !== null && (
                  <div>
                    <span className="im-micro-label">Gender</span>
                    <div className="seg__bar" style={{ height: 22, marginTop: 4 }}>
                      <div className="seg__part" style={{ width: `${(p.audience_female ?? 0) * 100}%`, background: "#7132f5" }}>{Math.round((p.audience_female ?? 0) * 100)}% women</div>
                      <div className="seg__part" style={{ width: `${(p.audience_male ?? 0) * 100}%`, background: "#2a78d6" }}>{Math.round((p.audience_male ?? 0) * 100)}% men</div>
                    </div>
                  </div>
                )}
                {ages.length > 0 && (
                  <div>
                    <span className="im-micro-label">Age bands</span>
                    <div className="rows">
                      {ages.map(([band, share]) => (
                        <div className="rows__item" key={band}>
                          <span className="rows__label">{band}</span>
                          <div className="meter"><div className="meter__track"><div className="meter__fill" style={{ width: `${Math.max(1, share * 100)}%` }} /></div><span className="meter__label">{Math.round(share * 100)}%</span></div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {p.audience_countries && p.audience_countries.length > 0 && (
                  <div>
                    <span className="im-micro-label">Top audience countries</span>
                    <div className="rows">
                      {p.audience_countries.slice(0, 5).map((c) => (
                        <div className="rows__item" key={c.name}>
                          <span className="rows__label">{c.name}</span>
                          <div className="meter"><div className="meter__track"><div className="meter__fill" style={{ width: `${Math.max(1, c.weight * 100)}%` }} /></div><span className="meter__label">{Math.round(c.weight * 100)}%</span></div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {(p.audience_credibility !== null || p.brand_safety_score !== null) && (
                  <p className="im-text-description">
                    {p.audience_credibility !== null ? `Audience credibility ${Math.round(p.audience_credibility * 100)}%` : ""}
                    {p.audience_credibility !== null && p.brand_safety_score !== null ? " · " : ""}
                    {p.brand_safety_score !== null ? `Brand safety score ${Math.round(p.brand_safety_score)}` : ""}
                  </p>
                )}
              </div>
            )}
          </section>

          <section className="im-card im-card--pad">
            <h3 className="im-text-sub-header">Comments on their posts</h3>
            {sentimentTotal === 0 ? (
              <p className="im-text-description" style={{ marginTop: "0.4rem" }}>No analysed comments for this creator&apos;s posts.</p>
            ) : (
              <div className="stack" style={{ marginTop: "0.6rem" }}>
                <div>
                  <span className="im-micro-label">{formatNumber(sentimentTotal)} comments by sentiment</span>
                  <div className="seg__bar" style={{ height: 22, marginTop: 4 }}>
                    {["positive", "neutral", "negative"].map((s) => {
                      const n = commentSentiment.find((r) => r.sentiment === s)?.n ?? 0;
                      const share = n / sentimentTotal;
                      return n ? <div key={s} className="seg__part" style={{ width: `${share * 100}%`, background: SENTIMENT_COLORS[s] }}>{share > 0.08 ? `${Math.round(share * 100)}% ${s}` : ""}</div> : null;
                    })}
                  </div>
                </div>
                {topTopics.length > 0 && (
                  <div>
                    <span className="im-micro-label">What commenters talk about</span>
                    <div className="ds__values" style={{ marginTop: 6 }}>
                      {topTopics.map((t) => <span key={t.topic} className="ds__value">{t.topic} <b>{formatNumber(t.n)}</b></span>)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        <section className="im-card im-card--pad">
          <h3 className="im-text-sub-header">Posts in the dataset</h3>
          <p className="im-text-description" style={{ margin: "0.2rem 0 0.75rem" }}>Sorted by date. Click a column to sort; the link opens the post on its platform.</p>
          <CreatorPosts posts={posts} />
        </section>
      </div>
    </Shell>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <div className="kpi__label">{label}</div>
      <div className="kpi__value">{value}</div>
    </div>
  );
}
