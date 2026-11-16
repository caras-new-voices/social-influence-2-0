import { getDb, type Row } from "./db";
import { ensureReady } from "./schema";
import { MAX_TOP_UP, type BalanceInfo, type UsageKind, type UsageLine } from "./usage-shared";

/**
 * Token usage and the account balance.
 *
 * usage_events is the log: one row per interaction with the model. token_ledger is the account:
 * one row per change to the balance (the starting grant, top-ups, and one spend per usage event).
 * The balance is the sum of the ledger. Every model call in the product goes through recordUsage.
 */

export const STARTING_TOKENS = Number(process.env.STARTING_TOKENS ?? 1_000_000) || 1_000_000;

/**
 * Estimated price per million tokens, in USD, by model family. These are working estimates for the
 * usage page, not a price list: override with USAGE_PRICES='{"opus":[5,25],"gpt-5":[1.25,10]}'.
 */
const DEFAULT_PRICES: Array<[string, [number, number]]> = [
  ["opus", [5, 25]],
  ["sonnet", [3, 15]],
  ["haiku", [1, 5]],
  ["realtime", [4, 16]],
  ["gpt", [1.25, 10]],
];
const FALLBACK_PRICE: [number, number] = [3, 15];

function priceFor(model: string): [number, number] {
  let table = DEFAULT_PRICES;
  try {
    const env = process.env.USAGE_PRICES ? (JSON.parse(process.env.USAGE_PRICES) as Record<string, [number, number]>) : null;
    if (env) table = [...Object.entries(env), ...DEFAULT_PRICES];
  } catch {
    /* ignore a malformed override */
  }
  const m = model.toLowerCase();
  return table.find(([k]) => m.includes(k.toLowerCase()))?.[1] ?? FALLBACK_PRICE;
}

export function estimateCost(model: string, input: number, output: number): number {
  const [pin, pout] = priceFor(model);
  return (input * pin + output * pout) / 1_000_000;
}

/** Rough token count for text when the provider reports none (demo mode): about four characters a token. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export interface UsageInput {
  kind: UsageKind;
  dashboardId?: string | null;
  label?: string;
  provider: "claude" | "openai" | "demo";
  model: string;
  input: number;
  output: number;
  cached?: number;
  rounds?: number;
  toolCalls?: number;
  durationMs?: number;
  estimated?: boolean;
  automatic?: boolean;
  messageId?: number | null;
}

/** Writes the usage event and its spend on the ledger; returns the line to show under the answer. */
export async function recordUsage(u: UsageInput): Promise<UsageLine> {
  await ensureReady();
  const db = await getDb();
  const input = Math.max(0, Math.round(u.input));
  const output = Math.max(0, Math.round(u.output));
  const total = input + output;
  const [ev] = await db.query<{ id: number }>(
    `INSERT INTO usage_events (dashboard_id, kind, label, provider, model, input_tokens, output_tokens, cached_tokens, total_tokens, rounds, tool_calls, duration_ms, estimated, automatic, cost_usd, message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
    [u.dashboardId ?? null, u.kind, (u.label ?? "").replace(/\s+/g, " ").trim().slice(0, 160) || null, u.provider, u.model, input, output, Math.round(u.cached ?? 0), total,
      u.rounds ?? 1, u.toolCalls ?? 0, Math.round(u.durationMs ?? 0), !!u.estimated, !!u.automatic, estimateCost(u.model, input, output), u.messageId ?? null],
  );
  const [led] = await db.query<{ balance_after: number }>(
    `INSERT INTO token_ledger (kind, tokens, usage_event_id, balance_after)
     SELECT 'usage', $1::bigint, $2, coalesce((SELECT sum(tokens) FROM token_ledger), 0) + $1::bigint RETURNING balance_after`,
    [-total, ev.id],
  );
  return { input, output, total, estimated: !!u.estimated, model: u.model, balance: Number(led.balance_after) };
}

export function topUpEnabled(): boolean {
  return process.env.DEMO_TOPUP !== "0";
}

export async function getBalance(dashboardId?: string | null): Promise<BalanceInfo> {
  await ensureReady();
  const db = await getDb();
  const [r] = await db.query<{ balance: number; today: number; month: number; ref: number | null }>(`
    SELECT coalesce((SELECT sum(tokens) FROM token_ledger), 0) AS balance,
           coalesce((SELECT sum(total_tokens) FROM usage_events WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')), 0) AS today,
           coalesce((SELECT sum(total_tokens) FROM usage_events WHERE created_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')), 0) AS month,
           (SELECT balance_after FROM token_ledger WHERE tokens > 0 ORDER BY id DESC LIMIT 1) AS ref`);
  const balance = Number(r.balance);
  const info: BalanceInfo = {
    balance,
    usedToday: Number(r.today),
    usedMonth: Number(r.month),
    low: balance > 0 && balance < 0.1 * Number(r.ref ?? STARTING_TOKENS),
    out: balance <= 0,
    canTopUp: topUpEnabled(),
  };
  if (dashboardId) {
    const [d] = await db.query<{ n: number }>(`SELECT coalesce(sum(total_tokens), 0) AS n FROM usage_events WHERE dashboard_id = $1 AND created_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`, [dashboardId]);
    info.dashboardMonth = Number(d.n);
  }
  return info;
}

/** New model turns are allowed only with a positive balance. */
export async function canSpend(): Promise<boolean> {
  return (await getBalance()).balance > 0;
}

export async function topUp(tokens: number, note?: string): Promise<BalanceInfo> {
  await ensureReady();
  const n = Math.round(tokens);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_TOP_UP) throw new Error(`Amount must be between 1 and ${MAX_TOP_UP.toLocaleString("en-US")} tokens.`);
  const db = await getDb();
  await db.query(
    `INSERT INTO token_ledger (kind, tokens, note, balance_after) SELECT 'top_up', $1::bigint, $2, coalesce((SELECT sum(tokens) FROM token_ledger), 0) + $1::bigint`,
    [n, note ?? `Added ${n.toLocaleString("en-US")} tokens (demo)`],
  );
  return getBalance();
}

/* ------------------------------------------------------------------ */
/* Reading: the usage page                                               */
/* ------------------------------------------------------------------ */

export interface UsageRange {
  from?: string; // ISO date, inclusive
  to?: string;   // ISO date, exclusive
}

function rangeClause(r: UsageRange, params: unknown[], col = "created_at"): string {
  const parts: string[] = [];
  if (r.from) { params.push(r.from); parts.push(`${col} >= $${params.length}::date`); }
  if (r.to) { params.push(r.to); parts.push(`${col} < $${params.length}::date`); }
  return parts.length ? parts.join(" AND ") : "true";
}

export interface UsageSummary {
  range: UsageRange;
  totals: { tokens: number; input: number; output: number; interactions: number; average: number; cost: number; estimatedShare: number };
  daily: Array<{ day: string; kind: string; tokens: number }>;
  byKind: Array<{ kind: string; interactions: number; tokens: number; cost: number }>;
  byDashboard: Array<{ dashboard_id: string | null; name: string | null; interactions: number; tokens: number; last_used: string }>;
  byModel: Array<{ model: string; provider: string; interactions: number; tokens: number; cost: number }>;
}

export async function getUsageSummary(range: UsageRange): Promise<UsageSummary> {
  await ensureReady();
  const db = await getDb();
  const p: unknown[] = [];
  const where = rangeClause(range, p);
  const num = (v: unknown) => Number(v ?? 0) || 0;
  const [t] = await db.query<Row>(
    `SELECT coalesce(sum(total_tokens), 0) AS tokens, coalesce(sum(input_tokens), 0) AS input, coalesce(sum(output_tokens), 0) AS output, count(*)::int AS interactions,
            coalesce(sum(cost_usd), 0) AS cost, coalesce(sum(total_tokens) FILTER (WHERE estimated), 0) AS est
     FROM usage_events WHERE ${where}`, p);
  const daily = await db.query<Row>(
    `SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day, kind, sum(total_tokens) AS tokens FROM usage_events WHERE ${where} GROUP BY 1, 2 ORDER BY 1`, p);
  const byKind = await db.query<Row>(
    `SELECT kind, count(*)::int AS interactions, sum(total_tokens) AS tokens, sum(cost_usd) AS cost FROM usage_events WHERE ${where} GROUP BY 1 ORDER BY 3 DESC`, p);
  const pd: unknown[] = [];
  const byDashboard = await db.query<Row>(
    `SELECT u.dashboard_id, d.name, count(*)::int AS interactions, sum(u.total_tokens) AS tokens, max(u.created_at) AS last_used
     FROM usage_events u LEFT JOIN dashboards d ON d.id = u.dashboard_id WHERE ${rangeClause(range, pd, "u.created_at")} GROUP BY 1, 2 ORDER BY 4 DESC LIMIT 50`,
    pd);
  const byModel = await db.query<Row>(
    `SELECT model, provider, count(*)::int AS interactions, sum(total_tokens) AS tokens, sum(cost_usd) AS cost FROM usage_events WHERE ${where} GROUP BY 1, 2 ORDER BY 4 DESC`, p);
  const tokens = num(t.tokens), interactions = num(t.interactions);
  return {
    range,
    totals: { tokens, input: num(t.input), output: num(t.output), interactions, average: interactions ? Math.round(tokens / interactions) : 0, cost: num(t.cost), estimatedShare: tokens ? num(t.est) / tokens : 0 },
    daily: daily.map((r) => ({ day: String(r.day), kind: String(r.kind), tokens: num(r.tokens) })),
    byKind: byKind.map((r) => ({ kind: String(r.kind), interactions: num(r.interactions), tokens: num(r.tokens), cost: num(r.cost) })),
    byDashboard: byDashboard.map((r) => ({ dashboard_id: (r.dashboard_id as string | null) ?? null, name: (r.name as string | null) ?? null, interactions: num(r.interactions), tokens: num(r.tokens), last_used: new Date(r.last_used as string).toISOString() })),
    byModel: byModel.map((r) => ({ model: String(r.model), provider: String(r.provider), interactions: num(r.interactions), tokens: num(r.tokens), cost: num(r.cost) })),
  };
}

export interface UsageEventRow {
  id: number;
  created_at: string;
  dashboard_id: string | null;
  dashboard_name: string | null;
  kind: string;
  label: string | null;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  rounds: number;
  tool_calls: number;
  duration_ms: number;
  estimated: boolean;
  automatic: boolean;
  cost_usd: number;
}

export async function listUsageEvents(f: UsageRange & { dashboardId?: string; kind?: string; before?: number; limit?: number }): Promise<UsageEventRow[]> {
  await ensureReady();
  const db = await getDb();
  const p: unknown[] = [];
  const parts = [rangeClause(f, p, "u.created_at")];
  if (f.dashboardId) { p.push(f.dashboardId); parts.push(`u.dashboard_id = $${p.length}`); }
  if (f.kind) { p.push(f.kind); parts.push(`u.kind = $${p.length}`); }
  if (f.before) { p.push(f.before); parts.push(`u.id < $${p.length}`); }
  p.push(Math.min(Math.max(f.limit ?? 100, 1), 5000));
  const rows = await db.query<Row>(
    `SELECT u.id::int AS id, u.created_at, u.dashboard_id, d.name AS dashboard_name, u.kind, u.label, u.provider, u.model, u.input_tokens, u.output_tokens, u.total_tokens,
            u.rounds, u.tool_calls, u.duration_ms, u.estimated, u.automatic, u.cost_usd
     FROM usage_events u LEFT JOIN dashboards d ON d.id = u.dashboard_id WHERE ${parts.join(" AND ")} ORDER BY u.id DESC LIMIT $${p.length}`, p);
  return rows.map((r) => ({
    id: Number(r.id), created_at: new Date(r.created_at as string).toISOString(), dashboard_id: (r.dashboard_id as string | null) ?? null, dashboard_name: (r.dashboard_name as string | null) ?? null,
    kind: String(r.kind), label: (r.label as string | null) ?? null, provider: String(r.provider), model: String(r.model),
    input_tokens: Number(r.input_tokens), output_tokens: Number(r.output_tokens), total_tokens: Number(r.total_tokens), rounds: Number(r.rounds), tool_calls: Number(r.tool_calls),
    duration_ms: Number(r.duration_ms), estimated: !!r.estimated, automatic: !!r.automatic, cost_usd: Number(r.cost_usd),
  }));
}

export interface StatementRow {
  at: string;
  kind: "grant" | "top_up" | "usage" | "adjustment";
  tokens: number;
  note: string;
  balance_after: number;
  interactions?: number;
}

/** The account statement: grants and top-ups one by one, usage as one line per day. Newest first. */
export async function getStatement(limit = 120): Promise<StatementRow[]> {
  await ensureReady();
  const db = await getDb();
  const rows = await db.query<Row>(`
    SELECT * FROM (
      SELECT created_at AS at, kind, tokens, coalesce(note, '') AS note, balance_after, NULL::int AS interactions, id AS ord FROM token_ledger WHERE kind <> 'usage'
      UNION ALL
      SELECT max(created_at), 'usage', sum(tokens), '', (array_agg(balance_after ORDER BY id DESC))[1], count(*)::int, max(id) FROM token_ledger WHERE kind = 'usage' GROUP BY date_trunc('day', created_at AT TIME ZONE 'UTC')
    ) s ORDER BY ord DESC LIMIT $1`, [limit]);
  return rows.map((r) => ({
    at: new Date(r.at as string).toISOString(), kind: r.kind as StatementRow["kind"], tokens: Number(r.tokens), note: String(r.note ?? ""),
    balance_after: Number(r.balance_after), interactions: r.interactions == null ? undefined : Number(r.interactions),
  }));
}

/** CSV of the log, for invoicing. */
export function eventsToCsv(rows: UsageEventRow[]): string {
  const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["id", "time", "dashboard", "kind", "label", "provider", "model", "input_tokens", "output_tokens", "total_tokens", "rounds", "tool_calls", "duration_ms", "estimated", "automatic", "cost_usd_estimate"];
  const lines = rows.map((r) => [r.id, r.created_at, r.dashboard_name ?? r.dashboard_id ?? "", r.kind, r.label ?? "", r.provider, r.model, r.input_tokens, r.output_tokens, r.total_tokens, r.rounds, r.tool_calls, r.duration_ms, r.estimated, r.automatic, r.cost_usd.toFixed(5)].map(esc).join(","));
  return [head.join(","), ...lines].join("\n") + "\n";
}
