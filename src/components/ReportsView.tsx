"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatNumber } from "@/lib/format";
import { addDays, addMonths, formatDate, formatMonth, monthKey, monthStart } from "@/lib/period";
import type { MonthKpis, MonthMeasure, MonthRead, MonthReportRow, StoredReport } from "@/lib/reports";
import type { DashboardRecord } from "@/lib/widgets";
import { Shell } from "./Shell";
import { useToast } from "./Toast";
import { announceUsage, type UsageLine } from "@/lib/usage-shared";
import { Markdown } from "./WidgetBody";

type Initial = { rows: MonthReportRow[]; coveredTo: string | null; markets?: string[] };

/** A measure as the dashboard shows it. */
function fmtMeasure(m: MonthMeasure, v: number | null): string {
  if (v == null) return "–";
  if (m.fmt === "percent") return `${(v * 100).toFixed(1)}%`;
  if (m.fmt === "ratio") return `${v.toFixed(2)}×`;
  if (m.fmt === "points") return `${v >= 0 ? "+" : ""}${v.toFixed(1)} pts`;
  return v.toFixed(1);
}
/** The change from the month before, in the measure's own unit: points for a share, a difference for a ratio or a rate. */
function change(m: MonthMeasure): { text: string; size: number; dir: -1 | 0 | 1 } | null {
  if (m.value == null || m.compare == null) return null;
  const d = m.value - m.compare;
  if (Math.abs(d) < 1e-9) return { text: "no change", size: 0, dir: 0 };
  const text = m.fmt === "percent" ? `${Math.abs(d * 100).toFixed(1)} pts` : m.fmt === "ratio" ? Math.abs(d).toFixed(2) : Math.abs(d).toFixed(1);
  // From nothing to something is the largest move there is.
  return { text, size: m.compare ? Math.abs(d / m.compare) : 1, dir: d > 0 ? 1 : -1 };
}
/** A month's read as held on the page; kpis is null when it could not be fetched. */
type Read = MonthRead | "failed";
/** What a card says when a measure has no month-before figure by design. */
const NO_COMPARE: Record<string, string> = { Momentum: "posts against the month before", "Content gap": "the largest gap of any theme" };
const LOWER_IS_BETTER = new Set(["Objections per 1K"]);

/** The eight measures for the month against the month before, and the three that moved most. */
function MonthMeasures({ read, month, prev, market, retry }: { read: Read | undefined; month: string; prev: string | null; market: string; retry: () => void }) {
  if (read === "failed") return <p className="im-text-description rep__loading">The eight measures could not be loaded. <button className="im-btn im-btn-ghost im-btn-sm" onClick={retry}>Try again</button></p>;
  if (!read) return <p className="im-text-description rep__loading">Working out the eight measures for {month}{market ? ` in ${market}` : ""}…</p>;
  if (!read.measures.some((m) => m.value != null)) return <p className="im-text-description rep__loading">The eight measures could not be worked out for {month}{market ? ` in ${market}` : ""}: too few posts.</p>;
  const moved = read.measures.map((m) => ({ m, c: change(m) })).filter((x) => x.c && x.c.size >= 0.02).sort((a, b) => b.c!.size - a.c!.size).slice(0, 3);
  return (
    <>
      <div className="rep__kpis rep__kpis--measures">
        {read.measures.map((m) => {
          const c = change(m);
          const good = c ? (LOWER_IS_BETTER.has(m.label) ? c.dir < 0 : c.dir > 0) : true;
          return (
            <div className="rep__kpi" key={m.label}>
              <span className="rep__kpilabel">{m.label}</span>
              <b>{fmtMeasure(m, m.value)}</b>
              <span className="rep__kpiprev">
                {c && c.dir !== 0 ? <span className={`rep__delta ${good ? "rep__delta--up" : "rep__delta--down"}`}>{c.dir > 0 ? "▲" : "▼"} {c.text}</span> : <span className="rep__delta rep__delta--na">{c ? "no change" : NO_COMPARE[m.label] ?? "–"}</span>}
                {m.compare != null && <span className="im-text-description"> vs {fmtMeasure(m, m.compare)}</span>}
              </span>
            </div>
          );
        })}
      </div>
      {read.kpis.posts < 30 && <p className="im-text-description rep__loading">Only {read.kpis.posts} of our posts in {month}{market ? ` in ${market}` : ""}: too few to read these closely.</p>}
      {prev && (
        <p className="rep__moved">
          <b>What moved most{market ? ` in ${market}` : ""}:</b>{" "}
          {!read.measures.some((m) => m.compare != null) ? `no posts in ${prev}${market ? ` in ${market}` : ""} to compare with.`
            : moved.length ? moved.map((x, i) => `${i ? "; " : ""}${x.m.label.toLowerCase()} ${x.c!.dir > 0 ? "up" : "down"} ${x.c!.text} to ${fmtMeasure(x.m, x.m.value)}`).join("") + "." : `nothing moved by more than 2% against ${prev}.`}
        </p>
      )}
    </>
  );
}

function Delta({ now, before, invert = false }: { now: number | null; before: number | null | undefined; invert?: boolean }) {
  if (now == null || before == null || before === 0) return <span className="rep__delta rep__delta--na">–</span>;
  const d = (now - before) / Math.abs(before);
  const good = invert ? d <= 0 : d >= 0;
  return <span className={`rep__delta ${good ? "rep__delta--up" : "rep__delta--down"}`}>{d >= 0 ? "▲" : "▼"} {Math.abs(d * 100).toFixed(0)}%</span>;
}

const KPI_COLS: Array<{ key: keyof MonthKpis; label: string; fmt: "compact" | "number" | "percent1"; invert?: boolean }> = [
  { key: "posts", label: "Posts", fmt: "compact" },
  { key: "creators", label: "Creators", fmt: "compact" },
  { key: "engagement", label: "Engagement", fmt: "compact" },
  { key: "comments", label: "Comments", fmt: "compact" },
  { key: "positiveShare", label: "Positive share", fmt: "percent1" },
  { key: "intentComments", label: "Buying intent", fmt: "number" },
  { key: "objections", label: "Objections", fmt: "number", invert: true },
];

function fmtKpi(v: number | null, fmt: "compact" | "number" | "percent1"): string {
  if (v == null) return "–";
  if (fmt === "percent1") return `${v.toFixed(1)}%`;
  return formatNumber(v, fmt);
}

/** " · written with 2,140 tokens" for a stored review (older reviews have no count). */
function reviewUsage(review: StoredReport): string {
  const u = (review.data as { usage?: UsageLine | null } | null)?.usage;
  if (!u) return "";
  return ` · written with ${u.estimated ? "about " : ""}${u.total.toLocaleString("en-US")} tokens${u.estimated ? " (estimated)" : ""}`;
}

/** Month-by-month report index for one dashboard, with the stored month-in-review. */
export function ReportsView({ dashboard, initial, initialMarket }: { dashboard: DashboardRecord; initial: Initial; initialMarket?: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<MonthReportRow[]>(initial.rows);
  const [open, setOpen] = useState<string | null>(initial.rows.find((r) => r.complete && r.kpis.posts >= 30)?.month ?? initial.rows.find((r) => r.kpis.posts >= 30)?.month ?? initial.rows[0]?.month ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const markets = initial.markets ?? [];
  const [market, setMarket] = useState(() => (initialMarket && markets.includes(initialMarket) ? initialMarket : ""));
  // The monthly read per month and market, fetched when first looked at.
  const [reads, setReads] = useState<Record<string, Read>>({});
  const readKey = open ? `${open}@${market}` : "";
  useEffect(() => {
    if (!open || reads[readKey]) return;
    let live = true;
    fetch(`/api/dashboards/${dashboard.id}/reports/${open}/read${market ? `?market=${encodeURIComponent(market)}` : ""}`)
      .then((r) => r.json())
      .then((j: MonthRead & { error?: string }) => { if (live) setReads((x) => ({ ...x, [readKey]: j.error || !j.measures ? "failed" : j })); })
      .catch(() => { if (live) setReads((x) => ({ ...x, [readKey]: "failed" })); });
    return () => { live = false; };
  }, [dashboard.id, open, market, readKey, reads]);
  const read = reads[readKey];
  const retry = () => setReads((x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== readKey)));
  const ok = read && read !== "failed" ? read : null;
  const onDashboard = (m: string) => `/dashboard/${dashboard.id}?period=${m}&compare=prev&market=${encodeURIComponent(market)}`;

  const generate = async (month: string, force: boolean) => {
    setBusy(month);
    try {
      const r = await fetch(`/api/dashboards/${dashboard.id}/reports/${month}${force ? "?force=1" : ""}`, { method: "POST" });
      const j = (await r.json()) as { report?: StoredReport; error?: string };
      if (!r.ok || !j.report) throw new Error(j.error ?? "Could not generate the review");
      setRows((rs) => rs.map((x) => (x.month === month ? { ...x, review: j.report! } : x)));
      announceUsage();
      setOpen(month);
      toast(force ? "Review regenerated" : "Review ready");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const current = rows.find((r) => r.month === open) ?? null;
  const prevLabel = (m: string) => formatMonth(monthKey(addMonths(monthStart(m), -1)), false);

  return (
    <Shell
      title={`${dashboard.name}: monthly reports`}
      titleSlot={
        <div className="row" style={{ gap: "0.6rem", minWidth: 0 }}>
          <Link href={`/dashboard/${dashboard.id}`} className="im-btn im-btn-ghost im-btn-sm">← Dashboard</Link>
          <h1 className="truncate">{dashboard.name}: monthly reports</h1>
        </div>
      }
      actions={
        <>
          <button className="im-btn im-btn-secondary" onClick={() => window.print()} disabled={!current}>Export PDF</button>
          {current && (
            <Link className="im-btn im-btn-primary" href={onDashboard(current.month)}>Open {formatMonth(current.month, false)} on the dashboard</Link>
          )}
        </>
      }
    >
      <div className="rep">
        <aside className="rep__list" aria-label="Months">
          <div className="rep__listhead">
            <span className="im-micro-label">Months with data, all markets</span>
            <span className="im-text-description">{initial.coveredTo ? `Data delivered to ${formatDate(initial.coveredTo)}` : ""}</span>
          </div>
          {rows.map((r) => (
            <button key={r.month} className={`rep__month ${open === r.month ? "is-active" : ""}`} onClick={() => setOpen(r.month)} aria-current={open === r.month ? "true" : undefined}>
              <div className="rep__monthrow">
                <b>{r.label}</b>
                {!r.complete && <span className="im-badge im-badge-warning">partial</span>}
                {r.review && <span className="im-badge im-badge-primary">review</span>}
              </div>
              <div className="rep__monthkpis">
                <span>{formatNumber(r.kpis.posts, "compact")} posts <Delta now={r.kpis.posts} before={r.previous?.posts} /></span>
                <span>{formatNumber(r.kpis.engagement, "compact")} eng. <Delta now={r.kpis.engagement} before={r.previous?.engagement} /></span>
                <span>{formatNumber(r.kpis.comments, "compact")} comments <Delta now={r.kpis.comments} before={r.previous?.comments} /></span>
              </div>
            </button>
          ))}
          {rows.length === 0 && <p className="im-text-description" style={{ padding: "1rem" }}>No complete months yet.</p>}
        </aside>
        <section className="rep__main" aria-live="polite">
          {current ? (
            <article className="rep__report">
              <header className="rep__head">
                <div>
                  <span className="im-micro-label">Monthly report · {dashboard.name}</span>
                  <h2 className="im-text-headline">{current.label}</h2>
                  <p className="im-text-description">
                    {formatDate(current.start)} to {formatDate(addDays(current.end, -1))}: data for {current.label}{current.previous ? `, compared with ${prevLabel(current.month)}` : ""}.
                    {!current.complete && " This month is partial: the data delivered so far does not reach the end of the month."}
                  </p>
                </div>
                <div className="rep__actions no-print">
                  {current.review ? (
                    <button className="im-btn im-btn-secondary im-btn-sm" onClick={() => void generate(current.month, true)} disabled={busy === current.month}>{busy === current.month ? "Regenerating…" : "Regenerate review"}</button>
                  ) : (
                    <button className="im-btn im-btn-primary im-btn-sm" onClick={() => void generate(current.month, false)} disabled={busy === current.month}>{busy === current.month ? "Writing…" : "Write month in review"}</button>
                  )}
                  {(markets.length > 1 || market) && (
                    <select className="rep__market" value={market} onChange={(e) => setMarket(e.target.value)} aria-label="Market">
                      <option value="">All markets</option>
                      {markets.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  )}
                  <Link className="im-btn im-btn-ghost im-btn-sm" href={onDashboard(current.month)}>Ask about this month</Link>
                </div>
              </header>
              <h3 className="rep__sub">The eight measures{market ? ` in ${market}` : ""}</h3>
              <MonthMeasures read={read} month={current.label} prev={current.previous ? prevLabel(current.month) : null} market={market} retry={retry} />
              <h3 className="rep__sub">Volume{market ? ` in ${market}` : ""}: counts, not rates</h3>
              <div className="rep__kpis">
                {KPI_COLS.map((c) => {
                  const k = market ? ok?.kpis ?? null : current.kpis;
                  const before = market ? ok?.previous : current.previous;
                  return (
                    <div className="rep__kpi" key={c.key}>
                      <span className="rep__kpilabel">{c.label}</span>
                      <b>{k ? fmtKpi(k[c.key], c.fmt) : read === "failed" ? "–" : "…"}</b>
                      <span className="rep__kpiprev">
                        <Delta now={k ? k[c.key] : null} before={before?.[c.key]} invert={c.invert} />
                        {before && <span className="im-text-description"> vs {fmtKpi(before[c.key], c.fmt)}</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
              {current.review ? (
                <div className="rep__review">
                  {market && <p className="im-text-description">The written review below covers all markets, not {market} alone.</p>}
                  <Markdown text={current.review.summary_md} />
                  <p className="im-text-description rep__meta">Written {new Date(current.review.created_at).toLocaleString("en-GB")}{current.review.model ? ` · ${current.review.model}` : ""}{reviewUsage(current.review)}. Numbers above are live; the narrative is frozen at the time it was written.</p>
                </div>
              ) : (
                <div className="rep__empty">
                  <p className="im-text-sub-header">No review written yet</p>
                  <p className="im-text-description">The analyst runs every element of this dashboard for {current.label}{current.previous ? ` and ${prevLabel(current.month)}` : ""} and writes a short narrative: what grew, what fell, notable comments and a suggested action.</p>
                </div>
              )}
            </article>
          ) : (
            <div className="rep__empty"><p className="im-text-description">Pick a month.</p></div>
          )}
        </section>
      </div>
    </Shell>
  );
}
