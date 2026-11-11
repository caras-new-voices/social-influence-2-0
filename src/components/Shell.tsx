"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const Icon = {
  grid: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="8" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /><rect x="13" y="13" width="8" height="8" rx="2" /></svg>
  ),
  data: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>
  ),
  spark: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>
  ),
  video: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3z" /></svg>
  ),
  news: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h10M7 12h10M7 16h6" /></svg>
  ),
  bot: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="7" width="16" height="12" rx="3" /><circle cx="9" cy="13" r="1.2" /><circle cx="15" cy="13" r="1.2" /><path d="M12 7V3" /></svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
  ),
};

export function Shell({ title, actions, children, titleSlot }: { title: string; actions?: ReactNode; titleSlot?: ReactNode; children: ReactNode }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/dashboard") : path.startsWith(href));
  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="sidebar__logo">
          <div className="sidebar__mark">SI</div>
          <div>
            <div className="sidebar__title">Social Influence</div>
            <div className="sidebar__sub">IMAI workspace</div>
          </div>
        </div>
        <span className="im-micro-label sidebar__section">Workspace</span>
        <Link href="/" className={`nav-item ${active("/") ? "is-active" : ""}`}>{Icon.grid} Dashboards</Link>
        <Link href="/data" className={`nav-item ${active("/data") ? "is-active" : ""}`}>{Icon.data} Dataset</Link>
        <span className="im-micro-label sidebar__section">Other workspaces</span>
        <span className="nav-item is-muted" title="Available in IMAI">{Icon.search} Discovery</span>
        <span className="nav-item is-muted" title="Available in IMAI">{Icon.video} UGC</span>
        <span className="nav-item is-muted" title="Available in IMAI">{Icon.news} PR Workspace</span>
        <span className="nav-item is-muted" title="Available in IMAI">{Icon.bot} LLM Workspace</span>
        <div className="sidebar__foot">Proof of concept · P&amp;G Venus</div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar__title">
            {titleSlot ?? <h1>{title}</h1>}
          </div>
          <div className="topbar__actions">{actions}</div>
        </header>
        <main className="content" style={{ padding: 0 }}>{children}</main>
      </div>
    </div>
  );
}
