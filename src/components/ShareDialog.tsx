"use client";
import { useEffect, useState } from "react";
import { formatWindow, resolveWindow, type PeriodState } from "@/lib/period";
import { LEADER_VIEWS } from "@/lib/tom8";
import { useToast } from "./Toast";

interface Link { token: string; createdAt: string; period: PeriodState | null; view: "summary" | "full"; leader: string | null }

const urlOf = (token: string) => `${window.location.origin}/shared/${token}`;
function describe(l: { period: PeriodState | null; view: string; leader: string | null }): string {
  const w = resolveWindow(l.period);
  const who = LEADER_VIEWS.find((x) => x.id === l.leader)?.label;
  return `${l.view === "summary" ? (who ? `Summary: ${who}` : "Summary") : "Everything"} · ${formatWindow(w)}${w.market ? "" : " · all markets"}`;
}

/**
 * Share a view of the dashboard as a link that can only look. The link has its own key: it opens
 * this dashboard's boxes for the period and market shown, and can reach nothing else. It can be
 * switched off here at any time.
 */
export function ShareDialog({ dashboardId, period, view, leader, onClose }: { dashboardId: string; period: PeriodState; view: "summary" | "full"; leader: string | null; onClose: () => void }) {
  const toast = useToast();
  const [links, setLinks] = useState<Link[] | null>(null);
  const [locked, setLocked] = useState<boolean | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`/api/dashboards/${dashboardId}/share`).then((r) => r.json()).then((j: { links?: Link[]; siteLocked?: boolean }) => { if (live) { setLinks(j.links ?? []); setLocked(!!j.siteLocked); } }).catch(() => { if (live) setLinks([]); });
    return () => { live = false; };
  }, [dashboardId]);
  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(urlOf(token));
      toast("Link copied");
    } catch {
      window.prompt("Copy this link", urlOf(token));
    }
  };
  const create = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/dashboards/${dashboardId}/share`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period: period.mode === "all" && !period.compare && !period.market ? null : period, view, leader }) });
      const j = (await r.json()) as { link?: Link; links?: Link[]; error?: string };
      if (!r.ok || !j.link) throw new Error(j.error ?? "Could not make the link");
      setLinks(j.links ?? []);
      setFresh(j.link.token);
      await copy(j.link.token);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (token: string) => {
    const r = await fetch(`/api/dashboards/${dashboardId}/share?token=${encodeURIComponent(token)}`, { method: "DELETE" });
    const j = (await r.json().catch(() => ({}))) as { links?: Link[] };
    setLinks(j.links ?? []);
    if (fresh === token) setFresh(null);
    toast("Link switched off");
  };
  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Share this view">
        <div className="modal__head"><h3 className="im-text-header">Share this view</h3><button className="im-btn im-btn-ghost im-btn-sm" onClick={onClose}>Close</button></div>
        <div className="modal__body share">
          <p>A link that can only look. It opens this dashboard with the period and market on screen now ({describe({ period, view, leader })}). Whoever has it cannot change anything, cannot use the chat, and cannot reach your other dashboards through it.</p>
          <div className="row" style={{ gap: "0.5rem" }}>
            <button className="im-btn im-btn-primary" onClick={() => void create()} disabled={busy}>{busy ? "Making the link…" : "Make a link and copy it"}</button>
          </div>
          {fresh && <input className="im-input share__url" readOnly value={urlOf(fresh)} onFocus={(e) => e.currentTarget.select()} aria-label="The link" />}
          {locked === false && (
            <p className="share__warn" role="note">
              <b>The rest of the site is not locked.</b> The link itself cannot edit anything. But the site has no passcode, so someone who works out its main address can open and change dashboards there. To close that, set <code>SITE_PASSCODE</code> in the site&apos;s Vercel settings: the site then asks for it once per browser, and shared links keep working without it.
            </p>
          )}
          {locked && <p className="im-text-description">The site is locked with a passcode. Shared links open without it; everything else asks for it.</p>}
          <h4 className="im-text-sub-header">Links that are switched on</h4>
          {links === null && <p className="im-text-description">Looking…</p>}
          {links && links.length === 0 && <p className="im-text-description">None yet.</p>}
          {links && links.length > 0 && (
            <ul className="share__list">
              {links.map((l) => (
                <li key={l.token}>
                  <span><b>{describe(l)}</b><br /><span className="im-text-description">Made {new Date(l.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span></span>
                  <span className="row" style={{ gap: "0.35rem" }}>
                    <button className="im-btn im-btn-secondary im-btn-sm" onClick={() => void copy(l.token)}>Copy</button>
                    <button className="im-btn im-btn-ghost im-btn-sm" onClick={() => void revoke(l.token)}>Switch off</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
