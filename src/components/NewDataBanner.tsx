"use client";
import { monthPeriod } from "@/lib/period";
import { usePeriod } from "./PeriodContext";
import { eventMonth, headline, latestDataEvent, previousMonth, shortMonth, useStoredNumber, usePeriodEvents, writeNumber } from "./usePeriodEvents";

/** "July 2026 data is in" banner above the period bar, dismissible per dashboard. */
export function NewDataBanner({ dashboardId }: { dashboardId: string }) {
  const events = usePeriodEvents();
  const key = `si.banner.dismissed.${dashboardId}`;
  const dismissed = useStoredNumber(key);
  const { setState } = usePeriod();
  const ev = latestDataEvent(events);
  if (!ev || ev.id <= dismissed) return null;
  const month = eventMonth(ev);
  const prev = previousMonth(month);
  const dismiss = () => writeNumber(key, ev.id);
  return (
    <div className="newdata" role="status">
      <span className="newdata__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /><path d="M9 15l2 2 4-4" /></svg>
      </span>
      <span className="newdata__text">{headline(ev)}</span>
      <span className="newdata__actions">
        <button className="im-btn im-btn-secondary im-btn-sm" onClick={() => setState(monthPeriod(month, null))}>View {shortMonth(month)}</button>
        <button className="im-btn im-btn-primary im-btn-sm" onClick={() => setState(monthPeriod(month, { mode: "previous" }))}>Compare with {shortMonth(prev)}</button>
        <button className="im-btn im-btn-ghost im-btn-icon newdata__close" onClick={dismiss} aria-label="Dismiss" title="Dismiss">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </span>
    </div>
  );
}
