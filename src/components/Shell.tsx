"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore, type ReactNode } from "react";
import { NotificationBell } from "./NotificationBell";

const Icon = {
  grid: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="8" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /><rect x="13" y="13" width="8" height="8" rx="2" /></svg>
  ),
  data: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>
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
  chevron: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 5l-7 7 7 7" /></svg>
  ),
};

/* Sidebar state lives in localStorage so the choice sticks across pages and reloads. */
const KEY = "si.sidebar";
const listeners = new Set<() => void>();
function readStored(): "open" | "closed" | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "open" || v === "closed" ? v : null;
  } catch {
    return null;
  }
}
function writeStored(v: "open" | "closed") {
  try {
    window.localStorage.setItem(KEY, v);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function useSidebarCollapsed(defaultCollapsed: boolean): [boolean, () => void] {
  const stored = useSyncExternalStore(subscribe, readStored, () => null);
  const collapsed = stored === null ? defaultCollapsed : stored === "closed";
  const toggle = () => writeStored(collapsed ? "open" : "closed");
  return [collapsed, toggle];
}

export function Shell({ title, actions, children, titleSlot }: { title: string; actions?: ReactNode; titleSlot?: ReactNode; children: ReactNode }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/dashboard") : path.startsWith(href));
  const [collapsed, toggle] = useSidebarCollapsed(path.startsWith("/dashboard"));

  const item = (label: string, icon: ReactNode, href?: string, isActive = false) => {
    const cls = `nav-item ${isActive ? "is-active" : ""} ${href ? "" : "is-muted"}`;
    const inner = (
      <>
        {icon}
        <span className="nav-item__label">{label}</span>
      </>
    );
    return href ? (
      <Link key={label} href={href} className={cls} title={collapsed ? label : undefined} aria-label={label}>{inner}</Link>
    ) : (
      <span key={label} className={cls} title={collapsed ? `${label} (available in IMAI)` : "Available in IMAI"}>{inner}</span>
    );
  };

  return (
    <div className={`shell ${collapsed ? "shell--collapsed" : ""}`}>
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="sidebar__logo">
          <div className="sidebar__mark">SI</div>
          <div className="sidebar__brand">
            <div className="sidebar__title">Social Influence</div>
            <div className="sidebar__sub">IMAI workspace</div>
          </div>
          <button className="sidebar__toggle" onClick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand" : "Collapse"}>
            {Icon.chevron}
          </button>
        </div>
        <span className="im-micro-label sidebar__section">Workspace</span>
        {item("Dashboards", Icon.grid, "/", active("/"))}
        {item("Dataset", Icon.data, "/data", active("/data"))}
        <span className="im-micro-label sidebar__section">Other workspaces</span>
        {item("Discovery", Icon.search)}
        {item("UGC", Icon.video)}
        {item("PR Workspace", Icon.news)}
        {item("LLM Workspace", Icon.bot)}
        <div className="sidebar__foot">Proof of concept · P&amp;G Venus</div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar__title">{titleSlot ?? <h1>{title}</h1>}</div>
          <div className="topbar__actions"><NotificationBell />{actions}</div>
        </header>
        <main className="content" style={{ padding: 0 }}>{children}</main>
      </div>
    </div>
  );
}
