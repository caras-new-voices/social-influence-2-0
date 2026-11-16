/** Token usage: the types and constants shared by the server and the browser. */

export const USAGE_KINDS = ["chat", "ask_element", "explain_change", "scan", "wizard_step", "wizard_discuss", "month_review", "sql_assist", "voice"] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

export const KIND_LABELS: Record<UsageKind, string> = {
  chat: "Chat with the analyst",
  ask_element: "Ask AI on an element",
  explain_change: "Explain the change",
  scan: "Where should I start?",
  wizard_step: "Guided setup: questions",
  wizard_discuss: "Guided setup: discussion",
  month_review: "Month in review",
  sql_assist: "Query assistant",
  voice: "Voice",
};

/** What one interaction used, as shown under the answer. */
export interface UsageLine {
  input: number;
  output: number;
  total: number;
  /** True when the numbers are estimated from text length (demo mode, no model key). */
  estimated: boolean;
  model: string;
  /** Account balance after this interaction. */
  balance: number;
}

export interface BalanceInfo {
  balance: number;
  usedToday: number;
  usedMonth: number;
  /** Under 10 percent of the balance right after the last grant or top-up. */
  low: boolean;
  out: boolean;
  /** Tokens used by one dashboard this month, when a dashboard was asked for. */
  dashboardMonth?: number;
  /** Whether the demo top-up is enabled on this deployment. */
  canTopUp: boolean;
}

/** Demo top-up packs. */
export const TOKEN_PACKS = [250_000, 1_000_000, 5_000_000];
export const MAX_TOP_UP = 50_000_000;

/** 987K, 1.2M, 842. */
export function formatTokens(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (abs >= 1e4) return `${Math.round(n / 1e3)}K`;
  return Math.round(n).toLocaleString("en-US");
}

/** Browser event fired after any interaction or top-up so the header pill and pages refresh. */
export const USAGE_EVENT = "si:usage";
export function announceUsage(balance?: number) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(USAGE_EVENT, { detail: { balance } }));
}

export const OUT_OF_TOKENS = "out_of_tokens";
export const OUT_OF_TOKENS_MESSAGE = "You are out of tokens. Add tokens to keep using the analyst.";
