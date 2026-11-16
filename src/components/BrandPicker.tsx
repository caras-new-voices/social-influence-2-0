"use client";
import { useEffect, useMemo, useState } from "react";
import type { BrandDetails, DashboardScope, IndustryDetails } from "@/lib/scope-shared";
import "@/app/brands.css";

/* ------------------------------------------------------------------ */
/* Catalogue (loaded once per page)                                     */
/* ------------------------------------------------------------------ */

let catalogCache: IndustryDetails[] | null = null;
let catalogRequest: Promise<IndustryDetails[]> | null = null;

function loadCatalog(): Promise<IndustryDetails[]> {
  if (catalogCache) return Promise.resolve(catalogCache);
  if (!catalogRequest) {
    catalogRequest = fetch("/api/catalog")
      .then((r) => (r.ok ? (r.json() as Promise<{ industries: IndustryDetails[] }>) : Promise.reject(new Error("Could not load the industries"))))
      .then((j) => {
        catalogCache = j.industries;
        return j.industries;
      })
      .catch((e: unknown) => {
        catalogRequest = null;
        throw e;
      });
  }
  return catalogRequest;
}

/** The industries and their brands, from /api/catalog. Shared by every picker on the page. */
export function useCatalog(): { industries: IndustryDetails[] | null; error: string | null } {
  const [industries, setIndustries] = useState<IndustryDetails[] | null>(catalogCache);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (industries) return;
    let alive = true;
    loadCatalog()
      .then((list) => { if (alive) setIndustries(list); })
      .catch((e: unknown) => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, [industries]);
  return { industries, error };
}

/* ------------------------------------------------------------------ */
/* Formatting                                                           */
/* ------------------------------------------------------------------ */

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
function short(n: number): string {
  const abs = Math.abs(n);
  const t = (x: number) => (x >= 100 ? x.toFixed(0) : x.toFixed(1).replace(/\.0$/, ""));
  if (abs >= 1e9) return `${t(n / 1e9)}B`;
  if (abs >= 1e6) return `${t(n / 1e6)}M`;
  if (abs >= 1e4) return `${t(n / 1e3)}K`;
  return fmt(n);
}
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%");
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}
function monthRange(first: string | null | undefined, last: string | null | undefined): string {
  if (!first || !last) return "No posts yet";
  const a = monthLabel(first.slice(0, 7));
  const b = monthLabel(last.slice(0, 7));
  return a === b ? a : `${a} to ${b}`;
}

const PLATFORM_LABEL: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" };
function topPlatform(p: BrandDetails["platforms"]): { name: string; share: string } | null {
  const entries = Object.entries(p) as Array<[string, number]>;
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (!total) return null;
  const [name, v] = entries.sort((a, b) => b[1] - a[1])[0];
  return { name: PLATFORM_LABEL[name] ?? name, share: pct(v, total) };
}
const perPost = (b: BrandDetails) => (b.posts > 0 ? b.engagement / b.posts : 0);

/* ------------------------------------------------------------------ */
/* Picker                                                               */
/* ------------------------------------------------------------------ */

type Role = "focal" | "competitor" | "out";

export interface BrandPickerProps {
  value: DashboardScope | null;
  onChange: (scope: DashboardScope) => void;
  /** Hide the industry list (only the brands of the current industry can change). */
  lockIndustry?: boolean;
}

/**
 * Chooses a dashboard's brands: the industry first, then which brand is "your company" and which
 * are competitors, with the numbers behind each brand and a running summary of the selection.
 */
export function BrandPicker({ value, onChange, lockIndustry }: BrandPickerProps) {
  const { industries, error } = useCatalog();
  const [browsing, setBrowsing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const industry = useMemo(() => (value && industries ? industries.find((i) => i.id === value.industry) ?? null : null), [value, industries]);

  if (error) return <div className="bp bp--state" role="alert">{error}. Close this and try again.</div>;
  if (!industries) return <div className="bp bp--state" aria-busy="true"><span className="spinner" /> Loading industries…</div>;

  const showList = !lockIndustry && (!industry || browsing);
  const pickIndustry = (ind: IndustryDetails) => {
    setBrowsing(false);
    if (value?.industry !== ind.id) onChange(ind.defaultScope);
  };

  return (
    <div className="bp">
      <div className="bp__layout">
      <div className="bp__main">
        {/* Step 1: industry */}
        <section className="bp__section" aria-labelledby="bp-industry-h">
          <div className="bp__sechead">
            <span className="bp__step" aria-hidden="true">1</span>
            <h4 id="bp-industry-h">Industry</h4>
            {industry && !showList && !lockIndustry && (
              <button type="button" className="im-btn im-btn-ghost im-btn-sm bp__change" onClick={() => setBrowsing(true)}>Change industry</button>
            )}
            {industry && showList && (
              <button type="button" className="im-btn im-btn-ghost im-btn-sm bp__change" onClick={() => setBrowsing(false)}>Keep {industry.name}</button>
            )}
          </div>
          {showList ? (
            <IndustryList industries={industries} selected={value?.industry ?? null} onPick={pickIndustry} />
          ) : industry ? (
            <IndustryAbout industry={industry} />
          ) : null}
        </section>

        {/* Step 2: brands */}
        {industry && value && !showList && <BrandList industry={industry} value={value} onChange={onChange} />}
      </div>

      <SelectionSummary industry={showList ? null : industry} value={value} open={detailsOpen} onToggle={() => setDetailsOpen((o) => !o)} />
      </div>
    </div>
  );
}

/* ---------------- industries ---------------- */

function IndustryList({ industries, selected, onPick }: { industries: IndustryDetails[]; selected: string | null; onPick: (i: IndustryDetails) => void }) {
  return (
    <>
      <p className="bp__hint">Pick the market this dashboard looks at. You choose the brands next.</p>
      <div className="bp__industries" role="radiogroup" aria-label="Industry">
        {industries.map((ind) => {
          const on = ind.id === selected;
          return (
            <button
              key={ind.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`bp__industry ${on ? "is-on" : ""}`}
              onClick={() => onPick(ind)}
            >
              <span className="bp__indtop">
                <b>{ind.name}</b>
                {ind.comments > 0 ? <span className="im-badge im-badge-primary">Comments</span> : <span className="im-badge">Posts only</span>}
              </span>
              <span className="bp__indmeta">
                {[ind.region, plural(ind.brands.length, "brand"), `${short(ind.posts)} posts`, monthRange(ind.months[0], ind.months[ind.months.length - 1])].filter(Boolean).join(" · ")}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function IndustryAbout({ industry }: { industry: IndustryDetails }) {
  return (
    <div className="bp__about">
      <div className="bp__abouthead">
        <b>{industry.name}</b>
        <span className="bp__indmeta">{[industry.region, monthRange(industry.months[0], industry.months[industry.months.length - 1])].filter(Boolean).join(" · ")}</span>
        {industry.comments > 0 ? <span className="im-badge im-badge-primary">Comments</span> : <span className="im-badge">Posts only</span>}
      </div>
      {industry.summary && <p>{industry.summary}</p>}
      {industry.facts && <p className="bp__facts">{industry.facts}</p>}
    </div>
  );
}

/* ---------------- brands ---------------- */

function BrandList({ industry, value, onChange }: { industry: IndustryDetails; value: DashboardScope; onChange: (s: DashboardScope) => void }) {
  const focal = industry.brands.find((b) => b.name === value.focal) ?? null;
  const competitors = new Set(value.competitors);
  const roleOf = (b: BrandDetails): Role => (b.name === value.focal ? "focal" : competitors.has(b.name) ? "competitor" : "out");

  const sorted = [...industry.brands].sort((a, b) => {
    if (a.name === value.focal) return -1;
    if (b.name === value.focal) return 1;
    return b.posts - a.posts || a.name.localeCompare(b.name);
  });

  const setRole = (b: BrandDetails, role: Role) => {
    const keep = value.competitors.filter((c) => c !== b.name);
    if (role === "focal") {
      // The previous company stays in the selection as a competitor.
      const prev = value.focal && value.focal !== b.name ? [value.focal] : [];
      onChange({ industry: industry.id, focal: b.name, competitors: [...keep, ...prev] });
    } else if (role === "competitor") {
      onChange({ ...value, competitors: [...keep, b.name] });
    } else {
      onChange({ ...value, competitors: keep });
    }
  };

  const eligible = industry.brands.filter((b) => b.name !== value.focal && b.kind !== "topic");
  const allIn = eligible.every((b) => competitors.has(b.name));

  return (
    <section className="bp__section" aria-labelledby="bp-brands-h">
      <div className="bp__sechead">
        <span className="bp__step" aria-hidden="true">2</span>
        <h4 id="bp-brands-h">Brands</h4>
        <div className="bp__bulk">
          <button type="button" className="im-btn im-btn-ghost im-btn-sm" onClick={() => onChange({ ...value, competitors: [...value.competitors.filter((c) => !eligible.some((b) => b.name === c)), ...eligible.map((b) => b.name)] })} disabled={allIn}>All as competitors</button>
          <button type="button" className="im-btn im-btn-ghost im-btn-sm" onClick={() => onChange({ ...value, competitors: [] })} disabled={!value.competitors.length}>Clear competitors</button>
        </div>
      </div>
      <p className="bp__hint">Choose one brand as your company. Every brand you include shows up in the charts; the rest are left out.</p>
      <ul className="bp__brands">
        {sorted.map((b) => (
          <BrandRow key={b.name} brand={b} role={roleOf(b)} sameOwner={!!focal?.owner && b.name !== focal.name && b.owner === focal.owner} onRole={(r) => setRole(b, r)} industryId={industry.id} />
        ))}
      </ul>
    </section>
  );
}

function BrandRow({ brand: b, role, sameOwner, onRole, industryId }: { brand: BrandDetails; role: Role; sameOwner: boolean; onRole: (r: Role) => void; industryId: string }) {
  const plat = topPlatform(b.platforms);
  const group = `bp-${industryId}-${b.segmentId}`;
  const options: Array<{ id: Role; label: string }> = [
    { id: "focal", label: "Your company" },
    { id: "competitor", label: "Competitor" },
    { id: "out", label: "Not included" },
  ];
  const stats: string[] = [
    b.sourcePosts && b.sourcePosts > b.posts ? `Sample of ${fmt(b.posts)} from ${fmt(b.sourcePosts)} posts` : plural(b.posts, "post"),
    plural(b.creators, "creator"),
    `${short(perPost(b))} engagement per post`,
  ];
  if (plat) stats.push(`${plat.share} ${plat.name}`);
  if (b.posts > 0) stats.push(`${pct(b.paidPosts, b.posts)} paid`);
  if (b.topCountry) stats.push(`Mostly ${b.topCountry}`);
  if (b.comments > 0) stats.push(plural(b.comments, "comment"));

  return (
    <li className={`bp__brand is-${role}`}>
      <div className="bp__brandinfo">
        <div className="bp__brandname">
          <b>{b.name}</b>
          {b.kind === "topic" && <span className="im-badge im-badge-warning">Market topic</span>}
          {sameOwner && <span className="im-badge" title={`Owned by ${b.owner}, like your company. Leave it out if it is a sister brand.`}>Same owner</span>}
        </div>
        {(b.owner && b.owner !== b.name) || b.kind === "topic" ? (
          <span className="bp__owner">{b.kind === "topic" ? "A market conversation, not a rival brand" : `Owned by ${b.owner}`}</span>
        ) : null}
        {b.description && <p className="bp__desc">{b.description}</p>}
        <p className="bp__stats">{stats.join(" · ")}</p>
      </div>
      <div className="bp__roles" role="radiogroup" aria-label={`Role of ${b.name}`}>
        {options.map((o) => {
          const disabled = role === "focal" && o.id !== "focal";
          return (
            <label key={o.id} className={`bp__role bp__role--${o.id} ${role === o.id ? "is-on" : ""} ${disabled ? "is-disabled" : ""}`} title={disabled ? "Choose another brand as your company first" : undefined}>
              <input type="radio" name={group} value={o.id} checked={role === o.id} disabled={disabled} onChange={() => onRole(o.id)} />
              <span>{o.label}</span>
            </label>
          );
        })}
      </div>
    </li>
  );
}

/* ---------------- summary ---------------- */

function SelectionSummary({ industry, value, open, onToggle }: { industry: IndustryDetails | null; value: DashboardScope | null; open: boolean; onToggle: () => void }) {
  if (!industry || !value) {
    return (
      <aside className="bp__summary" aria-label="Your selection">
        <span className="im-micro-label">Your selection</span>
        <p className="bp__sumhead">Pick an industry to see its brands.</p>
      </aside>
    );
  }
  const byName = new Map(industry.brands.map((b) => [b.name, b]));
  const focal = byName.get(value.focal) ?? null;
  const comps = value.competitors.map((c) => byName.get(c)).filter((b): b is BrandDetails => !!b);
  const chosen = focal ? [focal, ...comps] : comps;
  const posts = chosen.reduce((s, b) => s + b.posts, 0);
  const creators = chosen.reduce((s, b) => s + b.creators, 0);
  const comments = chosen.reduce((s, b) => s + b.comments, 0);
  const first = chosen.map((b) => b.firstPost).filter((d): d is string => !!d).sort()[0] ?? null;
  const last = chosen.map((b) => b.lastPost).filter((d): d is string => !!d).sort().pop() ?? null;
  const rank = (score: (b: BrandDetails) => number) => (focal ? [...chosen].sort((a, b) => score(b) - score(a)).findIndex((b) => b === focal) + 1 : 0);
  const largest = [...comps].sort((a, b) => b.posts - a.posts)[0] ?? null;
  const sampled = chosen.some((b) => b.sourcePosts && b.sourcePosts > b.posts);

  return (
    <aside className={`bp__summary ${open ? "is-open" : ""}`} aria-label="Your selection" aria-live="polite">
      <div className="bp__sumtop">
        <span className="im-micro-label">Your selection</span>
        <button type="button" className="im-btn im-btn-ghost im-btn-sm bp__sumtoggle" onClick={onToggle} aria-expanded={open}>{open ? "Hide details" : "Show details"}</button>
      </div>
      <p className="bp__sumhead">
        <b>{value.focal}</b> against {plural(comps.length, "competitor")} in {industry.name}
      </p>
      <dl className="bp__sumlist">
        <div><dt>Posts</dt><dd>{fmt(posts)}</dd></div>
        <div title="Counted per brand: a creator who posts about two of the brands counts twice."><dt>Creators, per brand</dt><dd>{fmt(creators)}</dd></div>
        <div><dt>Period</dt><dd>{monthRange(first, last)}</dd></div>
        {focal && chosen.length > 1 && (
          <>
            <div><dt>{value.focal} by posts</dt><dd>{rank((b) => b.posts)} of {chosen.length}</dd></div>
            <div><dt>By engagement per post</dt><dd>{rank(perPost)} of {chosen.length}</dd></div>
          </>
        )}
        {largest && <div><dt>Largest competitor</dt><dd>{largest.name}, {plural(largest.posts, "post")}</dd></div>}
      </dl>
      {(comments === 0 || comps.length === 0 || comps.length > 7 || sampled) && (
        <ul className="bp__warnings">
          {comps.length === 0 && <li>No competitors: comparison elements will be empty.</li>}
          {comps.length > 7 && <li className="bp__minor">More than 7 competitors: charts reuse colours. Fewer is easier to read.</li>}
          {comments === 0 && <li>Posts only: sections that need audience comments are left out.</li>}
          {sampled && <li className="bp__note">Some brands are a sample of a larger export, so their totals are lower than the real volume.</li>}
        </ul>
      )}
    </aside>
  );
}

/** "Jim Beam vs 5 · Spirits" style label for a scope, used in headers and lists. */
export function scopeLabel(focal: string, competitors: number, industry?: string | null): string {
  return `${focal} vs ${competitors}${industry ? ` · ${industry}` : ""}`;
}
