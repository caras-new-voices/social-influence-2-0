"use client";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ALL_TIME, resolveCompare, resolveWindow, type Coverage, type PeriodState, type PeriodWindow } from "@/lib/period";

export interface PeriodContextValue {
  state: PeriodState;
  /** Main window derived from state (empty object means all time). */
  window: PeriodWindow;
  /** Comparison window, or null when comparison is off. */
  compareWindow: PeriodWindow | null;
  setState: (next: PeriodState) => void;
  coverage: Coverage | null;
}

const Ctx = createContext<PeriodContextValue>({ state: ALL_TIME, window: {}, compareWindow: null, setState: () => {}, coverage: null });

export function usePeriod(): PeriodContextValue {
  return useContext(Ctx);
}

let coverageCache: Promise<Coverage> | null = null;
export function fetchCoverage(force = false): Promise<Coverage> {
  if (!coverageCache || force) {
    coverageCache = fetch("/api/coverage").then((r) => r.json() as Promise<Coverage>);
    coverageCache.catch(() => { coverageCache = null; });
  }
  return coverageCache;
}

export function PeriodProvider({ state, onChange, children }: { state: PeriodState; onChange: (next: PeriodState) => void; children: ReactNode }) {
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  useEffect(() => {
    fetchCoverage().then(setCoverage).catch(() => {});
  }, []);
  const value = useMemo<PeriodContextValue>(
    () => ({ state, window: resolveWindow(state), compareWindow: resolveCompare(state), setState: onChange, coverage }),
    [state, onChange, coverage],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
