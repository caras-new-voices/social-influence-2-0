"use client";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ALL_TIME, resolveCompare, resolveWindow, type Coverage, type PeriodState, type PeriodWindow } from "@/lib/period";

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
  const [dataVersion, setDataVersion] = useState(0);
  useEffect(() => {
    fetchCoverage().then(setCoverage).catch(() => {});
    // Fired by the period-events poller when an import landed: refresh coverage and every element.
    const onData = () => { fetchCoverage(true).then(setCoverage).catch(() => {}); setDataVersion((v) => v + 1); };
    window.addEventListener("si:data-updated", onData);
    return () => window.removeEventListener("si:data-updated", onData);
  }, []);
  const value = useMemo<PeriodContextValue>(
    () => ({ state, dataVersion, window: resolveWindow(state), compareWindow: resolveCompare(state), setState: onChange, coverage }),
    [state, dataVersion, onChange, coverage],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
