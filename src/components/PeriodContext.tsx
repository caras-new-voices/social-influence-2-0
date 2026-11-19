"use client";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getWorkspace } from "@/lib/brands";
import { ALL_TIME, resolveCompare, resolveWindow, type Coverage, type PeriodState, type PeriodWindow } from "@/lib/period";
import { scopeKey } from "@/lib/scope-shared";

export interface PeriodContextValue {
  state: PeriodState;
  /** Bumped when new data arrives so elements refetch. */
  dataVersion: number;
  /** Main window derived from state (empty object means all time). */
  window: PeriodWindow;
  /** Comparison window, or null when comparison is off. */
  compareWindow: PeriodWindow | null;
  setState: (next: PeriodState) => void;
  coverage: Coverage | null;
}

const Ctx = createContext<PeriodContextValue>({ state: ALL_TIME, dataVersion: 0, window: {}, compareWindow: null, setState: () => {}, coverage: null });

export function usePeriod(): PeriodContextValue {
  return useContext(Ctx);
}

const coverageCache = new Map<string, Promise<Coverage>>();
/** Coverage of the page's brands (the workspace scope). `force` drops what was cached for every scope. */
export function fetchCoverage(force = false, market?: string | null): Promise<Coverage> {
  if (force) coverageCache.clear();
  const scope = getWorkspace().scope ?? null;
  const key = `${scopeKey(scope)}@${market ?? ""}`;
  let p = coverageCache.get(key);
  if (!p) {
    const qs = new URLSearchParams({ ...(scope ? { scope: JSON.stringify(scope) } : {}), ...(market ? { market } : {}) }).toString();
    p = fetch(`/api/coverage${qs ? `?${qs}` : ""}`).then((r) => r.json() as Promise<Coverage>);
    coverageCache.set(key, p);
    p.catch(() => coverageCache.delete(key));
  }
  return p;
}

export function PeriodProvider({ state, onChange, children }: { state: PeriodState; onChange: (next: PeriodState) => void; children: ReactNode }) {
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const market = state.market ?? null;
  useEffect(() => {
    // The dates, the totals and the month picker follow the market; the last answer stays on screen until the new one arrives.
    let live = true;
    const show = (c: Coverage) => { if (live) setCoverage(c); };
    fetchCoverage(false, market).then(show).catch(() => {});
    // Fired by the period-events poller when an import landed: refresh coverage and every element.
    const onData = () => { fetchCoverage(true, market).then(show).catch(() => {}); setDataVersion((v) => v + 1); };
    window.addEventListener("si:data-updated", onData);
    return () => { live = false; window.removeEventListener("si:data-updated", onData); };
  }, [market]);
  const value = useMemo<PeriodContextValue>(
    () => ({ state, dataVersion, window: resolveWindow(state), compareWindow: resolveCompare(state), setState: onChange, coverage }),
    [state, dataVersion, onChange, coverage],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
