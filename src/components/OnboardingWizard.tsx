"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BRANDS, FOCAL_BRAND } from "@/lib/brands";
import type { ChatEvent } from "@/lib/claude";
import { addDays, ALL_TIME, formatMonth, monthPeriod, type Coverage, type PeriodState } from "@/lib/period";
import type { DashboardRecord, WidgetSpec } from "@/lib/widgets";
import { stepOrder, WizardAnswersSchema, type GoalId, type OnboardingState, type StepAnswer, type StepId, type WizardAnswers, type WizardChoice } from "@/lib/wizard";
import { useConfirm } from "./Confirm";
import { PeriodProvider } from "./PeriodContext";
import type { Proposal } from "./ProposalCard";
import { Shell } from "./Shell";
import { useToast } from "./Toast";
import { Markdown } from "./WidgetBody";
import { WizardProposalCard } from "./WizardProposalCard";

/* ------------------------------------------------------------------ */
/* Types and small helpers                                              */
/* ------------------------------------------------------------------ */

interface WizardDef {
  intro: string;
  goals: Array<{ id: GoalId; label: string; blurb: string }>;
  stepIds: StepId[];
  steps: Array<{ id: StepId; question: string; short: string; choices: WizardChoice[] }>;
  coverage: Coverage;
}

interface Reply {
  id: string;
  question: string;
  text: string;
  status?: string;
  streaming: boolean;
  error?: string;
}

/** What the analyst has shown on one question (kept per question so Back and Next keep it). */
interface StepView {
  text: string;
  status?: string;
  streaming: boolean;
  error?: string;
  proposals: Proposal[];
  /** The choices the last "Show me" ran with (null when only the free-text box was used). */
  shownKey: string | null;
  replies: Reply[];
}

type Accepted = Partial<Record<StepId, WidgetSpec[]>>;

const COMPETITORS = BRANDS.filter((b) => b.role === "competitor").map((b) => b.name);
const VIEWS: Array<{ id: WizardAnswers["view"]; label: string }> = [
  { id: "month", label: "Latest complete month vs previous" },
  { id: "all", label: "All time" },
  { id: "90d", label: "Last 90 days" },
];
const BLANK_STEP: StepAnswer = { choices: {}, added: [], skipped: false };
const noop = () => {};

const storeKey = (id: string) => `si.wizard.accepted.${id}`;
function readAccepted(id: string): Accepted {
  try {
    const raw = window.localStorage.getItem(storeKey(id));
    return raw ? (JSON.parse(raw) as Accepted) : {};
  } catch {
    return {};
  }
}
function writeAccepted(id: string, a: Accepted | null) {
  try {
    if (a) window.localStorage.setItem(storeKey(id), JSON.stringify(a));
    else window.localStorage.removeItem(storeKey(id));
  } catch {
    /* storage unavailable: accepted elements then live only in this tab */
  }
}

/** Latest complete month with a meaningful amount of posts (mirrors latestMonth in lib/coverage). */
function latestCompleteMonth(c: Coverage): string | null {
  const maxPosts = Math.max(0, ...c.months.map((m) => m.posts));
  const complete = c.months.filter((m) => m.complete && m.posts >= Math.max(1, maxPosts * 0.1));
  if (complete.length) return complete[complete.length - 1].month;
  return [...c.months].reverse().find((m) => m.posts > 0)?.month ?? null;
}

function periodFor(view: WizardAnswers["view"], c: Coverage | undefined): PeriodState {
  if (!c) return ALL_TIME;
  if (view === "month") {
    const m = latestCompleteMonth(c);
    return m ? monthPeriod(m, { mode: "previous" }) : ALL_TIME;
  }
  if (view === "90d" && c.lastDate) return { mode: "range", start: addDays(c.lastDate, -89), end: addDays(c.lastDate, 1), compare: { mode: "previous" } };
  return ALL_TIME;
}

function choiceValue(answers: WizardAnswers, stepId: StepId, c: WizardChoice): string[] {
  const v = answers.steps[stepId]?.choices?.[c.key];
  return v && v.length ? v : c.default;
}

const fmt = (n: number) => n.toLocaleString("en-US");
function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Reads an NDJSON ChatEvent stream (same protocol as /api/chat). */
async function readEvents(res: Response, onEvent: (e: ChatEvent) => void) {
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
      try {
        onEvent(JSON.parse(line) as ChatEvent);
      } catch {
        /* skip a malformed line */
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Pieces                                                               */
/* ------------------------------------------------------------------ */

function Chip({ pressed, onClick, children, radio }: { pressed: boolean; onClick: () => void; children: React.ReactNode; radio?: boolean }) {
  return (
    <button type="button" className={`wiz__chip ${radio ? "wiz__chip--radio" : ""} ${pressed ? "is-on" : ""}`} aria-pressed={pressed} data-chip="" onClick={onClick}>
      {radio ? <i className="wiz__radio" aria-hidden="true" /> : <i className="wiz__check" aria-hidden="true">{pressed ? "✓" : ""}</i>}
      {children}
    </button>
  );
}

function AiMark() {
  return <span className="sidebar__mark wiz__ai" aria-label="Analyst">AI</span>;
}

/* ------------------------------------------------------------------ */
/* The wizard                                                           */
/* ------------------------------------------------------------------ */

export function OnboardingWizard({ resumeId }: { resumeId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const [def, setDef] = useState<WizardDef | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dashboardId, setDashboardId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<WizardAnswers>(() => WizardAnswersSchema.parse({}));
  const [order, setOrder] = useState<StepId[]>(() => stepOrder(null));
  const [current, setCurrent] = useState(0);
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString());
  const [goalChosen, setGoalChosen] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [accepted, setAccepted] = useState<Accepted>({});
  const [views, setViews] = useState<Partial<Record<StepId, StepView>>>({});
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [input, setInput] = useState("");
  const [fillRest, setFillRest] = useState(true);
  const [name, setName] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const initRef = useRef(false);
  const streamsRef = useRef(new Set<AbortController>());

  const SUMMARY = order.length + 1;
  const stepDef = useCallback((id: StepId) => def?.steps.find((s) => s.id === id), [def]);
  const currentStepId: StepId | null = current >= 1 && current <= order.length ? order[current - 1] : null;
  const period = useMemo(() => periodFor(answers.view, def?.coverage), [answers.view, def]);

  /* ---------------- load: start fresh or resume ---------------- */
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    (async () => {
      try {
        const defRes = fetch("/api/wizard/start").then((r) => (r.ok ? (r.json() as Promise<WizardDef>) : Promise.reject(new Error("Could not load the setup"))));
        if (resumeId) {
          const r = await fetch(`/api/dashboards/${encodeURIComponent(resumeId)}`);
          if (!r.ok) throw new Error("This setup was not found. It may have been deleted.");
          const { dashboard } = (await r.json()) as { dashboard: DashboardRecord };
          const ob = dashboard.onboarding;
          setDashboardId(dashboard.id);
          if (ob) {
            const restored = readAccepted(dashboard.id);
            const keep: Accepted = {};
            for (const s of ob.order) {
              const ids = new Set(ob.answers.steps[s]?.added ?? []);
              const list = (restored[s] ?? []).filter((w) => ids.has(w.id));
              if (list.length) keep[s] = list;
            }
            setAnswers(ob.answers);
            setOrder(ob.order);
            setCurrent(Math.min(Math.max(0, ob.currentStep), ob.order.length + 1));
            setStartedAt(ob.startedAt);
            setGoalChosen(ob.currentStep > 0 || ob.answers.goal !== "unsure");
            setCompleted(!!ob.completedAt);
            setAccepted(keep);
          }
        } else {
          const r = await fetch("/api/wizard/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          const j = (await r.json()) as { dashboard?: DashboardRecord; error?: string };
          if (!r.ok || !j.dashboard) throw new Error(j.error ?? "Could not start the setup");
          const ob = j.dashboard.onboarding;
          setDashboardId(j.dashboard.id);
          if (ob) {
            setAnswers(ob.answers);
            setOrder(ob.order);
            setStartedAt(ob.startedAt);
          }
          // Make a reload (or a shared link) resume this setup instead of starting another one.
          window.history.replaceState(null, "", `/dashboard/new/guided?dashboard=${encodeURIComponent(j.dashboard.id)}`);
        }
        setDef(await defRes);
      } catch (e) {
        setLoadError((e as Error).message);
      }
    })();
  }, [resumeId]);

  useEffect(() => {
    const streams = streamsRef.current;
    return () => streams.forEach((c) => c.abort());
  }, []);

  /* ---------------- persistence ---------------- */
  useEffect(() => {
    if (!dashboardId || !def || completed || finishing) return;
    const onboarding: OnboardingState = { version: 1, answers, order, currentStep: current, startedAt, completedAt: null };
    const t = setTimeout(() => {
      fetch(`/api/dashboards/${dashboardId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ onboarding }) }).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [dashboardId, def, answers, order, current, startedAt, completed, finishing]);

  useEffect(() => {
    if (dashboardId && def && !completed) writeAccepted(dashboardId, accepted);
  }, [dashboardId, def, accepted, completed]);

  // Each new screen starts at the top.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [current]);

  /* ---------------- answer helpers ---------------- */
  const patchStep = useCallback((id: StepId, fn: (s: StepAnswer) => StepAnswer) => {
    setAnswers((a) => ({ ...a, steps: { ...a.steps, [id]: fn(a.steps[id] ?? BLANK_STEP) } }));
  }, []);

  const setStepAccepted = (id: StepId, list: WidgetSpec[]) => {
    setAccepted((a) => ({ ...a, [id]: list }));
    patchStep(id, (s) => ({ ...s, added: list.map((w) => w.id), skipped: list.length ? false : s.skipped }));
  };
  const addWidgets = (id: StepId, ws: WidgetSpec[]) => {
    const prev = accepted[id] ?? [];
    const next = [...prev, ...ws.filter((w) => !prev.some((p) => p.id === w.id))];
    setStepAccepted(id, next);
  };
  const removeWidget = (id: StepId, widgetId: string) => setStepAccepted(id, (accepted[id] ?? []).filter((w) => w.id !== widgetId));

  const toggleChoice = (id: StepId, c: WizardChoice, value: string) => {
    const cur = choiceValue(answers, id, c);
    let next: string[];
    if (c.multi) {
      next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      if (!next.length) return; // keep at least one
      next = c.options.map((o) => o.value).filter((v) => next.includes(v));
    } else {
      next = [value];
    }
    patchStep(id, (s) => ({ ...s, choices: { ...s.choices, [c.key]: next } }));
  };

  const choicesKey = useCallback(
    (id: StepId) => JSON.stringify((stepDef(id)?.choices ?? []).map((c) => choiceValue(answers, id, c))),
    [answers, stepDef],
  );

  /* ---------------- analyst turns ---------------- */
  const patchView = (id: StepId, fn: (v: StepView) => StepView) =>
    setViews((vs) => ({ ...vs, [id]: fn(vs[id] ?? { text: "", streaming: false, proposals: [], shownKey: null, replies: [] }) }));

  const runStep = async (id: StepId, mode: "propose" | "discuss", text?: string) => {
    if (!dashboardId) return;
    const view = views[id];
    if (view?.streaming || view?.replies.some((r) => r.streaming)) return;
    const replyId = `r_${Date.now()}`;
    if (mode === "propose") {
      patchView(id, (v) => ({ ...v, text: "", status: "Reading the data", streaming: true, error: undefined, proposals: [], shownKey: choicesKey(id) }));
    } else {
      setInput("");
      patchView(id, (v) => ({ ...v, replies: [...v.replies, { id: replyId, question: text ?? "", text: "", status: "Thinking", streaming: true }] }));
    }
    const patchReply = (fn: (r: Reply) => Reply) => patchView(id, (v) => ({ ...v, replies: v.replies.map((r) => (r.id === replyId ? fn(r) : r)) }));
    const patchTarget = (fn: (t: { text: string; status?: string; error?: string; streaming: boolean }) => Partial<Reply>) =>
      mode === "propose" ? patchView(id, (v) => ({ ...v, ...fn(v) })) : patchReply((r) => ({ ...r, ...fn(r) }));

    const proposed = [...(accepted[id] ?? []), ...(view?.proposals.map((p) => p.widget) ?? [])]
      .filter((w, i, all) => all.findIndex((x) => x.id === w.id) === i && !dismissed.has(w.id))
      .map((w) => ({ id: w.id, title: w.title }));
    const ctrl = new AbortController();
    streamsRef.current.add(ctrl);
    try {
      const res = await fetch("/api/wizard/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dashboardId, stepId: id, answers, mode, text, proposed, period }),
        signal: ctrl.signal,
      });
      await readEvents(res, (ev) => {
        if (ev.type === "text") patchTarget((t) => ({ text: t.text + ev.delta, status: undefined }));
        else if (ev.type === "status") patchTarget(() => ({ status: ev.text }));
        else if (ev.type === "widget") {
          const p: Proposal = { widget: ev.widget, data: ev.data, replaces: ev.replaces };
          patchView(id, (v) => {
            const at = ev.replaces ? v.proposals.findIndex((x) => x.widget.id === ev.replaces) : -1;
            const proposals = at >= 0 ? v.proposals.map((x, i) => (i === at ? p : x)) : [...v.proposals, p];
            return { ...v, proposals };
          });
          if (ev.replaces) {
            const rep = ev.replaces;
            setAccepted((a) => {
              const list = a[id] ?? [];
              if (!list.some((w) => w.id === rep)) return a;
              return { ...a, [id]: list.filter((w) => w.id !== rep) };
            });
            patchStep(id, (s) => ({ ...s, added: s.added.filter((x) => x !== rep) }));
          }
        } else if (ev.type === "error") patchTarget(() => ({ error: ev.message, status: undefined }));
        else if (ev.type === "done") patchTarget(() => ({ streaming: false, status: undefined }));
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") patchTarget(() => ({ error: (e as Error).message }));
    } finally {
      patchTarget(() => ({ streaming: false, status: undefined }));
      streamsRef.current.delete(ctrl);
    }
  };

  /* ---------------- navigation ---------------- */
  const go = (n: number) => {
    setInput("");
    setCurrent(n);
  };
  const next = () => {
    if (current === 0) {
      const o = stepOrder(answers.goal);
      setOrder(o);
      go(1);
      return;
    }
    if (currentStepId) patchStep(currentStepId, (s) => ({ ...s, skipped: false }));
    go(current + 1);
  };
  const skip = () => {
    if (currentStepId) patchStep(currentStepId, (s) => ({ ...s, skipped: true }));
    go(current + 1);
  };
  const back = () => go(Math.max(0, current - 1));

  const buildRest = async () => {
    const ok = await confirm({
      title: "Build the rest for me?",
      message: "I'll fill every remaining question you have not added to or skipped with my default elements, personalised with your answers so far. You can change anything on the dashboard afterwards.",
      confirmLabel: "Build the rest",
    });
    if (!ok) return;
    setFillRest(true);
    go(SUMMARY);
  };

  const goalLabel = def?.goals.find((g) => g.id === answers.goal)?.label ?? "";
  const defaultName = goalChosen && answers.goal !== "unsure" ? `${FOCAL_BRAND.name} · ${goalLabel}` : `${FOCAL_BRAND.name} dashboard`;
  const finalName = (name ?? defaultName).trim() || defaultName;

  const finish = async () => {
    if (!dashboardId || finishing) return;
    setFinishing(true);
    try {
      const acc: Record<string, WidgetSpec[]> = {};
      for (const s of order) if (accepted[s]?.length) acc[s] = accepted[s]!;
      const r = await fetch("/api/wizard/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dashboardId, name: finalName, answers, order, accepted: acc, fillRest }),
      });
      const j = (await r.json().catch(() => ({}))) as { dashboard?: DashboardRecord; error?: string };
      if (!r.ok || !j.dashboard) throw new Error(j.error ?? "Could not build the dashboard");
      writeAccepted(dashboardId, null);
      setCompleted(true);
      router.push(`/dashboard/${j.dashboard.id}`);
    } catch (e) {
      toast((e as Error).message);
      setFinishing(false);
    }
  };

  /* ---------------- keyboard ---------------- */
  const showRef = useRef<() => void>(noop);
  useEffect(() => {
    showRef.current = () => {
      if (currentStepId) void runStep(currentStepId, "propose");
    };
  });
  useEffect(() => {
    if (!currentStepId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if (document.querySelector(".modal-scrim, .lightbox")) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const onChip = !!t?.closest("[data-chip]");
      if (!onChip && (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT" || tag === "BUTTON" || tag === "A" || t?.isContentEditable)) return;
      e.preventDefault();
      showRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentStepId]);

  /* ---------------- render ---------------- */
  const total = order.length;
  const progress = current === 0 ? 0 : current > total ? 1 : (current - 1) / total;
  const progressLabel = current === 0 ? "Getting started" : current > total ? "All questions done" : `Question ${current} of ${total}`;
  const viewLabel = VIEWS.find((v) => v.id === answers.view)?.label ?? "";

  const statusOf = (s: StepId, i: number): "current" | "done" | "skipped" | "passed" | "todo" => {
    if (i + 1 === current) return "current";
    if (accepted[s]?.length || answers.steps[s]?.added?.length) return "done";
    if (answers.steps[s]?.skipped) return "skipped";
    if (i + 1 < current) return "passed";
    return "todo";
  };

  const rail = (
    <aside className="wiz__rail" aria-label="Setup progress">
      <div className="wiz__railhead">
        <span className="im-micro-label">Guided setup</span>
        <b>{progressLabel}</b>
      </div>
      <ol className="wiz__list">
        <li>
          <button className={`wiz__item ${current === 0 ? "is-current" : "is-done"}`} onClick={() => go(0)} aria-current={current === 0 ? "step" : undefined} disabled={completed || finishing}>
            <span className="wiz__dot" aria-hidden="true">{current === 0 ? "" : "✓"}</span>
            <span className="wiz__itemlabel">Getting started</span>
          </button>
        </li>
        {order.map((s, i) => {
          const st = statusOf(s, i);
          const n = accepted[s]?.length ?? answers.steps[s]?.added?.length ?? 0;
          return (
            <li key={s}>
              <button
                className={`wiz__item is-${st}`}
                onClick={() => go(i + 1)}
                disabled={current === 0 || completed || finishing}
                aria-current={st === "current" ? "step" : undefined}
                title={stepDef(s)?.question}
              >
                <span className="wiz__dot" aria-hidden="true">{st === "done" ? "✓" : st === "skipped" ? "–" : i + 1}</span>
                <span className="wiz__itemlabel">{stepDef(s)?.short ?? s}</span>
                <span className="wiz__itemmeta">{st === "done" ? `${n} added` : st === "skipped" ? "skipped" : ""}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {current > 0 && (
        <div className="wiz__chosen">
          <span className="im-micro-label">Your choices</span>
          <div><span>Goal</span><b>{goalLabel}</b></div>
          <div><span>Competitors</span><b>{answers.competitors.length ? answers.competitors.join(", ") : "None"}</b></div>
          <div><span>Default view</span><b>{viewLabel}</b></div>
        </div>
      )}
      {current >= 3 && current <= total && !completed && (
        <button className="im-btn im-btn-secondary wiz__rest" onClick={() => void buildRest()}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>
          Build the rest for me
        </button>
      )}
    </aside>
  );

  let body: React.ReactNode;
  if (loadError) {
    body = (
      <div className="wiz__panel wiz__center">
        <h2 className="wiz__q">Something went wrong</h2>
        <p className="im-text-regular">{loadError}</p>
        <div className="row" style={{ marginTop: "1rem" }}>
          <Link className="im-btn im-btn-primary" href="/dashboard/new/guided" onClick={() => window.setTimeout(() => window.location.reload(), 0)}>Start a new setup</Link>
          <Link className="im-btn im-btn-ghost" href="/">Back to dashboards</Link>
        </div>
      </div>
    );
  } else if (!def || !dashboardId) {
    body = (
      <div className="wiz__panel wiz__center" aria-busy="true">
        <span className="spinner" /> <span className="im-text-description">Preparing your setup…</span>
      </div>
    );
  } else if (completed && !finishing) {
    body = (
      <div className="wiz__panel wiz__center">
        <h2 className="wiz__q">This setup is finished</h2>
        <p className="im-text-regular">The dashboard was built from it. You can keep refining it with the analyst on the dashboard.</p>
        <div className="row" style={{ marginTop: "1rem" }}>
          <Link className="im-btn im-btn-primary" href={`/dashboard/${dashboardId}`}>Open dashboard</Link>
        </div>
      </div>
    );
  } else if (current === 0) {
    const cov = def.coverage;
    const span = cov.firstDate && cov.lastDate ? `, ${formatMonth(cov.firstDate.slice(0, 7), false)} to ${formatMonth(cov.lastDate.slice(0, 7), false)}` : "";
    const latest = latestCompleteMonth(cov);
    const prev = latest ? prevMonth(latest) : null;
    body = (
      <div className="wiz__panel">
        <h2 className="wiz__q">Let&apos;s set up your dashboard</h2>
        <div className="wiz__analyst">
          <AiMark />
          <div className="wiz__say">
            <p>
              I have <b>{fmt(cov.posts)} creator posts</b> and <b>{fmt(cov.comments)} comments</b> about {FOCAL_BRAND.name} and {COMPETITORS.length} competitors{span}.
            </p>
            <p>{def.intro.replace(/^I have the creator posts and audience comments about [^.]+\.\s*/, "")}</p>
          </div>
        </div>

        <fieldset className="wiz__group">
          <legend>Competitors to track</legend>
          <div className="wiz__chips">
            {COMPETITORS.map((c) => {
              const on = answers.competitors.includes(c);
              return (
                <Chip key={c} pressed={on} onClick={() => setAnswers((a) => ({ ...a, competitors: on ? a.competitors.filter((x) => x !== c) : COMPETITORS.filter((x) => x === c || a.competitors.includes(x)) }))}>
                  {c}
                </Chip>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="wiz__group">
          <legend>Default view</legend>
          <div className="wiz__chips">
            {VIEWS.map((v) => (
              <Chip key={v.id} radio pressed={answers.view === v.id} onClick={() => setAnswers((a) => ({ ...a, view: v.id }))}>
                {v.label}
                {v.id === "month" && <span className="im-badge im-badge-primary wiz__rec">Recommended</span>}
              </Chip>
            ))}
          </div>
          {answers.view === "month" && latest && prev && (
            <p className="im-text-description wiz__hint">The dashboard opens on {formatMonth(latest)}, compared with {formatMonth(prev)}.</p>
          )}
        </fieldset>

        <fieldset className="wiz__group">
          <legend>What are you working on?</legend>
          <div className="wiz__goals">
            {def.goals.map((g) => {
              const on = goalChosen && answers.goal === g.id;
              return (
                <button key={g.id} type="button" className={`wiz__goal ${on ? "is-on" : ""}`} aria-pressed={on} data-chip="" onClick={() => { setGoalChosen(true); setAnswers((a) => ({ ...a, goal: g.id })); }}>
                  <b>{g.label}</b>
                  <small>{g.blurb}</small>
                </button>
              );
            })}
          </div>
          {goalChosen && answers.goal === "unsure" && (
            <label className="wiz__free">
              <span>Tell me what you are trying to find out</span>
              <textarea className="im-textarea" rows={3} value={answers.goalText ?? ""} maxLength={2000} placeholder="For example: why our engagement dropped after the summer campaign" onChange={(e) => { const goalText = e.target.value; setAnswers((a) => ({ ...a, goalText })); }} />
            </label>
          )}
        </fieldset>

        <div className="wiz__foot">
          <Link className="im-btn im-btn-ghost" href="/">Back to dashboards</Link>
          <div className="grow" />
          {!goalChosen && <span className="im-text-description">Pick what you are working on to continue</span>}
          <button className="im-btn im-btn-primary" onClick={next} disabled={!goalChosen}>Next</button>
        </div>
      </div>
    );
  } else if (currentStepId) {
    const id = currentStepId;
    const s = stepDef(id);
    const view = views[id];
    const acc = accepted[id] ?? [];
    const busy = !!view?.streaming || !!view?.replies.some((r) => r.streaming);
    const changed = !!view && view.shownKey !== null && view.shownKey !== choicesKey(id) && !view.streaming;
    const shownIds = new Set(view?.proposals.map((p) => p.widget.id) ?? []);
    const cards: Proposal[] = [
      ...acc.filter((w) => !shownIds.has(w.id)).map((w) => ({ widget: w })),
      ...(view?.proposals ?? []).filter((p) => !dismissed.has(p.widget.id) || acc.some((w) => w.id === p.widget.id)),
    ];
    const notAdded = cards.filter((p) => !acc.some((w) => w.id === p.widget.id)).map((p) => p.widget);
    body = (
      <div className="wiz__panel">
        <span className="im-micro-label">{progressLabel}</span>
        <h2 className="wiz__q">{s?.question}</h2>

        {s?.choices.map((c) => (
          <fieldset className="wiz__group" key={c.key}>
            <legend>{c.label}</legend>
            <div className="wiz__chips">
              {c.options.map((o) => (
                <Chip key={o.value} radio={!c.multi} pressed={choiceValue(answers, id, c).includes(o.value)} onClick={() => toggleChoice(id, c, o.value)}>
                  {o.label}
                </Chip>
              ))}
            </div>
          </fieldset>
        ))}

        <div className="wiz__show">
          <button className="im-btn im-btn-primary" onClick={() => void runStep(id, "propose")} disabled={busy}>
            {view?.streaming ? <><span className="spinner wiz__spin" /> Working</> : "Show me"}
          </button>
          {changed && <span className="wiz__changed" role="status">Choices changed. Show me again</span>}
          {!view && <span className="im-text-description">Press Enter or Show me: I&apos;ll say what the data shows and propose elements.</span>}
        </div>

        {view && (view.text || view.status || view.error || view.shownKey !== null) && (
          <div className="wiz__analyst" aria-live="polite">
            <AiMark />
            <div className="wiz__say">
              {view.text ? <Markdown text={view.text} /> : null}
              {view.status && <div className="msg__status"><span className="spinner" /> {view.status}…</div>}
              {view.error && <div className="chat__error">{view.error}</div>}
            </div>
          </div>
        )}

        {(cards.length > 0 || view?.streaming) && (
          <section className="wiz__proposals" aria-label="Proposed elements">
            <div className="wiz__prophead">
              <span className="im-micro-label">Proposed elements</span>
              <div className="grow" />
              {acc.length > 0 && <span className="im-badge im-badge-success">{acc.length} added</span>}
              <button className="im-btn im-btn-primary im-btn-sm" onClick={() => addWidgets(id, notAdded)} disabled={!notAdded.length || busy}>Add all</button>
            </div>
            <div className="wiz__grid">
              {cards.map((p) => (
                <WizardProposalCard
                  key={p.widget.id}
                  proposal={p}
                  added={acc.some((w) => w.id === p.widget.id)}
                  onAdd={() => addWidgets(id, [p.widget])}
                  onRemove={() => removeWidget(id, p.widget.id)}
                  onDismiss={() => setDismissed((d) => new Set(d).add(p.widget.id))}
                  onAdjust={() => {
                    setInput(`Change this element ("${p.widget.title}"): `);
                    inputRef.current?.focus();
                  }}
                />
              ))}
              {view?.streaming && (
                <div className="wiz__skeleton" aria-hidden="true">
                  <i style={{ width: "30%" }} /><i style={{ width: "65%" }} /><div className="wiz__skelbody" />
                </div>
              )}
            </div>
          </section>
        )}

        {view && view.replies.length > 0 && (
          <div className="wiz__replies">
            {view.replies.map((r) => (
              <div key={r.id} className="wiz__reply">
                <div className="msg msg--user"><div className="msg__bubble">{r.question}</div></div>
                <div className="wiz__analyst">
                  <AiMark />
                  <div className="wiz__say">
                    {r.text ? <Markdown text={r.text} /> : null}
                    {r.status && <div className="msg__status"><span className="spinner" /> {r.status}…</div>}
                    {r.error && <div className="chat__error">{r.error}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="wiz__discuss">
          <label htmlFor="wiz-discuss">Or tell me what you want to see</label>
          <div className="chat__input">
            <textarea
              id="wiz-discuss"
              ref={inputRef}
              className="im-textarea"
              rows={2}
              value={input}
              maxLength={2000}
              placeholder="For example: only TikTok, and show it month by month"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (input.trim() && !busy) void runStep(id, "discuss", input.trim());
                }
              }}
            />
            <button className="im-btn im-btn-primary" onClick={() => void runStep(id, "discuss", input.trim())} disabled={busy || !input.trim()}>Send</button>
          </div>
        </div>

        <div className="wiz__foot">
          <button className="im-btn im-btn-ghost" onClick={back}>Back</button>
          <div className="grow" />
          <button className="im-btn im-btn-secondary" onClick={skip}>Skip this question</button>
          <button className="im-btn im-btn-primary" onClick={next} disabled={!view || busy} title={!view ? "Show me first" : undefined}>Next</button>
        </div>
      </div>
    );
  } else {
    // Summary
    const rows = order.map((s) => {
      const n = accepted[s]?.length ?? 0;
      const skipped = !!answers.steps[s]?.skipped;
      const status = n ? `${n} ${n === 1 ? "element" : "elements"} added` : skipped ? "Skipped" : fillRest ? "Filled with defaults" : "Nothing added";
      const kind = n ? "done" : skipped ? "skipped" : fillRest ? "filled" : "empty";
      return { s, status, kind };
    });
    const latest = latestCompleteMonth(def.coverage);
    const viewDetail = answers.view === "month" && latest ? `${viewLabel}: opens on ${formatMonth(latest)}, compared with ${formatMonth(prevMonth(latest))}` : viewLabel;
    body = (
      <div className="wiz__panel">
        <span className="im-micro-label">Summary</span>
        <h2 className="wiz__q">Your dashboard is ready</h2>
        <div className="wiz__analyst">
          <AiMark />
          <div className="wiz__say">
            <p>Here is what goes on it, one section per question in the order you went through them. Everything stays editable, and you can keep asking me questions on the dashboard.</p>
          </div>
        </div>
        <ol className="wiz__summary">
          {rows.map((r, i) => (
            <li key={r.s} className={`is-${r.kind}`}>
              <span className="wiz__dot" aria-hidden="true">{r.kind === "done" || r.kind === "filled" ? "✓" : r.kind === "skipped" ? "–" : i + 1}</span>
              <span className="grow">{stepDef(r.s)?.question}</span>
              <span className="wiz__sumstatus">{r.status}</span>
            </li>
          ))}
        </ol>
        <label className="wiz__toggle">
          <input type="checkbox" checked={fillRest} onChange={(e) => setFillRest(e.target.checked)} />
          Fill questions with nothing added using my defaults
        </label>
        <div className="wiz__meta">
          <div><span>Default view</span><b>{viewDetail}</b></div>
          <div><span>Competitors</span><b>{answers.competitors.length ? answers.competitors.join(", ") : "None"}</b></div>
        </div>
        <label className="wiz__free">
          <span>Dashboard name</span>
          <input className="im-input" value={name ?? defaultName} maxLength={120} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void finish(); }} />
        </label>
        <div className="wiz__foot">
          <button className="im-btn im-btn-ghost" onClick={back} disabled={finishing}>Back</button>
          <div className="grow" />
          <button className="im-btn im-btn-primary" onClick={() => void finish()} disabled={finishing}>
            {finishing ? <><span className="spinner wiz__spin" /> Building your dashboard</> : "Open dashboard"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <Shell title="Set up your dashboard" actions={<Link className="im-btn im-btn-ghost" href="/">Save and exit</Link>}>
      <PeriodProvider state={period} onChange={noop}>
        <div className="wiz">
          {rail}
          <section className="wiz__main" ref={mainRef}>
            <div className="wiz__progress" role="progressbar" aria-label={progressLabel} aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.round(progress * total)}>
              <div className="wiz__bar"><i style={{ width: `${Math.max(progress * 100, 2)}%` }} /></div>
              <span>{progressLabel}</span>
            </div>
            {body}
          </section>
        </div>
      </PeriodProvider>
    </Shell>
  );
}
