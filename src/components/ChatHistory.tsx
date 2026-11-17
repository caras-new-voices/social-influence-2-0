"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatSession } from "@/lib/chat-sessions";
import { relativeTime } from "@/lib/format";
import { formatTokens } from "@/lib/usage-shared";
import { useConfirm } from "./Confirm";

const SEARCH_FROM = 8;

/** Today, Yesterday, Last 7 days, Earlier: by the day the chat was last used, in local time. */
function groupOf(iso: string, now: Date): string {
  const d = new Date(iso);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Last 7 days";
  return "Earlier";
}
const GROUPS = ["Today", "Yesterday", "Last 7 days", "Earlier"];

export const ChatIcons = {
  newChat: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" /><path d="M17.5 3.5a2.1 2.1 0 0 1 3 3L13 14l-4 1 1-4z" /></svg>,
  history: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 7v5l3 2" /></svg>,
  back: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>,
  pin: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 4h6l-1 5 3 3H7l3-3z" /><path d="M12 15v5" /></svg>,
  more: <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>,
  close: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>,
};

/**
 * The list of a dashboard's chats: grouped by when they were last used, searchable once there
 * are more than a few, with rename and delete per chat. Shown over the conversation, or pinned
 * beside it on very wide screens.
 */
export function ChatHistory({
  dashboardId,
  currentId,
  refreshKey,
  busy,
  pinned,
  canPin,
  onOpen,
  onDeleted,
  onRenamed,
  onClose,
  onTogglePin,
  onNewChat,
}: {
  dashboardId: string;
  currentId: string | null;
  /** Changes when a chat was created or used, so the list reloads. */
  refreshKey: string;
  busy: boolean;
  pinned: boolean;
  canPin: boolean;
  onOpen: (s: ChatSession) => void;
  onDeleted: (id: string) => void;
  onRenamed: (s: ChatSession) => void;
  onClose?: () => void;
  onTogglePin?: () => void;
  onNewChat: () => void;
}) {
  const [sessions, setSessions] = useState<ChatSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const confirmDialog = useConfirm();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/dashboards/${dashboardId}/sessions`)
      .then((r) => r.json())
      .then((j: { sessions?: ChatSession[]; error?: string }) => {
        if (!alive) return;
        if (j.sessions) setSessions(j.sessions);
        else setError(j.error ?? "Could not load the chats");
      })
      .catch(() => alive && setError("Could not load the chats"));
    return () => {
      alive = false;
    };
  }, [dashboardId, refreshKey]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".hist__menu, .hist__more")) setMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (sessions ?? []).filter((s) => !q || s.title.toLowerCase().includes(q));
  }, [sessions, query]);
  const grouped = useMemo(() => {
    const now = new Date();
    const by = new Map<string, ChatSession[]>();
    for (const s of shown) {
      const g = groupOf(s.updatedAt, now);
      by.set(g, [...(by.get(g) ?? []), s]);
    }
    return GROUPS.filter((g) => by.has(g)).map((g) => ({ group: g, items: by.get(g)! }));
  }, [shown]);

  const rename = async (id: string, title: string) => {
    setRenaming(null);
    const clean = title.trim();
    if (!clean) return;
    const r = await fetch(`/api/sessions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: clean }) });
    const j = (await r.json().catch(() => ({}))) as { session?: ChatSession };
    if (j.session) {
      setSessions((list) => (list ?? []).map((s) => (s.id === id ? { ...s, title: j.session!.title } : s)));
      onRenamed(j.session);
    }
  };

  const remove = async (s: ChatSession) => {
    setMenu(null);
    const ok = await confirmDialog({
      title: "Delete this chat?",
      message: `"${s.title}" and its answers will be removed. Elements already on the dashboard stay.`,
      confirmLabel: "Delete chat",
      danger: true,
    });
    if (!ok) return;
    await fetch(`/api/sessions/${s.id}`, { method: "DELETE" });
    setSessions((list) => (list ?? []).filter((x) => x.id !== s.id));
    onDeleted(s.id);
  };

  return (
    <div className={`hist ${pinned ? "hist--pinned" : ""}`} role="region" aria-label="Chat history">
      <div className="hist__head">
        {!pinned && onClose && (
          <button className="im-btn im-btn-ghost im-btn-icon" onClick={onClose} aria-label="Back to the chat" title="Back to the chat">{ChatIcons.back}</button>
        )}
        <b className="grow">Chats</b>
        {canPin && onTogglePin && (
          <button className={`im-btn im-btn-ghost im-btn-icon ${pinned ? "is-on" : ""}`} onClick={onTogglePin} aria-pressed={pinned} title={pinned ? "Unpin the chat list" : "Keep the chat list open beside the chat"} aria-label={pinned ? "Unpin the chat list" : "Pin the chat list"}>{ChatIcons.pin}</button>
        )}
        {pinned && (
          <button className="im-btn im-btn-ghost im-btn-icon" onClick={onNewChat} disabled={busy} title={busy ? "Wait for the answer to finish" : "New chat"} aria-label="New chat">{ChatIcons.newChat}</button>
        )}
      </div>
      {(sessions?.length ?? 0) > SEARCH_FROM && (
        <input ref={searchRef} className="im-input hist__search" type="search" placeholder="Search chats" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search chats" />
      )}
      <div className="hist__list">
        {error && <div className="hist__empty">{error}</div>}
        {!error && sessions === null && <div className="hist__empty"><span className="spinner" /></div>}
        {sessions !== null && sessions.length === 0 && <div className="hist__empty">No chats yet. Ask a question to start one.</div>}
        {sessions !== null && sessions.length > 0 && shown.length === 0 && <div className="hist__empty">No chat matches “{query}”.</div>}
        {grouped.map(({ group, items }) => (
          <div key={group} className="hist__group">
            <div className="hist__label">{group}</div>
            {items.map((s) => (
              <div key={s.id} className={`hist__row ${s.id === currentId ? "is-current" : ""}`}>
                {renaming?.id === s.id ? (
                  <input
                    className="im-input hist__rename"
                    autoFocus
                    value={renaming.title}
                    maxLength={120}
                    onChange={(e) => setRenaming({ id: s.id, title: e.target.value })}
                    onBlur={() => void rename(s.id, renaming.title)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void rename(s.id, renaming.title);
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    aria-label="Chat title"
                  />
                ) : (
                  <button
                    className="hist__open"
                    onClick={() => onOpen(s)}
                    disabled={busy && s.id !== currentId}
                    title={busy && s.id !== currentId ? "Wait for the answer to finish" : s.title}
                    aria-current={s.id === currentId ? "true" : undefined}
                  >
                    <span className="hist__title">
                      {s.kind === "element" && <span className="hist__tag">Element</span>}
                      {s.kind === "setup" && <span className="hist__tag">Setup</span>}
                      {s.title}
                    </span>
                    <span className="hist__meta">
                      {relativeTime(s.updatedAt)}
                      {s.questions > 0 ? ` · ${s.questions} ${s.questions === 1 ? "question" : "questions"}` : ""}
                      {s.tokens > 0 ? ` · ${formatTokens(s.tokens)} tokens` : ""}
                    </span>
                  </button>
                )}
                {renaming?.id !== s.id && (
                  <button className="hist__more im-btn im-btn-ghost im-btn-icon" onClick={() => setMenu(menu === s.id ? null : s.id)} aria-label={`More for ${s.title}`} aria-expanded={menu === s.id} title="Rename or delete">{ChatIcons.more}</button>
                )}
                {menu === s.id && (
                  <div className="hist__menu" role="menu">
                    <button role="menuitem" onClick={() => { setMenu(null); setRenaming({ id: s.id, title: s.title }); }}>Rename</button>
                    <button role="menuitem" className="is-danger" onClick={() => void remove(s)} disabled={busy && s.id === currentId}>Delete</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
