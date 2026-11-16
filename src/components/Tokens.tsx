"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatTokens, USAGE_EVENT, type BalanceInfo, type UsageLine } from "@/lib/usage-shared";
import { AddTokensDialog } from "./AddTokensDialog";

/**
 * The account's token balance. Reloads after every interaction or top-up (USAGE_EVENT) and when
 * the tab regains focus. Pass a dashboard id to also get that dashboard's total for the month.
 */
export function useBalance(dashboardId?: string | null): BalanceInfo | null {
  const [info, setInfo] = useState<BalanceInfo | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => {
      fetch(`/api/usage/balance${dashboardId ? `?dashboard=${encodeURIComponent(dashboardId)}` : ""}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: BalanceInfo | null) => { if (live && j && typeof j.balance === "number") setInfo(j); })
        .catch(() => {});
    };
    load();
    window.addEventListener(USAGE_EVENT, load);
    window.addEventListener("focus", load);
    return () => {
      live = false;
      window.removeEventListener(USAGE_EVENT, load);
      window.removeEventListener("focus", load);
    };
  }, [dashboardId]);
  return info;
}

const n = (v: number) => Math.round(v).toLocaleString("en-US");

/** The line under an answer: what the interaction used and what is left. */
export function UsageNote({ usage, prefix }: { usage: UsageLine; prefix?: string }) {
  const title = `${n(usage.input)} tokens read, ${n(usage.output)} tokens written${usage.estimated ? ". Estimated from text length because no model key is set" : ""}. Balance after: ${n(usage.balance)}.`;
  return (
    <div className="tok-note" title={title}>
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v9M9.2 9.8h4.2a1.6 1.6 0 0 1 0 3.2h-2.8a1.6 1.6 0 0 0 0 3.2h4.2" /></svg>
      <span>
        {prefix ? `${prefix} ` : ""}
        {usage.estimated ? `About ${n(usage.total)} tokens (estimated)` : `${n(usage.total)} tokens`}
        {" · "}
        {n(usage.input)} in, {n(usage.output)} out
        {" · "}
        {formatTokens(usage.balance)} left
      </span>
    </div>
  );
}

/** Shown in place of an answer when the account has no tokens left. */
export function OutOfTokensCard({ message }: { message: string }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="tok-out" role="alert">
      <b>Out of tokens</b>
      <p>{message}</p>
      <div className="tok-out__actions">
        <button className="im-btn im-btn-primary im-btn-sm" onClick={() => setAdding(true)}>Add tokens</button>
        <Link className="im-btn im-btn-ghost im-btn-sm" href="/usage">See usage</Link>
      </div>
      {adding && <AddTokensDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

/** A slim notice above the composer when the balance is running low. */
export function LowTokensNotice({ info }: { info: BalanceInfo | null }) {
  const [adding, setAdding] = useState(false);
  if (!info || (!info.low && !info.out)) return null;
  return (
    <div className={`tok-low ${info.out ? "is-out" : ""}`} role="status">
      <span>{info.out ? "You are out of tokens. The analyst cannot answer until you add more." : `Running low: ${formatTokens(info.balance)} tokens left.`}</span>
      {info.canTopUp && <button className="im-btn im-btn-secondary im-btn-sm" onClick={() => setAdding(true)}>Add tokens</button>}
      {adding && <AddTokensDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

/** Header pill: the balance, with a popover for today's and this month's use and the top-up. */
export function TokenPill() {
  const info = useBalance();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  if (!info) return null;
  const state = info.out ? "is-out" : info.low ? "is-low" : "";
  return (
    <div className="tok" ref={ref}>
      <button
        className={`tok__pill ${state}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Token balance: ${n(info.balance)} tokens`}
        title="Token balance"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v9M9.2 9.8h4.2a1.6 1.6 0 0 1 0 3.2h-2.8a1.6 1.6 0 0 0 0 3.2h4.2" /></svg>
        <b>{formatTokens(info.balance)}</b>
        <span className="tok__unit">tokens</span>
      </button>
      {open && (
        <div className="tok__pop" role="dialog" aria-label="Token balance">
          <span className="im-micro-label">Balance</span>
          <div className="tok__big">{n(info.balance)}<small>tokens</small></div>
          {info.out && <p className="tok__warn">You are out of tokens. The analyst cannot answer until you add more.</p>}
          {!info.out && info.low && <p className="tok__warn">Running low. Add tokens so the analyst keeps answering.</p>}
          <dl className="tok__stats">
            <div><dt>Used today</dt><dd>{n(info.usedToday)}</dd></div>
            <div><dt>Used this month</dt><dd>{n(info.usedMonth)}</dd></div>
          </dl>
          <div className="tok__actions">
            {info.canTopUp && <button className="im-btn im-btn-primary im-btn-sm" onClick={() => { setOpen(false); setAdding(true); }}>Add tokens</button>}
            <Link className="im-btn im-btn-secondary im-btn-sm" href="/usage" onClick={() => setOpen(false)}>View usage</Link>
          </div>
        </div>
      )}
      {adding && <AddTokensDialog onClose={() => setAdding(false)} />}
    </div>
  );
}
