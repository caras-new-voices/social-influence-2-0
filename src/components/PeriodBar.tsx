"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatMonth, formatWindow, formatDate, addDays, monthKey, monthPeriod, resolveCompare, resolveWindow, isWholeMonth, ISO_DATE, type PeriodState, type PeriodWindow } from "@/lib/period";
import { usePeriod } from "./PeriodContext";

const Ic = {
  left: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 5l-7 7 7 7" /></svg>,
  right: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5l7 7-7 7" /></svg>,
  cal: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>,
  cmp: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 18V9M10 18V5M16 18v-7M22 18H2" /></svg>,
  x: <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M6 6l12 12M18 6L6 18" /></svg>,
};

function fmtN(n: number) {
  return n.toLocaleString("en-US");
}

/**
 * The global period bar: month stepper, picker (months, custom range, presets), the coverage line
 * that states exactly which window is shown, and the comparison control.
 */
export function PeriodBar({ counts }: { counts?: { posts: number; comments: number } | null }) {
  const { state, window: win, compareWindow, setState, coverage } = usePeriod();
  const [open, setOpen] = useState<"period" | "compare" | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  const months = useMemo(() => coverage?.months ?? [], [coverage]);
  const withData = months.filter((m) => m.posts + m.comments > 0);
  const currentMonth = state.mode === "month" && state.start ? monthKey(state.start) : null;
  const idx = currentMonth ? withData.findIndex((m) => m.month === currentMonth) : -1;
  const canPrev = currentMonth ? idx > 0 : withData.length > 0;
  const canNext = currentMonth ? idx >= 0 && idx < withData.length - 1 : false;

  const go = (next: PeriodState) => { setState({ ...next, compare: next.compare === undefined ? state.compare ?? null : next.compare }); };
  const step = (dir: -1 | 1) => {
    if (!withData.length) return;
    if (!currentMonth) {
      // From all time, land on the latest complete month that has posts (not a stray partial tail).
      const landing = [...withData].reverse().find((m) => m.complete && m.posts > 0) ?? withData[withData.length - 1];
      go(monthPeriod(landing.month));
      return;
    }
    const m = withData[idx + dir];
    if (m) go(monthPeriod(m.month));
  };
  // keyboard: left/right step months when focus is not in an input
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft" && canPrev) step(-1);
      if (e.key === "ArrowRight" && canNext) step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPrev, canNext, currentMonth, idx, withData.length]);

  const title = state.mode === "all" ? "All time" : currentMonth ? formatMonth(currentMonth) : formatWindow(win);
  const partial = currentMonth ? months.find((m) => m.month === currentMonth && !m.complete) : null;
  const lastInMonth = currentMonth && coverage?.lastDate && monthKey(coverage.lastDate) === currentMonth ? coverage.lastDate : null;

  const coverageLine = (() => {
    if (!coverage) return "Loading coverage…";
    if (state.mode === "all") return `Viewing all data, ${coverage.firstDate ? formatDate(coverage.firstDate) : "?"} to ${coverage.lastDate ? formatDate(coverage.lastDate) : "?"}`;
    const w = resolveWindow(state);
    const base = `Viewing ${w.start ? formatDate(w.start) : "?"} to ${w.end ? formatDate(addDays(w.end, -1)) : "?"}`;
    return partial && lastInMonth ? `${base} · partial: data to ${formatDate(lastInMonth)}` : base;
  })();

  const compareLabel = (() => {
    if (!state.compare) return "Compare";
    const c = resolveCompare(state);
    if (!c) return "Compare";
    if (state.compare.mode === "previous") return `vs ${isWholeMonth(c.start!, c.end!) ? formatMonth(monthKey(c.start!), false) : "previous period"}`;
    if (state.compare.mode === "same_last_year") return `vs ${formatWindow(c)}`;
    return `vs ${formatWindow(c)}`;
  })();

  return (
    <div className="period" role="region" aria-label="Time period">
      <div className="period__nav">
        <button className="im-btn im-btn-ghost im-btn-icon" onClick={() => step(-1)} disabled={!canPrev} aria-label="Previous month" title="Previous month (←)">{Ic.left}</button>
        <button className="period__title" onClick={() => setOpen(open === "period" ? null : "period")} aria-haspopup="dialog" aria-expanded={open === "period"} title="Choose a period">
          {Ic.cal}<b>{title}</b>
        </button>
        <button className="im-btn im-btn-ghost im-btn-icon" onClick={() => step(1)} disabled={!canNext} aria-label="Next month" title="Next month (→)">{Ic.right}</button>
      </div>
      <div className="period__coverage" aria-live="polite">
        <span>{coverageLine}</span>
        {counts && <span className="period__counts">· {fmtN(counts.posts)} posts · {fmtN(counts.comments)} comments</span>}
        {compareWindow && <span className="period__cmp">· compared with {formatWindow(compareWindow)}</span>}
      </div>
      <div className="period__actions">
        <button className={`im-btn im-btn-sm ${state.compare ? "im-btn-primary" : "im-btn-secondary"}`} onClick={() => setOpen(open === "compare" ? null : "compare")} aria-haspopup="dialog" aria-expanded={open === "compare"} disabled={state.mode === "all" && !state.compare}>
          {Ic.cmp} {compareLabel}
        </button>
        {state.compare && <button className="im-btn im-btn-ghost im-btn-icon" onClick={() => go({ ...state, compare: null })} aria-label="Turn off comparison" title="Turn off comparison">{Ic.x}</button>}
        {state.mode !== "all" && <button className="im-btn im-btn-ghost im-btn-sm" onClick={() => go({ mode: "all", compare: null })}>All time</button>}
      </div>
      {open === "period" && (
        <div className="period__pop" ref={popRef} role="dialog" aria-label="Choose a period">
          <PeriodPicker state={state} months={months} onPick={(p) => { go(p); setOpen(null); }} lastDate={coverage?.lastDate ?? null} />
        </div>
      )}
      {open === "compare" && (
        <div className="period__pop period__pop--right" ref={popRef} role="dialog" aria-label="Compare with">
          <ComparePicker state={state} onPick={(p) => { go(p); setOpen(null); }} />
        </div>
      )}
    </div>
  );
}

function PeriodPicker({ state, months, onPick, lastDate }: { state: PeriodState; months: { month: string; posts: number; comments: number; complete: boolean }[]; onPick: (p: PeriodState) => void; lastDate: string | null }) {
  const [start, setStart] = useState(state.start ?? "");
  const [end, setEnd] = useState(state.end ? addDays(state.end, -1) : "");
  const years = Array.from(new Set(months.map((m) => m.month.slice(0, 4))));
  const current = state.mode === "month" && state.start ? monthKey(state.start) : null;
  const presets: Array<{ label: string; make: () => PeriodState }> = lastDate
    ? [
        { label: "Last 30 days of data", make: () => ({ mode: "range", start: addDays(lastDate, -29), end: addDays(lastDate, 1) }) },
        { label: "Last 90 days of data", make: () => ({ mode: "range", start: addDays(lastDate, -89), end: addDays(lastDate, 1) }) },
        { label: "Last 6 months", make: () => ({ mode: "range", start: `${monthKey(addDays(lastDate, -150))}-01`, end: addDays(lastDate, 1) }) },
        { label: "All time", make: () => ({ mode: "all" }) },
      ]
    : [{ label: "All time", make: () => ({ mode: "all" }) }];
  const validRange = ISO_DATE.test(start) && ISO_DATE.test(end) && start <= end;
  return (
    <div className="picker">
      <span className="im-micro-label">Months</span>
      {years.map((y) => (
        <div key={y} className="picker__year">
          <span className="picker__ylabel">{y}</span>
          <div className="picker__grid">
            {Array.from({ length: 12 }, (_, i) => ({ key: `${y}-${String(i + 1).padStart(2, "0")}`, i })).map(({ key, i }) => {
              const m = months.find((x) => x.month === key);
              const has = !!m && m.posts + m.comments > 0;
              return (
                <button key={key} className={`picker__month ${current === key ? "is-active" : ""} ${has ? "" : "is-empty"}`} disabled={!has} onClick={() => onPick(monthPeriod(key))} title={has ? `${fmtN(m!.posts)} posts · ${fmtN(m!.comments)} comments${m!.complete ? "" : " · partial"}` : "No data"}>
                  {new Date(Date.UTC(Number(y), i, 1)).toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}
                  {has && !m!.complete && <i className="picker__dot" aria-label="partial" />}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <span className="im-micro-label" style={{ marginTop: "0.6rem" }}>Custom range</span>
      <div className="row" style={{ gap: "0.4rem" }}>
        <input className="im-input" type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Start date" />
        <span className="im-text-description">to</span>
        <input className="im-input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="End date (inclusive)" />
        <button className="im-btn im-btn-primary im-btn-sm" disabled={!validRange} onClick={() => onPick({ mode: "range", start, end: addDays(end, 1) })}>Apply</button>
      </div>
      <span className="im-micro-label" style={{ marginTop: "0.6rem" }}>Presets</span>
      <div className="row" style={{ flexWrap: "wrap", gap: "0.35rem" }}>
        {presets.map((p) => <button key={p.label} className="followup" onClick={() => onPick(p.make())}>{p.label}</button>)}
      </div>
    </div>
  );
}

function ComparePicker({ state, onPick }: { state: PeriodState; onPick: (p: PeriodState) => void }) {
  const [start, setStart] = useState(state.compare?.start ?? "");
  const [end, setEnd] = useState(state.compare?.end ? addDays(state.compare.end, -1) : "");
  const main: PeriodWindow = resolveWindow(state);
  const hasMain = !!main.start && !!main.end;
  const prev = resolveCompare({ ...state, compare: { mode: "previous" } });
  const ly = resolveCompare({ ...state, compare: { mode: "same_last_year" } });
  const validRange = ISO_DATE.test(start) && ISO_DATE.test(end) && start <= end;
  return (
    <div className="picker">
      <span className="im-micro-label">Compare with</span>
      <button className={`picker__opt ${state.compare?.mode === "previous" ? "is-active" : ""}`} disabled={!hasMain} onClick={() => onPick({ ...state, compare: { mode: "previous" } })}>
        <b>Previous period</b><small>{prev ? formatWindow(prev) : "Pick a month or range first"}</small>
      </button>
      <button className={`picker__opt ${state.compare?.mode === "same_last_year" ? "is-active" : ""}`} disabled={!hasMain} onClick={() => onPick({ ...state, compare: { mode: "same_last_year" } })}>
        <b>Same period last year</b><small>{ly ? formatWindow(ly) : "Pick a month or range first"}</small>
      </button>
      <span className="im-micro-label" style={{ marginTop: "0.6rem" }}>Custom</span>
      <div className="row" style={{ gap: "0.4rem" }}>
        <input className="im-input" type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Compare start date" />
        <span className="im-text-description">to</span>
        <input className="im-input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Compare end date (inclusive)" />
        <button className="im-btn im-btn-primary im-btn-sm" disabled={!validRange} onClick={() => onPick({ ...state, compare: { mode: "custom", start, end: addDays(end, 1) } })}>Apply</button>
      </div>
      {state.compare && <button className="im-btn im-btn-ghost im-btn-sm" style={{ marginTop: "0.5rem" }} onClick={() => onPick({ ...state, compare: null })}>Turn off comparison</button>}
    </div>
  );
}
