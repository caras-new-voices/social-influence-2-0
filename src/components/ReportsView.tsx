"use client";
import Link from "next/link";
import { useState } from "react";
import { formatNumber } from "@/lib/format";
import { addDays, addMonths, formatDate, formatMonth, monthKey, monthStart } from "@/lib/period";
import type { MonthKpis, MonthReportRow, StoredReport } from "@/lib/reports";
import type { DashboardRecord } from "@/lib/widgets";
import { Shell } from "./Shell";
import { useToast } from "./Toast";
import { Markdown } from "./WidgetBody";

type Initial = { rows: MonthReportRow[]; coveredTo: string | null };

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

/** Month-by-month report index for one dashboard, with the stored month-in-review. */
export function ReportsView({ dashboard, initial }: { dashboard: DashboardRecord; initial: Initial }) {
  const toast = useToast();
  const [rows, setRows] = useState<MonthReportRow[]>(initial.rows);
  const [open, setOpen] = useState<string | null>(initial.rows.find((r) => r.review)?.month ?? initial.rows[0]?.month ?? null);
  const [busy, setBusy] = useState<string | null>(null);

  const generate = async (month: string, force: boolean) => {
    setBusy(month);
    try {
      const r = await fetch(`/api/dashboards/${dashboard.id}/reports/${month}${force ? "?force=1" : ""}`, { method: "POST" });
      const j = (await r.json()) as { report?: StoredReport; error?: string };
      if (!r.ok || !j.report) throw new Error(j.error ?? "Could not generate the review");
      setRows((rs) => rs.map((x) => (x.month === month ? { ...x, review: j.report! } : x)));
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
            <Link className="im-btn im-btn-primary" href={`/dashboard/${dashboard.id}?period=${current.month}&compare=prev`}>Open {formatMonth(current.month, false)} on the dashboard</Link>
          )}
        </>
      }
    >
      <div className="rep">
        <aside className="rep__list" aria-label="Months">
          <div className="rep__listhead">
            <span className="im-micro-label">Months with data</span>
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
                  <Link className="im-btn im-btn-ghost im-btn-sm" href={`/dashboard/${dashboard.id}?period=${current.month}&compare=prev`}>Ask about this month</Link>
                </div>
              </header>
              <div className="rep__kpis">
                {KPI_COLS.map((c) => (
                  <div className="rep__kpi" key={c.key}>
                    <span className="rep__kpilabel">{c.label}</span>
                    <b>{fmtKpi(current.kpis[c.key], c.fmt)}</b>
                    <span className="rep__kpiprev">
                      <Delta now={current.kpis[c.key]} before={current.previous?.[c.key]} invert={c.invert} />
                      {current.previous && <span className="im-text-description"> vs {fmtKpi(current.previous[c.key], c.fmt)}</span>}
                    </span>
                  </div>
                ))}
              </div>
              {current.review ? (
                <div className="rep__review">
                  <Markdown text={current.review.summary_md} />
                  <p className="im-text-description rep__meta">Written {new Date(current.review.created_at).toLocaleString("en-GB")}{current.review.model ? ` · ${current.review.model}` : ""}. Numbers above are live; the narrative is frozen at the time it was written.</p>
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
