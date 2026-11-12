"use client";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatMonth, monthPeriod } from "@/lib/period";
import { usePeriod } from "./PeriodContext";
import { countsText, eventMonth, KIND_LABEL, relativeTime, SEEN_KEY, useStoredNumber, usePeriodEvents, writeNumber, type PeriodEvent } from "./usePeriodEvents";

/** Header bell: unread period events (new months, revisions, missing data). */
export function NotificationBell() {
  const path = usePathname();
  const dashboardId = /^\/dashboard\/([^/?#]+)/.exec(path)?.[1] ?? null;
  const events = usePeriodEvents();
  const seen = useStoredNumber(SEEN_KEY);
  const period = usePeriod();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const list = events ?? [];
  const unread = list.filter((e) => e.id > seen).length;
  const topId = list[0]?.id ?? 0;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Opening the popover marks everything listed as seen; new events arriving while open count too.
  useEffect(() => {
    if (open && topId > seen) writeNumber(SEEN_KEY, topId);
  }, [open, topId, seen]);

  const href = (e: PeriodEvent) => (dashboardId ? `/dashboard/${dashboardId}?period=${eventMonth(e)}&compare=prev` : "/");
  const go = (e: PeriodEvent, ev: React.MouseEvent) => {
    setOpen(false);
    // On a dashboard the period provider changes the period in place (and mirrors it in the URL).
    if (dashboardId && !ev.metaKey && !ev.ctrlKey) {
      ev.preventDefault();
      period.setState(monthPeriod(eventMonth(e), { mode: "previous" }));
    }
  };

  return (
    <div className="bell" ref={ref}>
      <button
        className="im-btn im-btn-ghost im-btn-icon bell__btn"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Data updates"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
        {unread > 0 && <span className="bell__dot">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="bell__pop" role="dialog" aria-label="Data updates">
          <div className="bell__head">
            <b>Data updates</b>
            <span className="im-text-description">{list.length ? `${list.length} recent` : ""}</span>
          </div>
          {events === null && <div className="bell__empty">Loading…</div>}
          {events !== null && list.length === 0 && <div className="bell__empty">No data updates yet. New months appear here when an import lands.</div>}
          <ul className="bell__list">
            {list.map((e) => (
              <li key={e.id} className={`bell__item ${e.id > seen ? "is-unread" : ""}`}>
                <a href={href(e)} onClick={(ev) => go(e, ev)}>
                  <span className={`bell__kind bell__kind--${e.kind}`}>{KIND_LABEL[e.kind] ?? e.kind}</span>
                  <span className="bell__title">{e.summary.label || formatMonth(eventMonth(e))}</span>
                  <span className="bell__counts">{countsText(e)}</span>
                  <span className="bell__meta">{relativeTime(e.created_at)}{e.import?.source ? ` · ${e.import.source}` : ""}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
