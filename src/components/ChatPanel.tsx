"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatEvent, DisplayMessage, WidgetSummary } from "@/lib/claude";
import { STARTER_QUESTIONS, type WidgetSpec } from "@/lib/widgets";
import { ProposalCard, type Proposal } from "./ProposalCard";
import { Markdown } from "./WidgetBody";

interface QueryLog { sql: string; ok: boolean; rows?: number; error?: string }
interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  proposals: Proposal[];
  queries: QueryLog[];
  status?: string;
  streaming?: boolean;
  error?: string;
}

export function ChatPanel({
  dashboardId,
  widgets,
  demoMode,
  onAddWidget,
  prefill,
  onPrefillConsumed,
}: {
  dashboardId: string;
  widgets: WidgetSpec[];
  demoMode: boolean;
  onAddWidget: (widget: WidgetSpec, replaces?: string) => void;
  prefill?: string;
  onPrefillConsumed: () => void;
}) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch(`/api/dashboards/${dashboardId}/messages`)
      .then((r) => r.json())
      .then((j: { messages: DisplayMessage[] }) =>
        setMessages(
          j.messages.map((m) => ({
            id: String(m.id),
            role: m.role,
            content: m.content,
            proposals: (m.proposals ?? []).map((p) => ({ widget: p.widget, replaces: p.replaces })),
            queries: [],
          })),
        ),
      )
      .catch(() => {});
  }, [dashboardId]);

  useEffect(() => {
    if (prefill) {
      setInput(prefill);
      inputRef.current?.focus();
      onPrefillConsumed();
    }
  }, [prefill, onPrefillConsumed]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setInput("");
      setBusy(true);
      const userId = `u_${Date.now()}`;
      const asstId = `a_${Date.now()}`;
      setMessages((m) => [
        ...m,
        { id: userId, role: "user", content: trimmed, proposals: [], queries: [] },
        { id: asstId, role: "assistant", content: "", proposals: [], queries: [], status: "Thinking", streaming: true },
      ]);
      const patch = (fn: (m: UiMessage) => UiMessage) => setMessages((ms) => ms.map((m) => (m.id === asstId ? fn(m) : m)));
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dashboardId, message: trimmed, widgets: widgets.map((w): WidgetSummary => ({ id: w.id, type: w.type, title: w.title })) }),
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
            if (ev.type === "text") patch((m) => ({ ...m, content: m.content + ev.delta, status: undefined }));
            else if (ev.type === "status") patch((m) => ({ ...m, status: ev.text }));
            else if (ev.type === "query") patch((m) => ({ ...m, queries: [...m.queries, { sql: ev.sql, ok: ev.ok, rows: ev.rows, error: ev.error }] }));
            else if (ev.type === "widget") patch((m) => ({ ...m, proposals: [...m.proposals, { widget: ev.widget, data: ev.data, replaces: ev.replaces }] }));
            else if (ev.type === "error") patch((m) => ({ ...m, error: ev.message, status: undefined }));
            else if (ev.type === "done") patch((m) => ({ ...m, streaming: false, status: undefined }));
          }
        }
      } catch (e) {
        patch((m) => ({ ...m, error: (e as Error).message, streaming: false, status: undefined }));
      } finally {
        patch((m) => ({ ...m, streaming: false, status: undefined }));
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, dashboardId, widgets],
  );

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const clearChat = async () => {
    if (!confirm("Clear this conversation?")) return;
    await fetch(`/api/dashboards/${dashboardId}/messages`, { method: "DELETE" });
    setMessages([]);
  };

  const widgetTitle = (id?: string) => widgets.find((w) => w.id === id)?.title;
  const isAdded = (p: Proposal) => widgets.some((w) => w.id === p.widget.id);

  return (
    <section className="ws__chat" aria-label="Assistant">
      <div className="chat__head">
        <h2>
          <span className="sidebar__mark" style={{ width: 24, height: 24, fontSize: 11, borderRadius: 7 }}>AI</span>
          Analyst
          {demoMode && <span className="im-badge im-badge-warning" title="Set ANTHROPIC_API_KEY to use Claude">Demo mode</span>}
        </h2>
        {messages.length > 0 && <button className="im-btn im-btn-ghost im-btn-sm" onClick={clearChat}>Clear</button>}
      </div>
      <div className="chat__scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <>
            <div className="chat__intro">
              Ask anything about <strong>Venus</strong> and its competitors across <strong>6,168 creator posts</strong> and <strong>31,688 comments</strong>. I answer with real numbers and propose dashboard elements you can add, refine, or dismiss.
            </div>
            <span className="im-micro-label">Try one of these</span>
            <div className="chat__starters">
              {STARTER_QUESTIONS.map((q) => (
                <button key={q} className="chat__starter" onClick={() => void send(q)}>{q}</button>
              ))}
            </div>
          </>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg msg--${m.role}`}>
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
            {m.error && <div className="chat__error">{m.error}</div>}
          </div>
        ))}
      </div>
      <div className="chat__compose">
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
    </section>
  );
}
