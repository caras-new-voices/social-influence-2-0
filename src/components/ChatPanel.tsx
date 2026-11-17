"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatEvent, DisplayMessage, WidgetSummary } from "@/lib/claude";
import { FOCUS_QUESTIONS, INTENTS, questionAboutWidget, START_SCAN_INSTRUCTION, START_SCAN_LABEL, STARTER_QUESTIONS, type WidgetSpec } from "@/lib/widgets";
import type { PeriodState } from "@/lib/period";
import { usePeriod } from "./PeriodContext";
import { useWorkspace } from "./WorkspaceProvider";
import { ProposalCard, type Proposal } from "./ProposalCard";
import { eventMonth, latestDataEvent, previousMonth, useStoredNumber, usePeriodEvents, writeNumber } from "./usePeriodEvents";
import { Markdown } from "./WidgetBody";
import { formatMonth } from "@/lib/period";
import { announceUsage, formatTokens, OUT_OF_TOKENS, type UsageKind, type UsageLine } from "@/lib/usage-shared";
import { LowTokensNotice, OutOfTokensCard, UsageNote, useBalance } from "./Tokens";
import type { ChatSession } from "@/lib/chat-sessions";
import { ChatHistory, ChatIcons } from "./ChatHistory";

type PanelWidth = "collapsed" | "normal" | "wide";
const WIDTH_KEY = "si.chat.width";
const PIN_KEY = "si.chat.historyPinned";
const PIN_MIN_WIDTH = 1600;

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private windows); the setting then lasts for this page only.
  }
}

function toUi(m: DisplayMessage): UiMessage {
  return {
    id: String(m.id),
    role: m.role,
    content: m.content,
    proposals: (m.proposals ?? []).map((p) => ({ widget: p.widget, replaces: p.replaces })),
    queries: [],
    followups: m.followups ?? [],
    usage: m.usage ?? undefined,
  };
}

const PanelIcons = {
  wide: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" /></svg>,
  narrow: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h7M21 12h-7M7 8l4 4-4 4M17 8l-4 4 4 4" /></svg>,
  collapse: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 10l-2 2 2 2" /></svg>,
  expand: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M13 10l2 2-2 2" /></svg>,
  chevron: <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>,
};

interface QueryLog { sql: string; ok: boolean; rows?: number; error?: string }
interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  proposals: Proposal[];
  queries: QueryLog[];
  followups: string[];
  status?: string;
  streaming?: boolean;
  error?: string;
  /** Set when the turn was refused because the account has no tokens. */
  outOfTokens?: boolean;
  usage?: UsageLine;
}

export function ChatPanel({
  dashboardId,
  widgets,
  demoMode,
  onAddWidget,
  prefill,
  onPrefillConsumed,
  ask,
  scope,
  onSetPeriod,
}: {
  dashboardId: string;
  widgets: WidgetSpec[];
  demoMode: boolean;
  onAddWidget: (widget: WidgetSpec, replaces?: string) => void;
  prefill?: string;
  onPrefillConsumed: () => void;
  /** A programmatic question (from an element's Ask AI button); nonce changes on every click. */
  ask?: { text: string; instruction: string; nonce: number; kind?: UsageKind };
  /** Focused mode: every question is about one element; history is not loaded. */
  scope?: { widget: WidgetSpec };
  /** Called when the analyst changes the dashboard period (set_period tool). */
  onSetPeriod?: (p: PeriodState) => void;
}) {
  const period = usePeriod();
  const ws = useWorkspace();
  const tokens = useBalance(dashboardId);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [intent, setIntent] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // The open chat session. null means a new chat: the first message creates the session.
  const [session, setSession] = useState<{ id: string; title: string } | null>(null);
  const sessionRef = useRef<string | null>(null);
  sessionRef.current = session?.id ?? null;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyKey, setHistoryKey] = useState("0");
  const [width, setWidthState] = useState<PanelWidth>("normal");
  const [pinned, setPinnedState] = useState(false);
  const [wideScreen, setWideScreen] = useState(false);
  useEffect(() => {
    if (scope) return;
    const w = readStored(WIDTH_KEY);
    if (w === "collapsed" || w === "wide" || w === "normal") setWidthState(w);
    setPinnedState(readStored(PIN_KEY) === "1");
    const mq = window.matchMedia(`(min-width: ${PIN_MIN_WIDTH}px)`);
    const on = () => setWideScreen(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [scope]);
  const setWidth = (w: PanelWidth) => {
    setWidthState(w);
    writeStored(WIDTH_KEY, w);
  };
  const setPinned = (p: boolean) => {
    setPinnedState(p);
    writeStored(PIN_KEY, p ? "1" : "0");
    if (p) setHistoryOpen(false);
  };
  const showPinned = !scope && pinned && wideScreen && width !== "collapsed";

  // A dashboard opens on its most recently used chat.
  useEffect(() => {
    if (scope) return;
    fetch(`/api/dashboards/${dashboardId}/messages`)
      .then((r) => r.json())
      .then((j: { session?: ChatSession | null; messages: DisplayMessage[] }) => {
        setSession(j.session ? { id: j.session.id, title: j.session.title } : null);
        seenCount.current = 0;
        setMessages(j.messages.map(toUi));
      })
      .catch(() => {});
  }, [dashboardId, scope]);

  const openSession = async (s: ChatSession) => {
    setHistoryOpen(false);
    if (s.id === sessionRef.current) return;
    setSession({ id: s.id, title: s.title });
    setDismissed(new Set());
    seenCount.current = 0;
    setMessages([]);
    const r = await fetch(`/api/sessions/${s.id}`);
    const j = (await r.json().catch(() => ({}))) as { messages?: DisplayMessage[] };
    if (sessionRef.current === s.id) setMessages((j.messages ?? []).map(toUi));
  };
  const newChat = () => {
    if (busy) return;
    setSession(null);
    setMessages([]);
    setDismissed(new Set());
    setIntent(null);
    setHistoryOpen(false);
    seenCount.current = 0;
    if (width === "collapsed") setWidth("normal");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (prefill) {
      setHistoryOpen(false);
      if (width === "collapsed") setWidth("normal");
      setInput(prefill);
      inputRef.current?.focus();
      onPrefillConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, onPrefillConsumed]);

  // Scroll behaviour: on history load jump to the end; when a new question is sent, anchor that
  // question at the top of the panel and then leave the scroll alone while the answer streams,
  // so the person can read from the start and scroll freely.
  const seenCount = useRef(0);
  const spacerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    const spacer = spacerRef.current;
    if (!el) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const node = lastUser ? document.getElementById(`msg-${lastUser.id}`) : null;
    // A trailing spacer keeps the latest question scrollable to the top while its answer is still short.
    if (spacer && node && seenCount.current > 0) {
      const contentBelowQuestion = el.scrollHeight - spacer.offsetHeight - node.offsetTop;
      spacer.style.height = `${Math.max(0, el.clientHeight - contentBelowQuestion - 16)}px`;
    }
    if (messages.length > seenCount.current) {
      if (seenCount.current === 0) {
        el.scrollTop = el.scrollHeight;
      } else if (node) {
        el.scrollTop = Math.max(0, node.offsetTop - 12);
      }
    }
    seenCount.current = messages.length;
  }, [messages]);

  const sendRef = useRef<(text: string, instruction?: string, kind?: UsageKind) => Promise<void>>(async () => {});
  useEffect(() => {
    if (!ask) return;
    setHistoryOpen(false);
    setWidthState((w) => (w === "collapsed" ? "normal" : w));
    const t = setTimeout(() => void sendRef.current(ask.text, ask.instruction, ask.kind ?? "ask_element"), 0);
    return () => clearTimeout(t);
  }, [ask]);

  const send = useCallback(
    async (text: string, instruction?: string, kind?: UsageKind) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setInput("");
      setBusy(true);
      setHistoryOpen(false);
      const userId = `u_${Date.now()}`;
      const asstId = `a_${Date.now()}`;
      setMessages((m) => [
        ...m,
        { id: userId, role: "user", content: trimmed, proposals: [], queries: [], followups: [] },
        { id: asstId, role: "assistant", content: "", proposals: [], queries: [], followups: [], status: "Thinking", streaming: true },
      ]);
      const patch = (fn: (m: UiMessage) => UiMessage) => setMessages((ms) => ms.map((m) => (m.id === asstId ? fn(m) : m)));
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dashboardId,
            sessionId: sessionRef.current ?? undefined,
            // Questions asked in the full-screen view of an element are kept as that element's chat.
            ...(scope ? { sessionKind: "element", sessionWidgetId: scope.widget.id } : {}),
            message: trimmed,
            instruction: instruction ?? (scope ? questionAboutWidget(scope.widget, trimmed) : undefined),
            widgets: widgets.map((w): WidgetSummary => ({ id: w.id, type: w.type, title: w.title })),
            period: period.state,
            // Everything asked in the focused view is about one element.
            kind: kind ?? (scope ? "ask_element" : "chat"),
          }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `Request failed (${res.status})`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line) continue;
            let ev: ChatEvent;
            try { ev = JSON.parse(line) as ChatEvent; } catch { continue; }
            if (ev.type === "session") {
              sessionRef.current = ev.session.id;
              setSession({ id: ev.session.id, title: ev.session.title });
              setHistoryKey(`${ev.session.id}:${Date.now()}`);
            } else if (ev.type === "text") patch((m) => ({ ...m, content: m.content + ev.delta, status: undefined }));
            else if (ev.type === "status") patch((m) => ({ ...m, status: ev.text }));
            else if (ev.type === "query") patch((m) => ({ ...m, queries: [...m.queries, { sql: ev.sql, ok: ev.ok, rows: ev.rows, error: ev.error }] }));
            else if (ev.type === "widget") patch((m) => ({ ...m, proposals: [...m.proposals, { widget: ev.widget, data: ev.data, replaces: ev.replaces }] }));
            else if (ev.type === "followups") patch((m) => ({ ...m, followups: ev.items }));
            else if (ev.type === "period") onSetPeriod?.(ev.period);
            else if (ev.type === "usage") {
              patch((m) => ({ ...m, usage: ev.usage }));
              announceUsage(ev.usage.balance);
            } else if (ev.type === "error") {
              const out = ev.code === OUT_OF_TOKENS;
              patch((m) => ({ ...m, error: ev.message, outOfTokens: out, status: undefined }));
              if (out) announceUsage();
            }
            else if (ev.type === "done") patch((m) => ({ ...m, streaming: false, status: undefined }));
          }
        }
      } catch (e) {
        patch((m) => ({ ...m, error: (e as Error).message, streaming: false, status: undefined }));
      } finally {
        patch((m) => ({ ...m, streaming: false, status: undefined }));
        setBusy(false);
        abortRef.current = null;
        // The chat moves to the top of the list.
        setHistoryKey(`${sessionRef.current ?? ""}:${Date.now()}`);
      }
    },
    [busy, dashboardId, widgets, scope, period.state, onSetPeriod],
  );

  sendRef.current = send;

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };


  // Nudge when a new month lands: same source as the dashboard banner, dismissed per dashboard.
  const dataEvents = usePeriodEvents();
  const nudgeKey = `si.nudge.dismissed.${dashboardId}`;
  const nudgeDismissed = useStoredNumber(nudgeKey);
  const nudgeEvent = scope ? null : latestDataEvent(dataEvents);
  const nudge = nudgeEvent && nudgeEvent.id > nudgeDismissed
    ? (() => {
        const month = eventMonth(nudgeEvent);
        const label = formatMonth(month);
        const prevLabel = formatMonth(previousMonth(month));
        return {
          id: nudgeEvent.id,
          label,
          lead: nudgeEvent.kind === "month_revised" ? `New data was added to ${label}.` : `A new month was added (${label}).`,
          prevLabel,
          summary: `Summarise what changed in ${label} versus ${prevLabel} for us: posts, engagement, sentiment, top creators, objections. Propose one element for the biggest change.`,
          highlights: `What are the three most important things in the ${label} data for us and our competitors? Use ${label} only.`,
        };
      })()
    : null;
  const takeNudge = (question: string) => {
    if (!nudge) return;
    writeNumber(nudgeKey, nudge.id);
    void send(question);
  };

  const widgetTitle = (id?: string) => widgets.find((w) => w.id === id)?.title;
  const isAdded = (p: Proposal) => widgets.some((w) => w.id === p.widget.id);

  return (
    <section
      className={`ws__chat ${!scope ? `is-${width}` : ""} ${showPinned ? "is-pinned" : ""}`}
      aria-label="Assistant"
    >
      {!scope && width === "collapsed" ? (
        <div className="chat__rail">
          <button className="chat__railbtn chat__railmark" onClick={() => setWidth("normal")} aria-label="Open the analyst" title="Open the analyst">
            <span className="sidebar__mark" style={{ width: 28, height: 28, fontSize: 11, borderRadius: 8 }}>AI</span>
          </button>
          <button className="chat__railbtn" onClick={newChat} disabled={busy} aria-label="New chat" title={busy ? "Wait for the answer to finish" : "New chat"}>{ChatIcons.newChat}</button>
          <button className="chat__railbtn" onClick={() => { setWidth("normal"); setHistoryOpen(true); }} aria-label="Chat history" title="Chat history">{ChatIcons.history}</button>
          <button className="chat__railbtn" onClick={() => setWidth("normal")} aria-label="Expand the chat" title="Expand the chat">{PanelIcons.expand}</button>
        </div>
      ) : (
      <div className="chat__main">
      <div className="chat__head">
        {scope ? (
          <h2>
            <span className="sidebar__mark" style={{ width: 24, height: 24, fontSize: 11, borderRadius: 7 }}>AI</span>
            Ask about this element
            {demoMode && <span className="im-badge im-badge-warning" title="Set an LLM key to use the analyst">Demo mode</span>}
          </h2>
        ) : (
          <button
            className="chat__titlebtn"
            onClick={() => setHistoryOpen((o) => !o)}
            aria-expanded={historyOpen}
            title={historyOpen ? "Back to the chat" : "Show your chats"}
          >
            <span className="sidebar__mark" style={{ width: 24, height: 24, fontSize: 11, borderRadius: 7, flex: "none" }}>AI</span>
            <span className="chat__titletext">{session?.title ?? "New chat"}</span>
            <span className={`chat__chev ${historyOpen ? "is-open" : ""}`}>{PanelIcons.chevron}</span>
          </button>
        )}
        {!scope && (
          <div className="chat__headright">
            {demoMode && <span className="im-badge im-badge-warning" title="Set an LLM key to use the analyst">Demo</span>}
            <button className="im-btn im-btn-ghost im-btn-icon" onClick={newChat} disabled={busy} aria-label="New chat" title={busy ? "Wait for the answer to finish" : "New chat"}>{ChatIcons.newChat}</button>
            {!showPinned && (
              <button className={`im-btn im-btn-ghost im-btn-icon ${historyOpen ? "is-on" : ""}`} onClick={() => setHistoryOpen((o) => !o)} aria-pressed={historyOpen} aria-label="Chat history" title="Chat history">{ChatIcons.history}</button>
            )}
            <button className="im-btn im-btn-ghost im-btn-icon chat__widthbtn" onClick={() => setWidth(width === "wide" ? "normal" : "wide")} aria-label={width === "wide" ? "Make the chat narrower" : "Make the chat wider"} title={width === "wide" ? "Narrower" : "Wider, for long answers"}>{width === "wide" ? PanelIcons.narrow : PanelIcons.wide}</button>
            <button className="im-btn im-btn-ghost im-btn-icon chat__collapsebtn" onClick={() => setWidth("collapsed")} aria-label="Hide the chat" title="Hide the chat (the dashboard gets the full width)">{PanelIcons.collapse}</button>
          </div>
        )}
      </div>
      {!scope && historyOpen && !showPinned && (
        <div className="chat__overlay">
          <ChatHistory
            dashboardId={dashboardId}
            currentId={session?.id ?? null}
            refreshKey={historyKey}
            busy={busy}
            pinned={false}
            canPin={wideScreen}
            onOpen={(s) => void openSession(s)}
            onDeleted={(id) => { if (id === session?.id) newChat(); }}
            onRenamed={(s) => { if (s.id === session?.id) setSession({ id: s.id, title: s.title }); }}
            onClose={() => setHistoryOpen(false)}
            onTogglePin={() => setPinned(true)}
            onNewChat={newChat}
          />
          {tokens?.dashboardMonth ? <div className="hist__foot">This dashboard has used {formatTokens(tokens.dashboardMonth)} tokens this month.</div> : null}
        </div>
      )}
      <div className="chat__scroll" ref={scrollRef}>
        {messages.length === 0 && scope && (
          <>
            <div className="chat__intro">
              Questions here are answered about <strong>{scope.widget.title}</strong>. The analyst can run its query, vary it, and propose a refined version.
            </div>
            <span className="im-micro-label">Quick questions</span>
            <div className="chat__starters">
              {FOCUS_QUESTIONS.map((q) => (
                <button key={q} className="chat__starter" onClick={() => void send(q)}>{q}</button>
              ))}
            </div>
          </>
        )}
        {messages.length === 0 && !scope && (
          <>
            <div className="chat__intro">
              Ask anything about <strong>{ws.focal}</strong> and its competitors{period.coverage ? <> across <strong>{period.coverage.posts.toLocaleString("en-US")} creator posts</strong> and <strong>{period.coverage.comments.toLocaleString("en-US")} comments</strong></> : null}. I answer with real numbers and propose dashboard elements you can add, refine, or dismiss.
            </div>
            <div className="chat__start">
              <div className="grow">
                <b>Not sure where to begin?</b>
                <small>I&apos;ll scan the data and come back with three observations, each with an element you can add.</small>
              </div>
              <button className="im-btn im-btn-primary im-btn-sm" onClick={() => void send(START_SCAN_LABEL, START_SCAN_INSTRUCTION, "scan")}>{START_SCAN_LABEL}</button>
            </div>
            <span className="im-micro-label">Or pick a goal</span>
            <div className="intents">
              {INTENTS.map((it) => (
                <button key={it.id} className={`intent ${intent === it.id ? "is-active" : ""}`} onClick={() => setIntent(intent === it.id ? null : it.id)} aria-expanded={intent === it.id}>
                  <b>{it.title}</b>
                  <small>{it.blurb}</small>
                </button>
              ))}
            </div>
            {intent && (
              <div className="intent__prompts" ref={(el) => el?.scrollIntoView({ block: "nearest", behavior: "smooth" })}>
                {INTENTS.find((it) => it.id === intent)!.prompts.map((q) => (
                  <button key={q} className="chat__starter" onClick={() => void send(q)}>{q}</button>
                ))}
                <span className="chat__hint">Or type your own question below.</span>
              </div>
            )}
            <details className="chat__examples">
              <summary>More examples</summary>
              <div className="chat__starters">
                {STARTER_QUESTIONS.map((q) => (
                  <button key={q} className="chat__starter" onClick={() => void send(q)}>{q}</button>
                ))}
              </div>
            </details>
          </>
        )}
        {messages.map((m, idx) => (
          <div key={m.id} id={`msg-${m.id}`} className={`msg msg--${m.role}`}>
            {(m.content || m.role === "user") && (
              <div className="msg__bubble">{m.role === "user" ? m.content : <Markdown text={m.content} />}</div>
            )}
            {m.status && (
              <div className="msg__status"><span className="spinner" /> {m.status}…</div>
            )}
            {m.queries.length > 0 && (
              <details className="msg__queries">
                <summary>{m.queries.length} {m.queries.length === 1 ? "query" : "queries"} run</summary>
                {m.queries.map((q, i) => (
                  <div key={i}>
                    <pre>{q.sql}</pre>
                    <div className={q.ok ? "" : "err"}>{q.ok ? `${q.rows ?? "?"} rows` : q.error}</div>
                  </div>
                ))}
              </details>
            )}
            {m.proposals.filter((p) => !dismissed.has(p.widget.id)).map((p) => (
              <ProposalCard
                key={p.widget.id}
                proposal={p}
                added={isAdded(p)}
                replacedTitle={widgetTitle(p.replaces)}
                onAdd={() => onAddWidget(p.widget, p.replaces)}
                onDismiss={() => setDismissed((d) => new Set(d).add(p.widget.id))}
                onRefine={() => { setInput(`Refine "${p.widget.title}": `); inputRef.current?.focus(); }}
              />
            ))}
            {m.error && (m.outOfTokens ? <OutOfTokensCard message={m.error} /> : <div className="chat__error">{m.error}</div>)}
            {m.role === "assistant" && !m.streaming && m.usage && <UsageNote usage={m.usage} />}
            {m.role === "assistant" && !m.streaming && m.followups.length > 0 && idx === messages.length - 1 && (
              <div className="followups" aria-label="Suggested next questions">
                {m.followups.map((q) => (
                  <button key={q} className="followup" onClick={() => void send(q)} disabled={busy}>{q}</button>
                ))}
              </div>
            )}
          </div>
        ))}
        {nudge && (
          <div className="nudge" role="status">
            <div className="nudge__head">
              <span className="im-micro-label">New data</span>
              <button className="im-btn im-btn-ghost im-btn-icon nudge__close" onClick={() => writeNumber(nudgeKey, nudge.id)} aria-label="Dismiss" title="Dismiss">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <p>{nudge.lead} Want a summary of what changed versus {nudge.prevLabel.split(" ")[0]}?</p>
            <div className="nudge__actions">
              <button className="im-btn im-btn-primary im-btn-sm" onClick={() => takeNudge(nudge.summary)} disabled={busy}>Summarise vs {nudge.prevLabel.split(" ")[0]}</button>
              <button className="im-btn im-btn-secondary im-btn-sm" onClick={() => takeNudge(nudge.highlights)} disabled={busy}>{nudge.label.split(" ")[0]} highlights</button>
            </div>
          </div>
        )}
        <div ref={spacerRef} aria-hidden="true" style={{ flex: "none" }} />
      </div>
      <div className="chat__compose">
        <LowTokensNotice info={tokens} />
        <div className="chat__input">
          <textarea
            ref={inputRef}
            className="im-textarea"
            placeholder="Ask a question or describe a dashboard element…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            rows={2}
            disabled={busy}
          />
          <button className="im-btn im-btn-primary" onClick={() => void send(input)} disabled={busy || !input.trim()} aria-label="Send">
            {busy ? <span className="spinner" style={{ borderColor: "rgba(255,255,255,0.4)", borderTopColor: "#fff" }} /> : "Send"}
          </button>
        </div>
        <div className="chat__hint">Enter to send · Shift+Enter for a new line · Ask for “a chart of…” to get a proposal</div>
      </div>
      </div>
      )}
      {showPinned && (
        <ChatHistory
          dashboardId={dashboardId}
          currentId={session?.id ?? null}
          refreshKey={historyKey}
          busy={busy}
          pinned
          canPin
          onOpen={(s) => void openSession(s)}
          onDeleted={(id) => { if (id === session?.id) newChat(); }}
          onRenamed={(s) => { if (s.id === session?.id) setSession({ id: s.id, title: s.title }); }}
          onTogglePin={() => setPinned(false)}
          onNewChat={newChat}
        />
      )}
    </section>
  );
}
