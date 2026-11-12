"use client";
/**
 * Client-side store for period events (new data notifications). One poller per tab, shared by the
 * header bell, the dashboard banner and the chat nudge. Polls every 60 s and on window focus.
 * Read state is per browser (localStorage) until auth exists.
 */
import { useSyncExternalStore } from "react";
import { addMonths, formatMonth, monthKey } from "@/lib/period";
import type { PeriodEvent } from "@/lib/period-events";
import { fetchCoverage } from "./PeriodContext";

export type { PeriodEvent };

const POLL_MS = 60_000;
export const SEEN_KEY = "si.events.seen";

let events: PeriodEvent[] | null = null;
let maxId: number | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inflight: Promise<void> | null = null;

function emit() {
  listeners.forEach((l) => l());
}

export function refreshPeriodEvents(): Promise<void> {
  if (inflight) return inflight;
  inflight = fetch("/api/period-events?limit=30")
    .then((r) => (r.ok ? (r.json() as Promise<{ events: PeriodEvent[] }>) : Promise.reject(new Error(String(r.status)))))
    .then(({ events: list }) => {
      const top = list.reduce((m, e) => Math.max(m, e.id), 0);
      if (maxId !== null && top > maxId) onNewData();
      maxId = top;
      events = list;
      emit();
    })
    .catch(() => {})
    .finally(() => { inflight = null; });
  return inflight;
}

/** New data arrived while the page was open: drop cached element results and coverage. */
function onNewData() {
  void import("./WidgetCard").then((m) => m.clearWidgetCache()).catch(() => {});
  void fetchCoverage(true).catch(() => {});
  window.dispatchEvent(new CustomEvent("si:data-updated"));
}

function onFocus() {
  void refreshPeriodEvents();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  if (listeners.size === 1) {
    void refreshPeriodEvents();
    timer = setInterval(() => void refreshPeriodEvents(), POLL_MS);
    window.addEventListener("focus", onFocus);
  }
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
    if (listeners.size === 0) {
      if (timer) clearInterval(timer);
      timer = null;
      window.removeEventListener("focus", onFocus);
    }
  };
}

/** All recent events, newest first; null until the first fetch. */
export function usePeriodEvents(): PeriodEvent[] | null {
  return useSyncExternalStore(subscribe, () => events, () => null);
}

/* ---------------------------------------------------------------- */
/* Per-browser read state                                             */
/* ---------------------------------------------------------------- */

export function readNumber(key: string): number {
  try {
    return Number(window.localStorage.getItem(key) ?? 0) || 0;
  } catch {
    return 0;
  }
}
export function writeNumber(key: string, v: number) {
  try {
    window.localStorage.setItem(key, String(v));
  } catch {
    /* ignore */
  }
  emit();
}
/** Reactive localStorage number (0 on the server and before hydration). */
export function useStoredNumber(key: string): number {
  return useSyncExternalStore(subscribe, () => readNumber(key), () => 0);
}

/* ---------------------------------------------------------------- */
/* Presentation helpers                                               */
/* ---------------------------------------------------------------- */

const DATA_KINDS = ["month_completed", "month_started", "month_revised"];
const RANK: Record<string, number> = { month_completed: 3, month_started: 2, month_revised: 1 };

/**
 * The event the banner and the chat nudge talk about: from the newest import that brought data,
 * the completed month first, then a started one, then a revision that added rows.
 */
export function latestDataEvent(list: PeriodEvent[] | null): PeriodEvent | null {
  const candidates = (list ?? []).filter((e) => DATA_KINDS.includes(e.kind) && (e.kind !== "month_revised" || e.summary.posts_delta > 0 || e.summary.comments_delta > 0));
  if (!candidates.length) return null;
  const importId = candidates[0].import_id;
  const same = candidates.filter((e) => e.import_id === importId);
  return same.sort((a, b) => RANK[b.kind] - RANK[a.kind] || b.period_start.localeCompare(a.period_start))[0];
}

export function eventMonth(e: PeriodEvent): string {
  return monthKey(e.period_start);
}
export function previousMonth(month: string): string {
  return addMonths(`${month}-01`, -1).slice(0, 7);
}
export function shortMonth(month: string): string {
  return formatMonth(month).split(" ")[0];
}

export const KIND_LABEL: Record<string, string> = {
  month_completed: "Month complete",
  month_started: "New month started",
  month_revised: "Month revised",
  month_missing: "Data missing",
};

const fmt = (n: number) => Math.abs(n).toLocaleString("en-US");
const plural = (n: number, one: string, many: string) => `${fmt(n)} ${Math.abs(n) === 1 ? one : many}`;
const signed = (n: number, one: string, many: string) => `${n >= 0 ? "+" : "−"}${plural(n, one, many)}`;

/** "1,120 new posts, 5,300 comments" (new rows when the import added rows, otherwise month totals). */
export function countsText(e: PeriodEvent): string {
  const s = e.summary;
  if (e.kind === "month_missing") return `No complete data yet (${plural(s.posts, "post", "posts")}, ${plural(s.comments, "comment", "comments")} so far)`;
  if (e.kind === "month_revised") return `${signed(s.posts_delta, "post", "posts")}, ${signed(s.comments_delta, "comment", "comments")}`;
  if (s.posts_delta > 0 || s.comments_delta > 0) return `${plural(s.posts_delta, "new post", "new posts")}, ${plural(s.comments_delta, "comment", "comments")}`;
  return `${plural(s.posts, "post", "posts")}, ${plural(s.comments, "comment", "comments")}`;
}

/** One-line headline used by the banner. */
export function headline(e: PeriodEvent): string {
  const label = e.summary.label || formatMonth(eventMonth(e));
  if (e.kind === "month_completed") return `${label} data is in: ${countsText(e)}.`;
  if (e.kind === "month_started") return `First ${label} data is in (month in progress): ${countsText(e)}.`;
  if (e.kind === "month_revised") return `${label} data was updated: ${countsText(e)}.`;
  return `${label} has no complete data yet.`;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
