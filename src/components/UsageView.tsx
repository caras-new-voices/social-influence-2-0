"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SERIES_PALETTE } from "@/lib/brands";
import { relativeTime } from "@/lib/format";
import { addDays, addMonths, daysBetween, formatDate, monthEnd, monthKey, monthStart, toIsoDate } from "@/lib/period";
import type { StatementRow, UsageEventRow, UsageSummary } from "@/lib/usage";
import { formatTokens, KIND_LABELS, USAGE_EVENT, USAGE_KINDS, type BalanceInfo, type UsageKind } from "@/lib/usage-shared";
import { AddTokensDialog } from "./AddTokensDialog";
import { Shell } from "./Shell";

/* ---------------------------------------------------------------- */
/* Period                                                             */
/* ---------------------------------------------------------------- */

type PeriodId = "month" | "last_month" | "last_30" | "all";
const PERIODS: Array<{ id: PeriodId; label: string; used: string }> = [
  { id: "month", label: "This month", used: "Used this month" },
  { id: "last_month", label: "Last month", used: "Used last month" },
  { id: "last_30", label: "Last 30 days", used: "Used in the last 30 days" },
  { id: "all", label: "All time", used: "Used, all time" },
];

interface Range { from?: string; to?: string }

/** UTC date range for a period; `to` is exclusive. */
function periodRange(p: PeriodId, today: string): Range {
  const thisMonth = monthStart(monthKey(today));
  switch (p) {
    case "month": return { from: thisMonth, to: monthEnd(monthKey(today)) };
    case "last_month": return { from: addMonths(thisMonth, -1), to: thisMonth };
    case "last_30": return { from: addDays(today, -29), to: addDays(today, 1) };
    default: return {};
  }
}

function rangeLabel(r: Range): string {
  if (!r.from || !r.to) return "All time";
  return `${formatDate(r.from)} to ${formatDate(addDays(r.to, -1))}`;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/* ---------------------------------------------------------------- */
/* Formatting                                                         */
/* ---------------------------------------------------------------- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const full = (n: number) => Math.round(n).toLocaleString("en-US");
const pad = (n: number) => String(n).padStart(2, "0");

/** Local time, "16 Nov, 10:17" (with the year when it is not this year). */
function fmtTime(iso: string): string {
  const d = new Date(iso);
  const year = d.getFullYear() === new Date().getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
/** "16 Nov" from YYYY-MM-DD. */
function dayTick(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}
function fmtCost(n: number): string {
  if (n > 0 && n < 0.005) return "<$0.01";
  return `$${n.toFixed(2)}`;
}
/** Per-interaction cost: small numbers, so three decimals. */
function fmtCostFine(n: number): string {
  if (n > 0 && n < 0.0005) return "<$0.001";
  return `$${n.toFixed(3)}`;
}
function pct(part: number, whole: number): string {
  if (!whole) return "0%";
  const v = (100 * part) / whole;
  return `${v > 0 && v < 1 ? "<1" : Math.round(v)}%`;
}
const kindLabel = (k: string) => KIND_LABELS[k as UsageKind] ?? k;

/** One fixed colour per kind so a kind keeps its colour whatever the period shows. */
const EXTRA_COLORS = ["#0f9fb5", "#9ca8be"];
const KIND_COLORS: Record<string, string> = Object.fromEntries(USAGE_KINDS.map((k, i) => [k, [...SERIES_PALETTE, ...EXTRA_COLORS][i % (SERIES_PALETTE.length + EXTRA_COLORS.length)]]));
const kindColor = (k: string) => KIND_COLORS[k] ?? "#9ca8be";

/* ---------------------------------------------------------------- */
/* Data loading                                                       */
/* ---------------------------------------------------------------- */

type Summary = UsageSummary & { balance: BalanceInfo };
const PAGE = 100;

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j;
}

/* ---------------------------------------------------------------- */
/* Pieces                                                             */
/* ---------------------------------------------------------------- */

function Tile({ label, value, sub, tone, title }: { label: string; value: string; sub?: string; tone?: "low" | "out"; title?: string }) {
  return (
    <div className={`usg-tile ${tone ? `usg-tile--${tone}` : ""}`} title={title}>
      <span className="usg-tile__label">{label}</span>
      <b className="usg-tile__value">{value}</b>
      {sub && <span className="usg-tile__sub">{sub}</span>}
    </div>
  );
}

function Share({ value, total, color }: { value: number; total: number; color?: string }) {
  const w = total ? Math.max(value > 0 ? 2 : 0, (100 * value) / total) : 0;
  return (
    <span className="usg-share" title={`${pct(value, total)} of the tokens in this period`}>
      <span className="usg-share__track"><span className="usg-share__fill" style={{ width: `${w}%`, background: color }} /></span>
      <span className="usg-share__pct">{pct(value, total)}</span>
    </span>
  );
}

interface DayRow { day: string; total: number; [kind: string]: number | string }

interface TipProps { active?: boolean; label?: unknown; payload?: Array<{ dataKey?: unknown; value?: unknown; payload?: DayRow }> }
function DayTip({ active, label, payload }: TipProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  const items = payload.filter((p) => Number(p.value) > 0).slice().reverse();
  return (
    <div className="tip">
      <div className="tip__title">{formatDate(String(label))}</div>
      {items.map((p) => (
        <div className="tip__row" key={String(p.dataKey)}>
          <span><i className="tip__key" style={{ background: kindColor(String(p.dataKey)), height: 8, width: 8, borderRadius: 2 }} />{kindLabel(String(p.dataKey))}</span>
          <b>{full(Number(p.value))}</b>
        </div>
      ))}
      {items.length === 0 && <div className="tip__row"><span>No usage</span></div>}
      <div className="tip__row usg-tip__total"><span>Total</span><b>{full(Number(row?.total ?? 0))}</b></div>
    </div>
  );
}

/** Stacked tokens per day, one series per kind; top-ups marked as dashed lines. */
export function DailyChart({ days, series, topUps }: { days: DayRow[]; series: string[]; topUps: Array<{ day: string; tokens: number }> }) {
  if (!days.length || !series.length) return <div className="usg-empty usg-empty--chart">No usage in this period.</div>;
  return (
    <>
      <div className="chart__legend usg-legend" aria-label="Legend">
        {series.map((s) => <span key={s}><i style={{ background: kindColor(s) }} /> {kindLabel(s)}</span>)}
        {topUps.length > 0 && <span><i className="usg-legend__topup" /> Tokens added</span>}
      </div>
      <div className="usg-chart" role="img" aria-label={`Tokens per day, ${days[0].day} to ${days[days.length - 1].day}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={days} margin={{ top: 14, right: 12, left: 0, bottom: 0 }} barCategoryGap={days.length > 40 ? "12%" : "24%"}>
            <CartesianGrid stroke="#e9ebf0" vertical={false} />
            <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#8490ad" }} axisLine={false} tickLine={false} minTickGap={18} tickFormatter={(v) => dayTick(String(v))} />
            <YAxis tick={{ fontSize: 11, fill: "#8490ad" }} axisLine={false} tickLine={false} tickFormatter={(v) => formatTokens(Number(v))} width={48} allowDecimals={false} />
            <Tooltip content={<DayTip />} cursor={{ fill: "rgba(113,50,245,0.06)" }} />
            {topUps.map((t) => (
              <ReferenceLine key={t.day} x={t.day} stroke="#1baf7a" strokeDasharray="3 3" ifOverflow="extendDomain"
                label={{ value: `+${formatTokens(t.tokens)}`, position: "top", fontSize: 10, fill: "#15803d" }} />
            ))}
            {series.map((s, i) => (
              <Bar key={s} dataKey={s} name={s} stackId="tokens" fill={kindColor(s)} radius={i === series.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} isAnimationActive={false} maxBarSize={36} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

/** Builds the per-day rows, with zero days filled in. */
function buildDays(summary: Summary | null, range: Range, today: string): { days: DayRow[]; series: string[] } {
  if (!summary) return { days: [], series: [] };
  const present = new Set(summary.daily.filter((d) => d.tokens > 0).map((d) => d.kind));
  const series = [...USAGE_KINDS.filter((k) => present.has(k)), ...[...present].filter((k) => !(USAGE_KINDS as readonly string[]).includes(k))];
  let start: string | undefined, end: string | undefined; // inclusive
  if (range.from && range.to) {
    start = range.from;
    end = addDays(range.to, -1);
    if (end > today && start <= today) end = today;
  } else if (summary.daily.length) {
    const ds = summary.daily.map((d) => d.day).sort();
    start = ds[0];
    end = ds[ds.length - 1];
  }
  if (!start || !end || !series.length) return { days: [], series };
  const n = Math.min(daysBetween(start, end) + 1, 3660);
  const byDay = new Map<string, DayRow>();
  const days: DayRow[] = [];
  for (let i = 0; i < n; i++) {
    const day = addDays(start, i);
    const row: DayRow = { day, total: 0 };
    for (const s of series) row[s] = 0;
    byDay.set(day, row);
    days.push(row);
  }
  for (const d of summary.daily) {
    const row = byDay.get(d.day);
    if (!row) continue;
    row[d.kind] = Number(row[d.kind] ?? 0) + d.tokens;
    row.total += d.tokens;
  }
  return { days, series };
}

function statementWhat(r: StatementRow): string {
  switch (r.kind) {
    case "grant": return r.note || "Starting allowance";
    case "top_up": return r.note || "Added tokens (demo)";
    case "usage": return `Usage · ${r.interactions ?? 0} interaction${r.interactions === 1 ? "" : "s"}`;
    default: return r.note || "Adjustment";
  }
}

/* ---------------------------------------------------------------- */
/* The page                                                           */
/* ---------------------------------------------------------------- */

export function UsageView() {
  const [period, setPeriod] = useState<PeriodId>("month");
  const [today, setToday] = useState(() => toIsoDate(new Date()));
  const range = useMemo(() => periodRange(period, today), [period, today]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [statement, setStatement] = useState<StatementRow[] | null>(null);
  const [events, setEvents] = useState<UsageEventRow[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [dashFilter, setDashFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [tick, setTick] = useState(0);
  const eventsSeq = useRef(0);

  const summaryUrl = `/api/usage/summary${qs({ from: range.from, to: range.to })}`;
  const eventFilters = useMemo(() => ({ from: range.from, to: range.to, dashboard: dashFilter || undefined, kind: kindFilter || undefined }), [range, dashFilter, kindFilter]);
  const eventsUrl = `/api/usage/events${qs({ ...eventFilters, limit: PAGE })}`;

  useEffect(() => {
    let alive = true;
    getJson<Summary>(summaryUrl)
      .then((s) => { if (alive) { setSummary(s); setError(null); } })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [summaryUrl, tick]);

  useEffect(() => {
    let alive = true;
    getJson<{ statement: StatementRow[] }>("/api/usage/ledger")
      .then((j) => { if (alive) setStatement(j.statement); })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [tick]);

  /** First page of the log; reloads on filter changes and live refresh. */
  useEffect(() => {
    const id = ++eventsSeq.current;
    getJson<{ events: UsageEventRow[] }>(eventsUrl)
      .then((j) => {
        if (id !== eventsSeq.current) return;
        setEvents(j.events);
        setHasMore(j.events.length === PAGE);
      })
      .catch((e: Error) => { if (id === eventsSeq.current) setError(e.message); });
  }, [eventsUrl, tick]);

  const loadMore = async () => {
    const last = events?.[events.length - 1];
    if (!last) return;
    const id = ++eventsSeq.current;
    setLoadingMore(true);
    try {
      const j = await getJson<{ events: UsageEventRow[] }>(`/api/usage/events${qs({ ...eventFilters, before: last.id, limit: PAGE })}`);
      if (id !== eventsSeq.current) return;
      setEvents((cur) => [...(cur ?? []), ...j.events]);
      setHasMore(j.events.length === PAGE);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  // Live refresh: after any interaction or top-up, and when the window regains focus.
  useEffect(() => {
    const refresh = () => {
      const now = toIsoDate(new Date());
      setToday((t) => (t === now ? t : now));
      setTick((t) => t + 1);
    };
    window.addEventListener(USAGE_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(USAGE_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const balance = summary?.balance;
  const totals = summary?.totals;
  const periodInfo = PERIODS.find((p) => p.id === period)!;
  const { days, series } = useMemo(() => buildDays(summary, range, today), [summary, range, today]);
  const topUps = useMemo(() => {
    if (!days.length || !statement) return [];
    const inRange = new Set(days.map((d) => d.day));
    const byDay = new Map<string, number>();
    for (const r of statement) {
      if (r.kind !== "top_up" && r.kind !== "grant") continue;
      const day = r.at.slice(0, 10);
      if (inRange.has(day)) byDay.set(day, (byDay.get(day) ?? 0) + r.tokens);
    }
    return [...byDay].map(([day, tokens]) => ({ day, tokens }));
  }, [days, statement]);

  const dashOptions = useMemo(() => (summary?.byDashboard ?? []).filter((d) => d.dashboard_id), [summary]);
  const kindOptions = useMemo(() => {
    const ks = new Set((summary?.byKind ?? []).map((k) => k.kind));
    if (kindFilter) ks.add(kindFilter);
    return [...ks].sort((a, b) => kindLabel(a).localeCompare(kindLabel(b)));
  }, [summary, kindFilter]);
  const exportHref = `/api/usage/events${qs({ ...eventFilters, format: "csv" })}`;
  const total = totals?.tokens ?? 0;

  const periodButtons = (
    <div className="usg-seg" role="group" aria-label="Period">
      {PERIODS.map((p) => (
        <button key={p.id} type="button" className={`usg-seg__btn ${period === p.id ? "is-active" : ""}`} aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>{p.label}</button>
      ))}
    </div>
  );

  return (
    <Shell
      title="Usage"
      actions={
        <div className="usg-actions no-print">
          {periodButtons}
          {balance?.canTopUp && <button type="button" className="im-btn im-btn-primary" onClick={() => setAdding(true)}>Add tokens</button>}
        </div>
      }
    >
      <div className="usg">
        <header className="usg__printhead">
          <h1>Token usage</h1>
          <p>{periodInfo.label} · {rangeLabel(range)} · printed {fmtTime(new Date().toISOString())}</p>
        </header>

        <label className="usg-periodbar no-print">
          <span className="im-label">Period</span>
          <select className="im-select" value={period} onChange={(e) => setPeriod(e.target.value as PeriodId)}>
            {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>

        {error && <div className="usg-error" role="alert">Could not load usage: {error}</div>}

        {/* Top row */}
        <section aria-label="Totals">
          <div className="usg-tiles">
            <Tile
              label="Tokens left"
              value={balance ? formatTokens(balance.balance) : "…"}
              sub={balance ? (balance.out ? "Out of tokens: the analyst is paused" : balance.low ? "Running low" : `${full(balance.balance)} tokens`) : undefined}
              tone={balance?.out ? "out" : balance?.low ? "low" : undefined}
              title={balance ? `${full(balance.balance)} tokens` : undefined}
            />
            <Tile label={periodInfo.used} value={totals ? formatTokens(totals.tokens) : "…"} sub={totals ? `${full(totals.input)} in · ${full(totals.output)} out` : undefined} title={totals ? `${full(totals.tokens)} tokens` : undefined} />
            <Tile label="Used today" value={balance ? formatTokens(balance.usedToday) : "…"} sub={balance ? `${full(balance.usedToday)} tokens` : undefined} />
            <Tile label="Interactions" value={totals ? full(totals.interactions) : "…"} sub={period === "all" ? "all time" : periodInfo.label.toLowerCase()} />
            <Tile label="Average per interaction" value={totals ? formatTokens(totals.average) : "…"} sub="tokens" title={totals ? `${full(totals.average)} tokens` : undefined} />
            <Tile label="Estimated cost" value={totals ? `$${totals.cost.toFixed(2)}` : "…"} sub="estimate, USD" />
          </div>
          {totals && totals.estimatedShare > 0 && (
            <p className="usg-note">{pct(totals.estimatedShare, 1)} of the tokens in this period are estimates (demo mode, no model key).</p>
          )}
        </section>

        {/* Tokens per day */}
        <section className="usg-card" aria-labelledby="usg-daily">
          <div className="usg-card__head">
            <h2 id="usg-daily" className="usg-h2">Tokens per day</h2>
            <span className="im-text-description">{days.length ? `${formatDate(days[0].day)} to ${formatDate(days[days.length - 1].day)}` : rangeLabel(range)} · UTC days</span>
          </div>
          {summary ? <DailyChart days={days} series={series} topUps={topUps} /> : <div className="usg-empty usg-empty--chart">Loading…</div>}
        </section>

        {/* Where they went */}
        <section aria-labelledby="usg-where">
          <h2 id="usg-where" className="usg-h2 usg-h2--section">Where they went</h2>
          <div className="usg-where">
            <div className="usg-card">
              <h3 className="usg-h3">By kind</h3>
              <div className="usg-tblwrap">
                <table className="tbl usg-tbl">
                  <thead><tr><th>Kind</th><th className="num">Interactions</th><th className="num">Tokens</th><th>Share</th></tr></thead>
                  <tbody>
                    {(summary?.byKind ?? []).map((k) => (
                      <tr key={k.kind}>
                        <td><span className="row"><i className="dot" style={{ background: kindColor(k.kind) }} />{kindLabel(k.kind)}</span></td>
                        <td className="num">{full(k.interactions)}</td>
                        <td className="num" title={full(k.tokens)}>{formatTokens(k.tokens)}</td>
                        <td><Share value={k.tokens} total={total} color={kindColor(k.kind)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {summary && !summary.byKind.length && <p className="usg-empty">Nothing in this period.</p>}
              </div>
            </div>
            <div className="usg-card">
              <h3 className="usg-h3">By dashboard</h3>
              <div className="usg-tblwrap">
                <table className="tbl usg-tbl">
                  <thead><tr><th>Dashboard</th><th className="num">Interactions</th><th className="num">Tokens</th><th>Share</th><th>Last used</th></tr></thead>
                  <tbody>
                    {(summary?.byDashboard ?? []).map((d) => (
                      <tr key={d.dashboard_id ?? "none"}>
                        <td className="usg-name" title={d.name ?? undefined}>{d.dashboard_id && d.name ? <Link href={`/dashboard/${d.dashboard_id}`}>{d.name}</Link> : <span className="usg-muted">{d.dashboard_id ? "Deleted dashboard" : "No dashboard"}</span>}</td>
                        <td className="num">{full(d.interactions)}</td>
                        <td className="num" title={full(d.tokens)}>{formatTokens(d.tokens)}</td>
                        <td><Share value={d.tokens} total={total} /></td>
                        <td title={fmtTime(d.last_used)}>{relativeTime(d.last_used)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {summary && !summary.byDashboard.length && <p className="usg-empty">Nothing in this period.</p>}
              </div>
            </div>
            <div className="usg-card">
              <h3 className="usg-h3">By model</h3>
              <div className="usg-tblwrap">
                <table className="tbl usg-tbl">
                  <thead><tr><th>Model</th><th>Provider</th><th className="num">Interactions</th><th className="num">Tokens</th><th className="num">Cost</th></tr></thead>
                  <tbody>
                    {(summary?.byModel ?? []).map((m) => (
                      <tr key={`${m.provider}/${m.model}`}>
                        <td className="usg-name" title={m.model}><code>{m.model}</code></td>
                        <td>{m.provider}</td>
                        <td className="num">{full(m.interactions)}</td>
                        <td className="num" title={full(m.tokens)}>{formatTokens(m.tokens)}</td>
                        <td className="num" title={`$${m.cost.toFixed(4)}`}>{fmtCost(m.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {summary && !summary.byModel.length && <p className="usg-empty">Nothing in this period.</p>}
              </div>
            </div>
          </div>
        </section>

        {/* The log */}
        <section className="usg-card" aria-labelledby="usg-log">
          <div className="usg-card__head usg-card__head--wrap">
            <div>
              <h2 id="usg-log" className="usg-h2">The log</h2>
              <span className="im-text-description">Every interaction, newest first.</span>
            </div>
            <div className="usg-filters no-print">
              <label className="usg-filter">
                <span className="im-label">Dashboard</span>
                <select className="im-select" value={dashFilter} onChange={(e) => setDashFilter(e.target.value)}>
                  <option value="">All dashboards</option>
                  {dashOptions.map((d) => <option key={d.dashboard_id!} value={d.dashboard_id!}>{d.name ?? "Deleted dashboard"}</option>)}
                  {dashFilter && !dashOptions.some((d) => d.dashboard_id === dashFilter) && <option value={dashFilter}>{dashFilter}</option>}
                </select>
              </label>
              <label className="usg-filter">
                <span className="im-label">Kind</span>
                <select className="im-select" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
                  <option value="">All kinds</option>
                  {kindOptions.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
                </select>
              </label>
              <a className="im-btn im-btn-secondary im-btn-sm usg-export" href={exportHref} download>Export CSV</a>
            </div>
          </div>
          <div className="usg-tblwrap usg-tblwrap--log">
            <table className="tbl usg-tbl usg-log">
              <thead>
                <tr>
                  <th>Time</th><th>Dashboard</th><th>Kind</th><th>What was asked</th><th>Model</th>
                  <th className="num">Input</th><th className="num">Output</th><th className="num">Total</th><th className="num">Cost</th><th><span className="usg-sr">Tags</span></th>
                </tr>
              </thead>
              <tbody>
                {(events ?? []).map((e) => (
                  <tr key={e.id}>
                    <td className="usg-time" title={new Date(e.created_at).toLocaleString("en-GB")}>{fmtTime(e.created_at)}</td>
                    <td className="usg-name" title={e.dashboard_name ?? undefined}>{e.dashboard_id && e.dashboard_name ? <Link href={`/dashboard/${e.dashboard_id}`}>{e.dashboard_name}</Link> : <span className="usg-muted">{e.dashboard_id ? "Deleted dashboard" : "–"}</span>}</td>
                    <td><span className="row"><i className="dot" style={{ background: kindColor(e.kind) }} />{kindLabel(e.kind)}</span></td>
                    <td className="usg-label" title={e.label ?? undefined}>{e.label || <span className="usg-muted">–</span>}</td>
                    <td className="usg-model" title={`${e.provider} · ${e.model}`}>{e.model}</td>
                    <td className="num">{full(e.input_tokens)}</td>
                    <td className="num">{full(e.output_tokens)}</td>
                    <td className="num"><b>{full(e.total_tokens)}</b></td>
                    <td className="num" title={`$${e.cost_usd.toFixed(5)}`}>{fmtCostFine(e.cost_usd)}</td>
                    <td className="usg-tags">
                      {e.estimated && <span className="im-badge im-badge-warning" title="Estimated from text length (demo mode, no model key)">estimated</span>}
                      {e.automatic && <span className="im-badge" title="No person triggered this">automatic</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {events && events.length === 0 && (
              <p className="usg-empty">{dashFilter || kindFilter ? "No interactions match these filters in this period." : "No interactions in this period yet. Ask the analyst something on a dashboard."}</p>
            )}
            {!events && <p className="usg-empty">Loading…</p>}
          </div>
          {hasMore && (
            <div className="usg-more no-print">
              <button type="button" className="im-btn im-btn-secondary im-btn-sm" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "Loading…" : "Load more"}</button>
            </div>
          )}
        </section>

        {/* The statement */}
        <section className="usg-card" aria-labelledby="usg-statement">
          <div className="usg-card__head">
            <div>
              <h2 id="usg-statement" className="usg-h2">The statement</h2>
              <span className="im-text-description">Allowances, tokens added and daily usage, with the balance after each. All periods.</span>
            </div>
          </div>
          <div className="usg-tblwrap">
            <table className="tbl usg-tbl usg-statement">
              <thead><tr><th>Date</th><th>What</th><th className="num">Tokens</th><th className="num">Balance after</th></tr></thead>
              <tbody>
                {(statement ?? []).map((r, i) => (
                  <tr key={`${r.at}-${r.kind}-${i}`}>
                    <td className="usg-time">{r.kind === "usage" ? fmtDay(r.at) : fmtTime(r.at)}</td>
                    <td>{statementWhat(r)}</td>
                    <td className={`num ${r.tokens > 0 ? "usg-plus" : ""}`}>{r.tokens > 0 ? "+" : r.tokens < 0 ? "−" : ""}{full(Math.abs(r.tokens))}</td>
                    <td className="num">{full(r.balance_after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {statement && statement.length === 0 && <p className="usg-empty">No entries yet.</p>}
            {!statement && <p className="usg-empty">Loading…</p>}
          </div>
        </section>

        {/* What the numbers mean */}
        <footer className="usg-foot" aria-labelledby="usg-meaning">
          <h2 id="usg-meaning" className="usg-h3">What the numbers mean</h2>
          <ul>
            <li>Tokens are the provider&apos;s own counts, input plus output. Output includes the model&apos;s reasoning tokens where the provider bills them. Cached input counts at face value.</li>
            <li>Cost is an estimate from a price table in the app, not an invoice. It needs updating when model prices or the configured model change.</li>
            <li>In demo mode (no model key) every number is an estimate from text length, and is tagged &ldquo;estimated&rdquo;.</li>
            <li>Days and periods are in UTC; times in the log are in your local time.</li>
          </ul>
        </footer>
      </div>
      {adding && <AddTokensDialog onClose={() => setAdding(false)} />}
    </Shell>
  );
}
