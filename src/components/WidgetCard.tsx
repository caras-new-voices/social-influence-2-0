"use client";
import { getWorkspace } from "@/lib/brands";
import { scopeKey } from "@/lib/scope-shared";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Row } from "@/lib/chart-data";
import { rowsToCsv } from "@/lib/format";
import { effectiveWindow, formatWindow, windowKey, type PeriodWindow, type WidgetPeriod } from "@/lib/period";
import { isDataWidget, type WidgetSpec } from "@/lib/widgets";
import { usePeriod } from "./PeriodContext";
import { useToast } from "./Toast";
import { WidgetBody } from "./WidgetBody";
import { WidgetInfo } from "./WidgetInfo";

export interface WidgetData {
  rows: Row[];
  /** Rows for the comparison window when comparison is on. */
  compareRows?: Row[];
  /** Size of the sample behind the element in its window, when the element declares one. */
  sample?: number;
  error?: string;
}

const cache = new Map<string, Promise<WidgetData>>();

// A dashboard has dozens of boxes. Asked for all at once they slow each other down until the slowest
// run out of time, so they are asked for a few at a time, in the order they appear on the page.
const MAX_AT_ONCE = 6;
let running = 0;
const waiting: Array<() => void> = [];
function inTurn<T>(work: () => Promise<T>, onStart?: () => void): Promise<T> {
  return new Promise<T>((resolve) => {
    const start = () => {
      running += 1;
      onStart?.();
      void work().then(resolve).finally(() => { running -= 1; waiting.shift()?.(); });
    };
    if (running < MAX_AT_ONCE) start(); else waiting.push(start);
  });
}
/** A failure worth one more try on its own: the query ran out of time or the connection dropped. */
const TRANSIENT = /timeout|timed out|failed to fetch|network|terminat|too many|ECONNRESET|503|504/i;

/**
 * What the page is loading, so it can say so: where each box is (waiting its turn, being worked
 * out, being tried a second time) and how far the whole page has got.
 */
export type LoadStage = "waiting" | "working" | "retrying";
export interface LoadProgress { total: number; done: number; failed: number }
const stages = new Map<string, LoadStage>();
let progress: LoadProgress = { total: 0, done: 0, failed: 0 };
const watchers = new Set<() => void>();
const tell = () => watchers.forEach((w) => w());
const watch = (w: () => void) => { watchers.add(w); return () => { watchers.delete(w); }; };
function began(key: string) {
  // A new batch starts when the last one has finished: count from nothing again.
  if (progress.done >= progress.total) progress = { total: 0, done: 0, failed: 0 };
  progress = { ...progress, total: progress.total + 1 };
  stages.set(key, "waiting");
  tell();
}
function stage(key: string, s: LoadStage) { stages.set(key, s); tell(); }
function ended(key: string, failed: boolean) {
  stages.delete(key);
  progress = { ...progress, done: progress.done + 1, failed: progress.failed + (failed ? 1 : 0) };
  tell();
}
const NO_PROGRESS: LoadProgress = { total: 0, done: 0, failed: 0 };
/** How far the page's boxes have got. */
export function useLoadProgress(): LoadProgress {
  return useSyncExternalStore(watch, () => progress, () => NO_PROGRESS);
}
const fetchKey = (sql: string, window?: PeriodWindow | null, compare?: PeriodWindow | null, sampleSql?: string) =>
  `${scopeKey(getWorkspace().scope ?? undefined)}|${windowKey(window)}|${windowKey(compare)}|${sql}|${sampleSql ?? ""}`;
/** Asks every box that failed to try again. */
export function retryFailed() {
  window.dispatchEvent(new Event("si:retry-failed"));
}

/** Drops cached results; call after new data is imported. */
export function clearWidgetCache() {
  cache.clear();
}

export function fetchWidgetRows(sql: string, window?: PeriodWindow | null, compare?: PeriodWindow | null, sampleSql?: string): Promise<WidgetData> {
  // The dashboard's brands come from the workspace of the page (set by WorkspaceProvider).
  const scope = getWorkspace().scope ?? undefined;
  const share = getWorkspace().shareToken;
  const key = fetchKey(sql, window, compare, sampleSql);
  if (!cache.has(key)) {
    began(key);
    // On a shared page the link says which dashboard, period and market: only the box is named.
    const ask = (): Promise<WidgetData> => fetch(share ? `/api/shared/${share}/data` : "/api/widgets/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(share ? { sql } : { sql, window: window && (window.start || window.end || window.market) ? window : undefined, compare: compare ?? undefined, sampleSql, scope }),
    })
      .then(async (r) => {
        const j = (await r.json()) as { rows?: Row[]; compareRows?: Row[]; sample?: number; error?: string };
        if (!r.ok) return { rows: [], error: j.error ?? "Query failed" };
        return { rows: j.rows ?? [], compareRows: j.compareRows, sample: j.sample };
      })
      .catch((e: Error) => ({ rows: [], error: e.message }));
    // One quiet second try when the first ran out of time: by then the rest of the page has loaded.
    const p = inTurn(ask, () => stage(key, "working")).then((res) => {
      if (!(res.error && TRANSIENT.test(res.error))) return res;
      stage(key, "retrying");
      return inTurn(ask);
    });
    cache.set(key, p);
    p.then((res) => { ended(key, !!res.error); if (res.error) cache.delete(key); });
  }
  return cache.get(key)!;
}

/**
 * Rows for a widget within the dashboard period (honouring the widget's own period override).
 * `preloaded` rows (from a chat proposal) are used as-is.
 */
export function useWidgetRows(spec: WidgetSpec, preloaded?: Row[]) {
  const period = usePeriod();
  const win = effectiveWindow(period.window, spec.period);
  const compare = spec.period && spec.period !== "inherit" ? null : period.compareWindow;
  // Bumped by "Try again" on a box that failed.
  const [attempt, setAttempt] = useState(0);
  const key = `${period.dataVersion}|${attempt}|${windowKey(win)}|${windowKey(compare)}|${spec.sql ?? ""}`;
  const needsFetch = !preloaded && !!spec.sql && isDataWidget(spec.type);
  const [result, setResult] = useState<{ key?: string; rows: Row[]; compareRows?: Row[]; sample?: number; error?: string }>({ rows: [] });
  useEffect(() => {
    if (!needsFetch || !spec.sql) return;
    let alive = true;
    fetchWidgetRows(spec.sql, win, compare, spec.sample?.sql).then((res) => alive && setResult({ key, rows: res.rows, compareRows: res.compareRows, sample: res.sample, error: res.error }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, needsFetch]);
  const retry = () => setAttempt((n) => n + 1);
  const failed = result.key === key && !!result.error;
  useEffect(() => {
    if (!failed) return;
    const again = () => setAttempt((n) => n + 1);
    window.addEventListener("si:retry-failed", again);
    return () => window.removeEventListener("si:retry-failed", again);
  }, [failed]);
  const fk = needsFetch && spec.sql ? fetchKey(spec.sql, win, compare, spec.sample?.sql) : "";
  const loadStage = useSyncExternalStore(watch, () => stages.get(fk) ?? "working", () => "working" as LoadStage);
  if (!needsFetch) return { rows: preloaded ?? [], compareRows: undefined, sample: undefined, loading: false, error: undefined, window: win, retry, loadStage: "working" as LoadStage };
  const fresh = result.key === key;
  return { retry, loadStage, rows: fresh ? result.rows : [], compareRows: fresh ? result.compareRows : undefined, sample: fresh ? result.sample : undefined, loading: !fresh, error: fresh ? result.error : undefined, window: win };
}

/** Small badge shown on elements that do not follow the dashboard period. */
export function PeriodBadge({ spec }: { spec: WidgetSpec }) {
  if (!spec.period || spec.period === "inherit") return null;
  const label = spec.period === "all" ? "All time" : formatWindow(spec.period);
  return <span className="im-badge widget__period" title={spec.period === "all" ? "This element ignores the dashboard period" : "This element is pinned to a fixed window"}>{label}</span>;
}

/** A box that is loading: a moving placeholder and a line that says what is happening. */
function LoadingBox({ stage }: { stage: LoadStage }) {
  // After a few seconds of work, say that it is a slow one and not a stuck one.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (stage === "waiting") return;
    const t = window.setTimeout(() => setSlow(true), 5000);
    return () => { window.clearTimeout(t); setSlow(false); };
  }, [stage]);
  const line = stage === "waiting" ? "Waiting its turn: boxes load a few at a time" : stage === "retrying" ? "That took too long. Trying once more…" : slow ? "Still working. The heavier boxes can take up to 20 seconds." : "Working it out…";
  return (
    <div className={`widget__loading widget__loading--${stage}`} role="status" aria-live="polite">
      <span className="widget__loadline">{stage !== "waiting" && <span className="spinner" />} {line}</span>
      <div className="widget__skeleton" aria-hidden="true"><i /><i /><i /><i /></div>
    </div>
  );
}

/** The page's own progress: how many boxes are in, and a way to retry the ones that failed. */
export function LoadBar() {
  const p = useLoadProgress();
  const loading = p.total > 0 && p.done < p.total;
  if (!loading && !p.failed) return null;
  return (
    <div className={`loadbar no-print ${loading ? "" : "loadbar--done"}`} role="status" aria-live="polite">
      {loading ? (
        <>
          <span className="spinner" />
          <span>Loading the boxes: {p.done} of {p.total} ready</span>
          <span className="loadbar__track" aria-hidden="true"><i style={{ width: `${Math.round((100 * p.done) / p.total)}%` }} /></span>
        </>
      ) : (
        <>
          <span>{p.failed === 1 ? "1 box could not be loaded." : `${p.failed} boxes could not be loaded.`}</span>
          <button className="im-btn im-btn-secondary im-btn-sm" onClick={retryFailed}>Try {p.failed === 1 ? "it" : "them"} again</button>
        </>
      )}
    </div>
  );
}

const I = {
  edit: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 20h4l10-10-4-4L4 16v4z" /><path d="M12.5 7.5l4 4" /></svg>,
  table: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M9 5v14" /></svg>,
  chart: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 19V5M4 19h16" /><path d="M8 15v-4M12 15V8M16 15v-6" /></svg>,
  trash: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>,
  spark: <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>,
  copy: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>,
  expand: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5" /></svg>,
};

function VoiceButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button className="widget__voice no-drag" onClick={onClick} aria-label={`Explain ${title} with AI voice`} title="Explain with AI voice">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/ai-voice.svg" alt="" />
    </button>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for contexts without the async clipboard API.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function WidgetCard({
  spec,
  onEdit,
  onRemove,
  onAsk,
  onChange,
  onExpand,
  onVoice,
  onSetPeriod,
}: {
  spec: WidgetSpec;
  /** Changes the element's own time window (used by the thin-data state to switch to all time). */
  onSetPeriod?: (p: WidgetPeriod) => void;
  onEdit: () => void;
  onRemove: () => void;
  onAsk: () => void;
  /** Starts a chat to change this element. */
  onChange?: () => void;
  onExpand: () => void;
  onVoice: (rows: Row[]) => void;
}) {
  const { rows, compareRows, sample, loading, error, window: win, retry, loadStage } = useWidgetRows(spec);
  const [tableView, setTableView] = useState(false);
  const [showAnyway, setShowAnyway] = useState(false);
  // Thin data: the element declares a minimum sample and the current window does not reach it,
  // or a period is selected and nothing falls inside it.
  const inPeriod = !!(win.start || win.end || win.market);
  const thin = !!spec.sample && sample !== undefined && sample < spec.sample.min;
  const empty = !loading && !error && rows.length === 0 && spec.type !== "insight";
  const blocked = !showAnyway && inPeriod && (thin || empty);
  const toast = useToast();
  const chartLike = ["bar", "stacked_bar", "line", "segmented", "kpi"].includes(spec.type);
  const showCopy = (tableView || spec.type === "table") && rows.length > 0;
  const copyCsv = async () => {
    const ok = await copyText(rowsToCsv(rows));
    toast(ok ? `Copied ${rows.length} rows as CSV` : "Could not copy to the clipboard");
  };

  if (spec.type === "section") {
    return (
      <div className="widget widget--section">
        <div className="section-head drag-handle">
          <h3>{spec.title}</h3>
          <VoiceButton title={spec.title} onClick={() => onVoice([])} />
          {spec.subtitle && <span className="widget__sub">{spec.subtitle}</span>}
          <span className="grow" />
          <span className="widget__actions no-drag">
            <button className="widget__ask" onClick={onAsk} aria-label={`Ask AI about ${spec.title}`}>{I.spark} Ask AI</button>
            <button className="im-btn im-btn-ghost im-btn-icon" onClick={onEdit} aria-label="Edit section">{I.edit}</button>
            <button className="im-btn im-btn-ghost im-btn-icon" onClick={onRemove} aria-label="Remove section">{I.trash}</button>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="widget">
      <VoiceButton title={spec.title} onClick={() => onVoice(rows)} />
      <div className="widget__head drag-handle">
        <div className="grow">
          <div className="widget__title">
            {spec.title}{" "}
            <WidgetInfo spec={spec} rows={rows} periodLabel={formatWindow(win)} onAsk={onAsk} onChange={onChange ?? onAsk} /> <PeriodBadge spec={spec} />
          </div>
          {spec.subtitle && <div className="widget__sub">{spec.subtitle}</div>}
        </div>
        <div className="widget__toolbar no-drag">
          <button className="widget__ask" onClick={onAsk} aria-label={`Ask AI about ${spec.title}`} title="Chat with the analyst about this element">{I.spark} Ask AI</button>
          <div className="widget__actions">
          <button className="im-btn im-btn-ghost im-btn-icon" onClick={onExpand} aria-label="Expand to full screen" title="Expand">{I.expand}</button>
          {showCopy && (
            <button className="im-btn im-btn-ghost im-btn-icon" onClick={() => void copyCsv()} aria-label="Copy table as CSV" title="Copy table as CSV">{I.copy}</button>
          )}
          {chartLike && (
            <button className="im-btn im-btn-ghost im-btn-icon" onClick={() => setTableView((v) => !v)} aria-label={tableView ? "Show chart" : "Show as table"} title={tableView ? "Show chart" : "Show as table"}>
              {tableView ? I.chart : I.table}
            </button>
          )}
          <button className="im-btn im-btn-ghost im-btn-icon" onClick={onEdit} aria-label="Edit widget" title="Edit">{I.edit}</button>
          <button className="im-btn im-btn-ghost im-btn-icon" onClick={onRemove} aria-label="Remove widget" title="Remove">{I.trash}</button>
          </div>
        </div>
      </div>
      <div className="widget__body no-drag">
        {loading ? (
          <LoadingBox stage={loadStage} />
        ) : error ? (
          <div className="widget__state widget__state--error" role="alert">
            <span>{TRANSIENT.test(error) ? "This box took too long to load." : "This box could not be loaded."}</span>
            <button className="im-btn im-btn-secondary im-btn-sm" onClick={retry}>Try again</button>
            <span className="widget__errdetail">{error}</span>
          </div>
        ) : blocked ? (
          <div className="widget__thin" role="status">
            <b>{empty ? `Nothing in ${formatWindow(win)} for this element` : `Not enough ${spec.sample!.unit} in ${formatWindow(win)}`}</b>
            {!empty && <span>{sample} of the {spec.sample!.min} needed for a reliable read.</span>}
            <div className="row" style={{ gap: "0.4rem", justifyContent: "center" }}>
              {onSetPeriod && (win.start || win.end) && <button className="im-btn im-btn-secondary im-btn-sm" onClick={() => onSetPeriod("all")}>Show all time instead</button>}
              {!empty && <button className="im-btn im-btn-ghost im-btn-sm" onClick={() => setShowAnyway(true)}>Show anyway</button>}
            </div>
          </div>
        ) : (
          <>
            {thin && <div className="widget__thinnote">Small sample: {sample} {spec.sample!.unit}{inPeriod ? ` in ${formatWindow(win)}` : ""}.</div>}
            <WidgetBody spec={spec} rows={rows} compareRows={compareRows} tableView={tableView} />
          </>
        )}
      </div>
    </div>
  );
}
