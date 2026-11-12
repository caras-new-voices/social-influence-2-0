import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { z } from "zod";
import { BRANDS, FOCAL_BRAND } from "./brands";
import { getCoverage } from "./coverage";
import { formatWindow, ISO_DATE, monthPeriod, PeriodStateSchema, resolveCompare, resolveWindow, type PeriodState, type PeriodWindow } from "./period";
import { getDb, type Row } from "./db";
import { runWidgetQuery } from "./query";
import { ensureReady } from "./schema";
import { DATASET_DOC } from "./schema-doc";
import { materialize, ProposedWidgetSchema, START_SCAN_LABEL, type ProposedWidget, type WidgetSpec } from "./widgets";

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "status"; text: string }
  | { type: "query"; sql: string; ok: boolean; rows?: number; error?: string; ms?: number }
  | { type: "widget"; widget: WidgetSpec; data: Row[]; replaces?: string; error?: string }
  | { type: "followups"; items: string[] }
  | { type: "period"; period: PeriodState }
  | { type: "done"; messageId: number | null }
  | { type: "error"; message: string };

export interface WidgetSummary {
  id: string;
  type: string;
  title: string;
}

export interface ChatTurnInput {
  dashboardId: string;
  /** What the person sees as their message. */
  userText: string;
  /** Optional fuller instruction sent to the model instead of userText (for guided actions). */
  instruction?: string;
  widgets: WidgetSummary[];
  /** The dashboard's current period; queries run within it. */
  period?: PeriodState;
  /** Guided setup: the scripted text and the element recipes for this step (used by demo mode; the LLM path gets them through `instruction`). */
  wizard?: { text: string; proposals: ProposedWidget[] };
}

type MsgParam = Anthropic.Beta.BetaMessageParam;
type ContentBlock = Anthropic.Beta.BetaContentBlockParam;

export type LlmMode = "openai" | "claude" | "mock";

/** Provider selection: OpenAI when its key is present, otherwise Claude, otherwise the scripted demo. */
export function llmMode(): LlmMode {
  if (process.env.MOCK_LLM === "1") return "mock";
  const forced = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (forced === "openai" && openAiKey()) return "openai";
  if (forced === "claude" && process.env.ANTHROPIC_API_KEY) return "claude";
  if (openAiKey()) return "openai";
  return process.env.ANTHROPIC_API_KEY ? "claude" : "mock";
}

function openAiKey(): string | undefined {
  return process.env.OPEN_AI_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || undefined;
}

export function llmModel(): string {
  const mode = llmMode();
  if (mode === "openai") return OPENAI_MODEL;
  if (mode === "claude") return MODEL;
  return "demo";
}

export function hasWorkspaceHeader(): boolean {
  return !!process.env.ANTHROPIC_WORKSPACE_ID?.trim();
}

/** Turns the most common configuration errors into instructions the person can act on. */
function friendlyApiError(err: InstanceType<typeof Anthropic.APIError>): string {
  const msg = err.message ?? "";
  if (/anthropic-workspace-id/i.test(msg)) {
    return hasWorkspaceHeader()
      ? "The Claude API rejected the workspace ID in ANTHROPIC_WORKSPACE_ID. Check the value in the Anthropic Console under Settings > Workspaces, or create an API key inside a workspace and use that instead."
      : "The Claude API key is an organisation-level key that is not tied to a workspace. Either create an API key inside a workspace in the Anthropic Console and set it as ANTHROPIC_API_KEY, or add ANTHROPIC_WORKSPACE_ID (Settings > Workspaces) to the deployment's environment variables. Redeploy after changing either.";
  }
  if (err.status === 401) return "The Claude API key was rejected (401). Check ANTHROPIC_API_KEY in the deployment's environment variables and redeploy.";
  if (err.status === 429) return "The Claude API is rate limiting this key (429). Try again in a moment.";
  return `Claude API error ${err.status}: ${msg}`;
}

const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.2";
const EFFORT = (process.env.CLAUDE_EFFORT ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max";
const MAX_TOOL_ROUNDS = 8;
const TOOL_RESULT_CHAR_CAP = 7000;
const HISTORY_ROWS = 30;

/* ------------------------------------------------------------------ */
/* Prompt                                                                */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `You are the analyst inside the Social Influence workspace, an IMAI product. You help a brand team at P&G understand creator content and audience reactions about ${FOCAL_BRAND.name} and its competitors (${BRANDS.filter((b) => b.role === "competitor").map((b) => b.name).join(", ")}), and you help them build a dashboard.

You have three tools:
- run_sql: run a read-only Postgres SELECT against the dataset and read the rows. It runs within the dashboard's current period (see Time periods below).
- propose_widget: propose a dashboard element (a saved query plus a rendering recipe). The person sees a preview card and decides whether to add it. You cannot add widgets yourself.
- set_period: change the dashboard's global period (a month, a date range, or all time) and optionally the comparison period. Use it when the person asks to look at a month or range, or to compare periods ("show me June versus May"); every element on the dashboard follows it. Do not use it for a one-off question you can answer with posts_all.

${DATASET_DOC}

## How to work
- Ground every claim in a query. Never guess numbers. Run the queries you need (usually 1 to 3) before answering; keep result sets small by aggregating in SQL. For examples of verbatim comments select at most 8 rows and use left(text, 220).
- Postgres syntax only. Single SELECT or WITH statement, no semicolons. For "versus the previous period" use posts_all/comments_all with period_start() and period_end() (see Time periods). Useful idioms: count(*) FILTER (WHERE ...), to_char(date_trunc('month', published_at), 'YYYY-MM') AS month, round(x::numeric, 3), NULLIF for divisions, ::int casts for counts.
- Brand strings must match exactly: ${BRANDS.map((b) => `'${b.name}'`).join(", ")}. "Us", "our brand" and "we" mean ${FOCAL_BRAND.name}.
- Read the whole result; summarise the pattern, name the leaders and the laggards, quote the key numbers (rounded, with units), and say what it means for ${FOCAL_BRAND.name}. Be concrete and concise: a short lead sentence, then 2 to 5 bullets or a short paragraph. Use markdown (bold, bullets, small tables). Do not paste SQL into the answer unless asked.
- Propose widgets when the person asks for a chart, a card, a table, a dashboard element, or asks to track or compare something over time. Also propose one when a visual clearly adds value to a question you answered. Propose at most 3 per turn. Before proposing, run the exact SQL once with run_sql to make sure it works and returns the right shape. Mention each proposal briefly in your reply by title, e.g. "I've proposed a chart: Engagement trend by brand".
- When the person wants to change an existing widget (different brands, platform, metric, chart type, time grain, title), call propose_widget with the full new spec and set replaces_widget_id to the id of the widget it replaces. The dashboard context in each message lists the current widgets with their ids.
- If a query fails, read the error, fix the SQL and retry. Do not report an error to the person unless you cannot fix it.
- Never name third-party data providers, listening platforms or collection tooling. If asked where the data comes from, say it was collected by IMAI's social listening and enriched by IMAI.

## Widget recipes (propose_widget input)
Grid: 12 columns, 1 row = 56px. Typical sizes: kpi width 12 height 2, bar/stacked_bar/segmented width 6 height 5, line width 8 height 5, table width 12 height 6, insight width 6 height 5, text width 4 height 3, section width 12 height 1.
- kpi: a row of stat tiles. SQL returns one row per tile with columns label, value, optional compare (benchmark value; a delta versus it is shown), optional fmt ('compact' | 'percent' | 'currency' | 'number'). Use UNION ALL to build the rows.
- bar: SQL returns {x, value} rows; set x to the category column and y to the value column. horizontal true for long category names or ranked lists. One series: do not set series.
- line: SQL returns {x, value} or long format {x, series, value} ordered by x ascending; x is usually month. Set x, y and (for long format) series.
- stacked_bar: long format {x, series, value}; set x, y, series. normalize true to show shares (then format 'percent').
- segmented: one whole split into at most 6 parts: {x, value}; use for a single share breakdown.
- table: any columns, at most 50 rows; columns named url or link render as links; name columns clearly (snake_case is shown as words).
- insight: SQL returns one row with headline and body (body may be HTML with h3, ul, li, strong, p) OR give content directly. Use for the precomputed strategy insights in the segments table or for a written summary you author.
- text: content only (notes, callouts). section: title only (a header row that organises the dashboard).
- colorBy: 'brand' when the series or categories are brands, 'sentiment' for positive/neutral/negative, 'platform', 'tier' for nano..mega, otherwise 'auto'.
- format: 'compact' for large counts, 'percent' for fractions 0..1, 'currency' for EMV and budgets, 'number' for small counts, 'decimal' for rates like 0.034.
- Alias the value column AS value, the category AS the name you pass in x, and the series AS the name you pass in series. Always add rationale (one sentence: why this element matters).

## Follow-ups
End your final reply (the one with no further tool calls) with one last line in exactly this form:
FOLLOWUPS: ["...", "...", "..."]
Give 2 or 3 short next questions (under 70 characters each) written in the person's voice, each a natural next step from what you just showed: a different platform, a time split, a competitor, a verbatim example, or turning the answer into a dashboard element. The line is hidden from the person and rendered as buttons. Do not add it while you are still calling tools.`;

/* ------------------------------------------------------------------ */
/* Tools                                                                 */
/* ------------------------------------------------------------------ */

const RunSqlInput = z.object({ sql: z.string().min(1), purpose: z.string().optional() });
const SetPeriodInput = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  start: z.string().regex(ISO_DATE).optional(),
  end: z.string().regex(ISO_DATE).optional(),
  all: z.boolean().optional(),
  compare: z.enum(["none", "previous", "same_last_year"]).optional(),
  compare_start: z.string().regex(ISO_DATE).optional(),
  compare_end: z.string().regex(ISO_DATE).optional(),
});
const ProposeInput = ProposedWidgetSchema.extend({ replaces_widget_id: z.string().optional() });

const TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  {
    name: "run_sql",
    description: "Run a read-only Postgres SELECT against the social listening dataset and return up to 500 rows as JSON. Aggregate in SQL; keep result sets small.",
    input_schema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A single SELECT or WITH statement, Postgres syntax, no trailing semicolon." },
        purpose: { type: "string", description: "A few words on what this query is for (shown to the person as a status line)." },
      },
      required: ["sql"],
    },
    eager_input_streaming: true,
  },
  {
    name: "propose_widget",
    description: "Propose a dashboard element for the person to approve. Returns whether the SQL ran and the shape of the data. The person sees a live preview card and can add, replace, or dismiss it.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["kpi", "line", "bar", "stacked_bar", "segmented", "table", "text", "section", "insight"] },
        title: { type: "string" },
        subtitle: { type: "string" },
        sql: { type: "string", description: "Read-only SQL returning the rows to render. Omit for text and section." },
        x: { type: "string", description: "Category or x-axis column." },
        y: { type: "string", description: "Value column (default value)." },
        series: { type: "string", description: "Column whose distinct values become series (long format)." },
        colorBy: { type: "string", enum: ["brand", "platform", "sentiment", "tier", "auto"] },
        format: { type: "string", enum: ["number", "compact", "percent", "currency", "decimal"] },
        horizontal: { type: "boolean" },
        normalize: { type: "boolean" },
        content: { type: "string", description: "Text for text, section or insight widgets." },
        rationale: { type: "string" },
        width: { type: "integer", minimum: 3, maximum: 12 },
        height: { type: "integer", minimum: 2, maximum: 10 },
        replaces_widget_id: { type: "string", description: "Set when this proposal should replace an existing widget." },
        period: { type: "string", enum: ["inherit", "all"], description: "inherit (default): the element follows the dashboard period. all: the element always shows all time." },
      },
      required: ["type", "title", "rationale"],
    },
    eager_input_streaming: true,
  },
  {
    name: "set_period",
    description: "Change the dashboard's global time period and comparison. Give month (YYYY-MM), or start and end (ISO dates, end exclusive), or all true. compare: 'previous' | 'same_last_year' | 'none', or compare_start and compare_end for a custom window.",
    input_schema: {
      type: "object",
      properties: {
        month: { type: "string", description: "YYYY-MM for a whole month." },
        start: { type: "string", description: "ISO date, inclusive." },
        end: { type: "string", description: "ISO date, exclusive." },
        all: { type: "boolean", description: "true for all time." },
        compare: { type: "string", enum: ["none", "previous", "same_last_year"] },
        compare_start: { type: "string" },
        compare_end: { type: "string" },
      },
    },
  },
];

/* ------------------------------------------------------------------ */
/* Persistence                                                           */
/* ------------------------------------------------------------------ */

interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  proposals: Array<{ widget: WidgetSpec; replaces?: string }> | null;
  api_content: ContentBlock[] | string | OpenAiStored;
  followups?: string[] | null;
}

/** Envelope for rows written by the OpenAI provider (kept apart from Claude's block arrays). */
interface OpenAiStored {
  provider: "openai";
  message: OpenAI.Chat.Completions.ChatCompletionMessageParam;
}

const FOLLOWUP_MARKER = "FOLLOWUPS:";
const HOLDBACK = 12;

/**
 * Streams model text through while holding back the trailing FOLLOWUPS line.
 * A small tail is withheld so a half-typed marker is never shown to the person.
 */
class TextGate {
  private buffer = "";
  private emitted = 0;
  private markerAt = -1;
  push(delta: string): string {
    this.buffer += delta;
    if (this.markerAt < 0) {
      const idx = this.buffer.indexOf(FOLLOWUP_MARKER);
      if (idx >= 0) this.markerAt = idx;
    }
    const limit = this.markerAt >= 0 ? this.markerAt : Math.max(0, this.buffer.length - HOLDBACK);
    if (limit <= this.emitted) return "";
    const out = this.buffer.slice(this.emitted, limit);
    this.emitted = limit;
    return out;
  }
  /** Returns the remaining visible text and the parsed follow-ups. */
  flush(): { rest: string; followups: string[] } {
    const limit = this.markerAt >= 0 ? this.markerAt : this.buffer.length;
    const rest = this.buffer.slice(this.emitted, limit).replace(/\s+$/, "");
    this.emitted = limit;
    return { rest, followups: parseFollowups(this.buffer) };
  }
}

export function stripFollowups(text: string): string {
  const idx = text.indexOf(FOLLOWUP_MARKER);
  return (idx >= 0 ? text.slice(0, idx) : text).replace(/\s+$/, "");
}

export function parseFollowups(text: string): string[] {
  const idx = text.indexOf(FOLLOWUP_MARKER);
  if (idx < 0) return [];
  const tail = text.slice(idx + FOLLOWUP_MARKER.length);
  const m = /\[[\s\S]*?\]/.exec(tail);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim().slice(0, 120)).slice(0, 3);
  } catch {
    return [];
  }
}

async function loadHistory(dashboardId: string): Promise<MsgParam[]> {
  const db = await getDb();
  const rows = await db.query<{ role: string; api_content: unknown }>(
    `SELECT role, api_content FROM (
       SELECT id, role, api_content FROM chat_messages WHERE dashboard_id = $1 AND api_content IS NOT NULL ORDER BY id DESC LIMIT ${HISTORY_ROWS}
     ) t ORDER BY id ASC`,
    [dashboardId],
  );
  const msgs: MsgParam[] = rows
    .map((r) => ({ role: r.role, api: typeof r.api_content === "string" ? JSON.parse(r.api_content) : r.api_content }))
    // Rows written by the OpenAI provider are objects, not block arrays; they cannot be replayed to Claude.
    .filter((r) => Array.isArray(r.api))
    .map((r) => ({ role: r.role as "user" | "assistant", content: r.api as ContentBlock[] }));
  // The window must start at a real user text message, never at a tool result.
  while (msgs.length) {
    const m = msgs[0];
    const blocks = m.content as ContentBlock[];
    if (m.role === "user" && Array.isArray(blocks) && blocks.some((b) => b.type === "text")) break;
    msgs.shift();
  }
  return msgs;
}

async function storeMessage(dashboardId: string, m: StoredMessage): Promise<number> {
  const db = await getDb();
  const rows = await db.query<{ id: number }>(
    `INSERT INTO chat_messages (dashboard_id, role, content, proposals, api_content, followups) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb) RETURNING id`,
    [dashboardId, m.role, m.content, m.proposals ? JSON.stringify(m.proposals) : null, JSON.stringify(m.api_content), m.followups?.length ? JSON.stringify(m.followups) : null],
  );
  return Number(rows[0].id);
}

export interface DisplayMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  proposals: Array<{ widget: WidgetSpec; replaces?: string }> | null;
  followups: string[] | null;
  created_at: string;
}

export async function listMessages(dashboardId: string): Promise<DisplayMessage[]> {
  await ensureReady();
  const db = await getDb();
  const rows = await db.query<{ id: number; role: string; content: string; proposals: unknown; followups: unknown; created_at: string }>(
    `SELECT id, role, content, proposals, followups, created_at FROM chat_messages WHERE dashboard_id = $1 ORDER BY id ASC`,
    [dashboardId],
  );
  const parse = <T,>(v: unknown): T | null => (v === null || v === undefined ? null : ((typeof v === "string" ? JSON.parse(v) : v) as T));
  return rows
    .filter((r) => r.content.trim().length > 0 || (r.proposals && (r.proposals as unknown[]).length > 0))
    .map((r) => ({
      id: Number(r.id),
      role: r.role as "user" | "assistant",
      content: r.content,
      proposals: parse<DisplayMessage["proposals"]>(r.proposals),
      followups: parse<string[]>(r.followups),
      created_at: new Date(r.created_at).toISOString(),
    }));
}

export async function clearMessages(dashboardId: string) {
  await ensureReady();
  const db = await getDb();
  await db.query(`DELETE FROM chat_messages WHERE dashboard_id = $1`, [dashboardId]);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                               */
/* ------------------------------------------------------------------ */

async function contextBlock(widgets: WidgetSummary[], period?: PeriodState): Promise<string> {
  const parts: string[] = [];
  const cov = await getCoverage().catch(() => null);
  if (cov) {
    const complete = cov.months.filter((m) => m.complete && m.posts + m.comments > 0).map((m) => m.month);
    parts.push(`Data coverage: ${cov.firstDate} to ${cov.lastDate} (${cov.posts.toLocaleString("en-US")} posts, ${cov.comments.toLocaleString("en-US")} comments); complete months ${complete[0]} to ${complete[complete.length - 1]}.`);
  }
  const win = resolveWindow(period);
  const cmp = resolveCompare(period);
  parts.push(win.start || win.end ? `Current period: ${formatWindow(win)} (${win.start ?? "…"} to ${win.end ?? "…"}, end exclusive); posts and comments are filtered to it.${cmp ? ` Comparison period: ${formatWindow(cmp)} (${cmp.start} to ${cmp.end}).` : ""}` : "Current period: all time (no filter).");
  parts.push(widgets.length ? `Current widgets: ${widgets.map((w) => `${w.id} (${w.type}) "${w.title}"`).join("; ")}` : "The dashboard is empty.");
  return `[Dashboard context: ${parts.join(" ")}]`;
}

function truncateRows(rows: Row[], cap = TOOL_RESULT_CHAR_CAP): { text: string; shown: number } {
  const out: Row[] = [];
  let size = 2;
  for (const r of rows) {
    const compact = Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, typeof v === "string" && v.length > 240 ? v.slice(0, 240) + "…" : v]),
    );
    const s = JSON.stringify(compact);
    if (size + s.length > cap) break;
    out.push(compact);
    size += s.length + 1;
  }
  return { text: JSON.stringify(out), shown: out.length };
}

class EventQueue<T> {
  private items: T[] = [];
  private waiters: Array<(v: IteratorResult<T>) => void> = [];
  private closed = false;
  push(item: T) {
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }
  close() {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as unknown as T, done: true });
  }
  next(): Promise<IteratorResult<T>> {
    if (this.items.length) return Promise.resolve({ value: this.items.shift() as T, done: false });
    if (this.closed) return Promise.resolve({ value: undefined as unknown as T, done: true });
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

async function executeTool(
  name: string,
  input: unknown,
  existing: WidgetSpec[],
  emit: (e: ChatEvent) => void,
  proposals: Array<{ widget: WidgetSpec; replaces?: string }>,
  window?: PeriodWindow | null,
): Promise<{ content: string; isError: boolean }> {
  if (name === "set_period") {
    const parsed = SetPeriodInput.safeParse(input);
    if (!parsed.success) return { content: `INVALID_INPUT: ${parsed.error.message}`, isError: true };
    const i = parsed.data;
    let next: PeriodState;
    if (i.all) next = { mode: "all" };
    else if (i.month) next = monthPeriod(i.month);
    else if (i.start && i.end) next = { mode: "range", start: i.start, end: i.end };
    else return { content: "Give month, or start and end, or all: true.", isError: true };
    if (i.compare_start && i.compare_end) next.compare = { mode: "custom", start: i.compare_start, end: i.compare_end };
    else if (i.compare && i.compare !== "none") next.compare = { mode: i.compare };
    else next.compare = null;
    const parsedState = PeriodStateSchema.safeParse(next);
    if (!parsedState.success) return { content: `Invalid period: ${parsedState.error.message}`, isError: true };
    emit({ type: "period", period: parsedState.data });
    const w = resolveWindow(parsedState.data);
    const c = resolveCompare(parsedState.data);
    return { content: `Dashboard period set to ${formatWindow(w)}${c ? `, compared with ${formatWindow(c)}` : ""}. Queries you run from now on in this turn still use the previous period; mention the change to the person.`, isError: false };
  }
  if (name === "run_sql") {
    const parsed = RunSqlInput.safeParse(input);
    if (!parsed.success) return { content: `INVALID_INPUT: ${parsed.error.message}`, isError: true };
    emit({ type: "status", text: parsed.data.purpose ? `Querying: ${parsed.data.purpose}` : "Querying the data" });
    const res = await runWidgetQuery(parsed.data.sql, 500, window);
    if (!res.ok) {
      emit({ type: "query", sql: parsed.data.sql, ok: false, error: res.error });
      return { content: `SQL error: ${res.error}`, isError: true };
    }
    emit({ type: "query", sql: parsed.data.sql, ok: true, rows: res.rows.length, ms: res.ms });
    const { text, shown } = truncateRows(res.rows);
    const note = shown < res.rows.length ? ` (showing ${shown} of ${res.rows.length} rows; aggregate further for the rest)` : "";
    return { content: `${res.rows.length} rows${res.truncated ? " (capped at 500)" : ""}${note}:\n${text}`, isError: false };
  }
  if (name === "propose_widget") {
    const parsed = ProposeInput.safeParse(input);
    if (!parsed.success) return { content: `INVALID_INPUT: ${parsed.error.message}`, isError: true };
    const { replaces_widget_id, ...proposal } = parsed.data;
    const widget = materialize(proposal, existing);
    let data: Row[] = [];
    if (widget.sql) {
      const res = await runWidgetQuery(widget.sql, 500, widget.period === "all" ? null : window);
      if (!res.ok) {
        emit({ type: "query", sql: widget.sql, ok: false, error: res.error });
        return { content: `The widget SQL failed: ${res.error}. Fix it and propose again.`, isError: true };
      }
      data = res.rows;
      if (!data.length) return { content: "The widget SQL returned no rows. Adjust the filters and propose again.", isError: true };
    } else if (!["text", "section"].includes(widget.type) && !widget.content) {
      return { content: "This widget type needs sql or content.", isError: true };
    }
    const replaces = replaces_widget_id && existing.some((w) => w.id === replaces_widget_id) ? replaces_widget_id : undefined;
    proposals.push({ widget, replaces });
    emit({ type: "widget", widget, data, replaces });
    const cols = data[0] ? Object.keys(data[0]).join(", ") : "none";
    return {
      content: `Proposed "${widget.title}" (id ${widget.id}${replaces ? `, replaces ${replaces}` : ""}). Data: ${data.length} rows, columns: ${cols}. The person will see a preview card.`,
      isError: false,
    };
  }
  return { content: `Unknown tool ${name}`, isError: true };
}

/* ------------------------------------------------------------------ */
/* Main turn                                                             */
/* ------------------------------------------------------------------ */

export async function* runChatTurn(input: ChatTurnInput, existingWidgets: WidgetSpec[]): AsyncGenerator<ChatEvent> {
  await ensureReady();
  const mode = llmMode();
  if (mode === "mock") {
    yield* mockTurn(input, existingWidgets);
    return;
  }
  if (mode === "openai") {
    yield* openAiTurn(input, existingWidgets);
    return;
  }

  // Keys created at organisation level (not inside a workspace) must name a workspace on every request.
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  const client = new Anthropic({
    maxRetries: 2,
    timeout: 180_000,
    ...(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}),
  });
  const history = await loadHistory(input.dashboardId);
  const userApiText = `${input.instruction ?? input.userText}\n\n${await contextBlock(input.widgets, input.period)}`;
  const window = resolveWindow(input.period);
  const messages: MsgParam[] = [...history, { role: "user", content: [{ type: "text", text: userApiText }] }];
  await storeMessage(input.dashboardId, { role: "user", content: input.userText, proposals: null, api_content: [{ type: "text", text: userApiText }] });

  const pending: StoredMessage[] = [];
  const proposals: Array<{ widget: WidgetSpec; replaces?: string }> = [];
  let lastId: number | null = null;
  const useFallbacks = process.env.CLAUDE_FALLBACKS !== "0";

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const queue = new EventQueue<ChatEvent>();
      const gate = new TextGate();
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 8000,
        ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        thinking: { type: "adaptive" },
        output_config: { effort: EFFORT },
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools: TOOLS,
        messages,
      });
      stream.on("text", (delta) => {
        const visible = gate.push(delta);
        if (visible) queue.push({ type: "text", delta: visible });
      });
      const finalPromise = stream.finalMessage().then(
        (m) => {
          queue.close();
          return m;
        },
        (err) => {
          queue.close();
          throw err;
        },
      );
      for (;;) {
        const n = await queue.next();
        if (n.done) break;
        yield n.value;
      }
      const message = await finalPromise;
      const flushed = gate.flush();
      if (flushed.rest) yield { type: "text", delta: flushed.rest };
      const rawText = message.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("");
      const text = stripFollowups(rawText);
      const followups = flushed.followups.length ? flushed.followups : parseFollowups(rawText);

      if (message.stop_reason === "refusal") {
        yield { type: "text", delta: "\n\nI can't help with that request." };
        break;
      }
      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      const assistantContent = message.content as unknown as ContentBlock[];
      messages.push({ role: "assistant", content: assistantContent });
      const turnProposalsStart = proposals.length;

      if (message.stop_reason !== "tool_use" || toolUses.length === 0) {
        if (followups.length) yield { type: "followups", items: followups };
        pending.push({ role: "assistant", content: text, proposals: null, api_content: assistantContent, followups });
        if (message.stop_reason === "max_tokens") yield { type: "text", delta: "\n\n(The reply was cut short.)" };
        break;
      }

      const results: ContentBlock[] = [];
      for (const tu of toolUses) {
        const toolEvents: ChatEvent[] = [];
        const r = await executeTool(tu.name, tu.input, existingWidgets, (e) => toolEvents.push(e), proposals, window);
        for (const e of toolEvents) yield e;
        results.push({ type: "tool_result", tool_use_id: tu.id, content: r.content, is_error: r.isError });
      }
      pending.push({
        role: "assistant",
        content: text,
        proposals: proposals.slice(turnProposalsStart),
        api_content: assistantContent,
      });
      pending.push({ role: "user", content: "", proposals: null, api_content: results });
      messages.push({ role: "user", content: results });
      yield { type: "status", text: "Thinking" };
    }
  } catch (err) {
    const msg = err instanceof Anthropic.APIError ? friendlyApiError(err) : (err as Error).message;
    yield { type: "error", message: msg };
  }

  for (const m of pending) lastId = await storeMessage(input.dashboardId, m);
  yield { type: "done", messageId: lastId };
}

/* ------------------------------------------------------------------ */
/* Mock mode (no API key): scripted answers so the UI can be demoed      */
/* ------------------------------------------------------------------ */

interface MockRecipe {
  match: RegExp;
  answer: (rows: Row[]) => string;
  widget: Parameters<typeof materialize>[0];
}

const fmt = (n: unknown) => (typeof n === "number" ? Math.round(n).toLocaleString("en-US") : String(n));

const MOCK_RECIPES: MockRecipe[] = [
  {
    match: /tiktok/i,
    widget: {
      type: "bar", title: "TikTok share of voice", subtitle: "Posts on TikTok by brand", colorBy: "brand", x: "brand", y: "value", horizontal: true, format: "compact",
      sql: `SELECT brand, count(*)::int AS value FROM posts WHERE platform = 'tiktok' GROUP BY brand ORDER BY value DESC`,
      rationale: "TikTok is where the category volume is; this shows who owns it.", width: 6, height: 5,
    },
    answer: (rows) => `On TikTok the volume leader is **${rows[0]?.brand}** with ${fmt(rows[0]?.value)} posts, ahead of ${rows[1]?.brand} (${fmt(rows[1]?.value)}). Venus sits at ${fmt(rows.find((r) => r.brand === "Venus")?.value)} posts.\n\nI've proposed a chart: **TikTok share of voice**.`,
  },
  {
    match: /complain|objection|negative/i,
    widget: {
      type: "stacked_bar", title: "Objections: Venus vs Estrid", subtitle: "Comments raising an objection, by category", x: "objection", y: "value", series: "brand", colorBy: "brand", horizontal: true, format: "compact",
      sql: `SELECT objection_category AS objection, brand, count(*)::int AS value FROM comments WHERE objection_category IS NOT NULL AND brand IN ('Venus','Estrid') GROUP BY 1,2 ORDER BY 1`,
      rationale: "Shows where each brand's criticism concentrates.", width: 6, height: 5,
    },
    answer: (rows) => {
      const top = rows.slice().sort((a, b) => Number(b.value) - Number(a.value)).slice(0, 4).map((r) => `**${r.brand}** ${r.objection}: ${fmt(r.value)}`).join(", ");
      return `Quality and price are the dominant complaints for both brands. Largest buckets: ${top}.\n\nI've proposed a chart: **Objections: Venus vs Estrid**.`;
    },
  },
  {
    match: /stuck|blocker|purchase|buy/i,
    widget: {
      type: "table", title: "Venus purchase blockers", subtitle: "What stops commenters who want to buy", width: 6, height: 5,
      sql: `SELECT purchase_blocker AS blocker, count(*)::int AS comments FROM comments WHERE brand = 'Venus' AND purchase_blocker IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
      rationale: "Lists the friction points between intent and purchase.",
    },
    answer: (rows) => `The most common blockers for Venus buyers are ${rows.slice(0, 3).map((r) => `**${r.blocker}** (${fmt(r.comments)})`).join(", ")}.\n\nI've proposed a table: **Venus purchase blockers**.`,
  },
  {
    match: /creator|influencer/i,
    widget: {
      type: "table", title: "Top Venus creators by engagement", width: 12, height: 6,
      sql: `SELECT username AS creator, platform, count(*)::int AS posts, sum(engagement) AS engagement, sum(views) AS views FROM posts WHERE brand = 'Venus' GROUP BY 1,2 ORDER BY engagement DESC NULLS LAST LIMIT 15`,
      rationale: "The creators that moved the most people for the focal brand.",
    },
    answer: (rows) => `The top Venus creator is **${rows[0]?.creator}** on ${rows[0]?.platform} with ${fmt(rows[0]?.engagement)} engagements, followed by ${rows[1]?.creator} (${fmt(rows[1]?.engagement)}).\n\nI've proposed a table: **Top Venus creators by engagement**.`,
  },
  {
    match: /prefer|competitor/i,
    widget: {
      type: "table", title: "Competitors named in Venus comments", width: 6, height: 5,
      sql: `SELECT competitor_name AS competitor, count(*)::int AS mentions, count(*) FILTER (WHERE competitor_favored='competitor')::int AS prefers_competitor FROM comments WHERE brand='Venus' AND competitor_name IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      rationale: "Direct competitive preference inside the focal brand's audience.",
    },
    answer: (rows) => `Commenters on Venus content most often mention ${rows.slice(0, 3).map((r) => `**${r.competitor}** (${fmt(r.mentions)})`).join(", ")}.\n\nI've proposed a table: **Competitors named in Venus comments**.`,
  },
  {
    match: /question|faq|unanswered/i,
    widget: {
      type: "bar", title: "Unanswered question topics", x: "topic", y: "value", horizontal: true, format: "number", width: 6, height: 5,
      sql: `SELECT faq_topic AS topic, count(*)::int AS value FROM comments WHERE faq_topic IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
      rationale: "Questions the brand could answer in captions or pinned comments.",
    },
    answer: (rows) => `The most frequent unanswered questions are about ${rows.slice(0, 3).map((r) => `**${r.topic}** (${fmt(r.value)})`).join(", ")}.\n\nI've proposed a chart: **Unanswered question topics**.`,
  },
  {
    match: /country|countries|market/i,
    widget: {
      type: "bar", title: "Philips OneBlade posts by country", x: "country", y: "value", horizontal: true, format: "compact", width: 6, height: 5,
      sql: `SELECT country, count(*)::int AS value FROM posts WHERE brand = 'Philips OneBlade' AND country <> 'Unknown' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      rationale: "Where Philips OneBlade's creator activity concentrates.",
    },
    answer: (rows) => `Philips OneBlade over-indexes in **${rows[0]?.country}** (${fmt(rows[0]?.value)} posts) and ${rows[1]?.country} (${fmt(rows[1]?.value)}).\n\nI've proposed a chart: **Philips OneBlade posts by country**.`,
  },
  {
    match: /paid|organic|sponsored/i,
    widget: {
      type: "stacked_bar", title: "Paid versus organic posts", x: "brand", y: "value", series: "kind", normalize: true, format: "percent", colorBy: "auto", width: 6, height: 5,
      sql: `SELECT brand, CASE WHEN is_paid THEN 'paid' ELSE 'organic' END AS kind, count(*)::int AS value FROM posts GROUP BY 1,2 ORDER BY 1`,
      rationale: "Disclosure rate per brand.",
    },
    answer: () => `Only a small share of posts carry a paid disclosure across all brands.\n\nI've proposed a chart: **Paid versus organic posts**.`,
  },
  {
    match: /loyal/i,
    widget: {
      type: "table", title: "What loyal Venus customers say", width: 12, height: 6,
      sql: `SELECT loyalty_type, left(loyalty_phrase, 160) AS phrase, likes FROM comments WHERE brand = 'Venus' AND loyalty_phrase IS NOT NULL ORDER BY likes DESC NULLS LAST LIMIT 12`,
      rationale: "Verbatim loyalty signals to reuse in messaging.",
    },
    answer: (rows) => `Loyal Venus users mostly describe long-term use and repeat buying. Example: "${rows[0]?.phrase}".\n\nI've proposed a table: **What loyal Venus customers say**.`,
  },
  {
    match: /sentiment|instagram/i,
    widget: {
      type: "stacked_bar", title: "Instagram comment sentiment by brand", x: "brand", y: "value", series: "sentiment", colorBy: "sentiment", normalize: true, format: "percent", width: 6, height: 5,
      sql: `SELECT c.brand, c.sentiment, count(*)::int AS value FROM comments c JOIN posts p ON p.post_id = c.post_id AND p.segment_id = c.segment_id WHERE p.platform = 'instagram' AND c.sentiment IS NOT NULL GROUP BY 1,2 ORDER BY 1`,
      rationale: "Instagram audiences differ from TikTok; this isolates them.",
    },
    answer: () => `Sentiment on Instagram is predominantly positive for every brand, with negative comments in the low single digits.\n\nI've proposed a chart: **Instagram comment sentiment by brand**.`,
  },
];

const MOCK_FOLLOWUPS: Record<string, string[]> = {
  default: ["Split this by platform", "Show it month by month", "Show me example comments"],
};

/** Demo-mode guided setup: streams the scripted sentences and proposes the step's personalised recipes. */
async function* mockWizardTurn(input: ChatTurnInput, existing: WidgetSpec[]): AsyncGenerator<ChatEvent> {
  const wiz = input.wizard!;
  await storeMessage(input.dashboardId, { role: "user", content: input.userText, proposals: null, api_content: [{ type: "text", text: input.instruction ?? input.userText }] });
  const proposals: Array<{ widget: WidgetSpec }> = [];
  for (const w of wiz.text.split(/(\s+)/)) {
    yield { type: "text", delta: w };
    await new Promise((r) => setTimeout(r, 6));
  }
  for (const p of wiz.proposals) {
    yield { type: "status", text: `Preparing: ${p.title}` };
    const widget = materialize(p, [...existing, ...proposals.map((x) => x.widget)]);
    const res = widget.sql ? await runWidgetQuery(widget.sql, 500, resolveWindow(input.period)) : ({ ok: true, rows: [] as Row[] } as const);
    const rows = res.ok ? res.rows : [];
    yield { type: "query", sql: widget.sql ?? "", ok: res.ok, rows: rows.length, error: res.ok ? undefined : res.error };
    if (!res.ok) continue;
    proposals.push({ widget });
    yield { type: "widget", widget, data: rows };
  }
  const id = await storeMessage(input.dashboardId, { role: "assistant", content: wiz.text, proposals, api_content: [{ type: "text", text: wiz.text }] });
  yield { type: "done", messageId: id };
}

async function* mockTurn(input: ChatTurnInput, existing: WidgetSpec[]): AsyncGenerator<ChatEvent> {
  if (input.wizard) {
    yield* mockWizardTurn(input, existing);
    return;
  }
  await storeMessage(input.dashboardId, { role: "user", content: input.userText, proposals: null, api_content: [{ type: "text", text: input.instruction ?? input.userText }] });
  const isScan = (input.instruction ?? input.userText).startsWith(START_SCAN_LABEL);
  const recipes = isScan
    ? [MOCK_RECIPES[0], MOCK_RECIPES[1], MOCK_RECIPES[3]]
    : [MOCK_RECIPES.find((r) => r.match.test(input.userText)) ?? MOCK_RECIPES[0]];
  const proposals: Array<{ widget: WidgetSpec }> = [];
  const parts: string[] = [];
  for (const recipe of recipes) {
    yield { type: "status", text: "Querying the data" };
    const widget = materialize(recipe.widget, [...existing, ...proposals.map((p) => p.widget)]);
    const res = widget.sql ? await runWidgetQuery(widget.sql, 500, resolveWindow(input.period)) : ({ ok: true, rows: [] as Row[] } as const);
    const rows = res.ok ? res.rows : [];
    yield { type: "query", sql: widget.sql ?? "", ok: res.ok, rows: rows.length, error: res.ok ? undefined : res.error };
    const answer = recipe.answer(rows);
    const text = isScan ? `${parts.length + 1}. ${answer}` : answer;
    for (const w of text.split(/(\s+)/)) {
      yield { type: "text", delta: w };
      await new Promise((r) => setTimeout(r, 8));
    }
    if (isScan) yield { type: "text", delta: "\n\n" };
    parts.push(text);
    proposals.push({ widget });
    yield { type: "widget", widget, data: rows };
  }
  const note = "\n\n_Demo mode: no ANTHROPIC_API_KEY is configured, so this reply came from a scripted recipe instead of Claude._";
  yield { type: "text", delta: note };
  const followups = MOCK_FOLLOWUPS.default;
  yield { type: "followups", items: followups };
  const content = parts.join("\n\n") + note;
  const id = await storeMessage(input.dashboardId, {
    role: "assistant",
    content,
    proposals,
    api_content: [{ type: "text", text: parts.join("\n\n") }],
    followups,
  });
  yield { type: "done", messageId: id };
}

/* ------------------------------------------------------------------ */
/* OpenAI provider (used when OPEN_AI_KEY is set)                         */
/* ------------------------------------------------------------------ */

type OaiMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const OPENAI_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = TOOLS.filter(
  (t): t is Anthropic.Beta.BetaTool => "input_schema" in t,
).map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description ?? "", parameters: t.input_schema as Record<string, unknown> },
}));

function friendlyOpenAiError(err: InstanceType<typeof OpenAI.APIError>): string {
  const msg = err.message ?? "";
  if (err.status === 401) return "The OpenAI API key was rejected (401). Check OPEN_AI_KEY in the deployment's environment variables and redeploy.";
  if (err.status === 404 || /model_not_found|does not exist/i.test(msg)) {
    return `The OpenAI model "${OPENAI_MODEL}" is not available to this key. Set OPENAI_MODEL in the deployment's environment variables to a model you can use (for example gpt-5.2 or gpt-4.1) and redeploy.`;
  }
  if (err.status === 429) return "OpenAI is rate limiting this key (429). Try again in a moment.";
  return `OpenAI API error ${err.status}: ${msg}`;
}

async function loadOpenAiHistory(dashboardId: string): Promise<OaiMessage[]> {
  const db = await getDb();
  const rows = await db.query<{ role: string; api_content: unknown }>(
    `SELECT role, api_content FROM (
       SELECT id, role, api_content FROM chat_messages WHERE dashboard_id = $1 AND api_content IS NOT NULL ORDER BY id DESC LIMIT ${HISTORY_ROWS}
     ) t ORDER BY id ASC`,
    [dashboardId],
  );
  const msgs: OaiMessage[] = [];
  for (const r of rows) {
    const api = (typeof r.api_content === "string" ? JSON.parse(r.api_content) : r.api_content) as unknown;
    if (api && typeof api === "object" && !Array.isArray(api) && (api as OpenAiStored).provider === "openai") {
      msgs.push((api as OpenAiStored).message);
    } else if (Array.isArray(api) && r.role === "user") {
      // Plain user text written by another provider or demo mode is still useful context.
      const text = (api as Array<{ type?: string; text?: string }>).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
      if (text) msgs.push({ role: "user", content: text });
    } else if (Array.isArray(api) && r.role === "assistant") {
      const text = (api as Array<{ type?: string; text?: string }>).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
      if (text) msgs.push({ role: "assistant", content: text });
    }
  }
  // The window must start at a user message, and tool results may only follow an assistant tool call.
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  const out: OaiMessage[] = [];
  let inToolRun = false;
  for (const m of msgs) {
    if (m.role === "tool") {
      if (!inToolRun) continue;
    } else {
      inToolRun = m.role === "assistant" && !!(m as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam).tool_calls?.length;
    }
    out.push(m);
  }
  // A trailing assistant tool call with no results would be rejected; drop it.
  const last = out[out.length - 1];
  if (last && last.role === "assistant" && (last as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam).tool_calls?.length) out.pop();
  return out;
}

interface ToolCallAcc {
  id: string;
  name: string;
  args: string;
}

async function* openAiTurn(input: ChatTurnInput, existingWidgets: WidgetSpec[]): AsyncGenerator<ChatEvent> {
  const client = new OpenAI({ apiKey: openAiKey(), maxRetries: 2, timeout: 180_000 });
  const history = await loadOpenAiHistory(input.dashboardId);
  const userApiText = `${input.instruction ?? input.userText}\n\n${await contextBlock(input.widgets, input.period)}`;
  const window = resolveWindow(input.period);
  const userMsg: OaiMessage = { role: "user", content: userApiText };
  const messages: OaiMessage[] = [{ role: "system", content: SYSTEM_PROMPT }, ...history, userMsg];
  await storeMessage(input.dashboardId, { role: "user", content: input.userText, proposals: null, api_content: { provider: "openai", message: userMsg } });

  const pending: StoredMessage[] = [];
  const proposals: Array<{ widget: WidgetSpec; replaces?: string }> = [];
  let lastId: number | null = null;

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const gate = new TextGate();
      const stream = await client.chat.completions.create({
        model: OPENAI_MODEL,
        messages,
        tools: OPENAI_TOOLS,
        stream: true,
        max_completion_tokens: 8000,
        ...(process.env.OPENAI_REASONING_EFFORT ? { reasoning_effort: process.env.OPENAI_REASONING_EFFORT as OpenAI.ReasoningEffort } : {}),
      });
      let rawText = "";
      const calls = new Map<number, ToolCallAcc>();
      let finish: string | null = null;
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta;
        if (delta?.content) {
          rawText += delta.content;
          const visible = gate.push(delta.content);
          if (visible) yield { type: "text", delta: visible };
        }
        for (const tc of delta?.tool_calls ?? []) {
          const acc = calls.get(tc.index) ?? { id: "", name: "", args: "" };
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name += tc.function.name;
          if (tc.function?.arguments) acc.args += tc.function.arguments;
          calls.set(tc.index, acc);
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
      const flushed = gate.flush();
      if (flushed.rest) yield { type: "text", delta: flushed.rest };
      const text = stripFollowups(rawText);
      const followups = flushed.followups.length ? flushed.followups : parseFollowups(rawText);
      const toolCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c).filter((c) => c.name);

      if (!toolCalls.length) {
        const assistantMsg: OaiMessage = { role: "assistant", content: rawText };
        if (followups.length) yield { type: "followups", items: followups };
        pending.push({ role: "assistant", content: text, proposals: null, api_content: { provider: "openai", message: assistantMsg }, followups });
        if (finish === "length") yield { type: "text", delta: "\n\n(The reply was cut short.)" };
        break;
      }

      const assistantMsg: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
        role: "assistant",
        content: rawText || null,
        tool_calls: toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args || "{}" } })),
      };
      messages.push(assistantMsg);
      const turnProposalsStart = proposals.length;
      const assistantPending: StoredMessage = { role: "assistant", content: text, proposals: null, api_content: { provider: "openai", message: assistantMsg } };
      pending.push(assistantPending);

      for (const c of toolCalls) {
        let parsedArgs: unknown;
        try {
          parsedArgs = JSON.parse(c.args || "{}");
        } catch {
          parsedArgs = null;
        }
        const toolEvents: ChatEvent[] = [];
        const r = parsedArgs === null
          ? { content: "INVALID_JSON: tool arguments could not be parsed; call the tool again.", isError: true }
          : await executeTool(c.name, parsedArgs, existingWidgets, (e) => toolEvents.push(e), proposals, window);
        for (const e of toolEvents) yield e;
        const toolMsg: OaiMessage = { role: "tool", tool_call_id: c.id, content: r.content };
        messages.push(toolMsg);
        pending.push({ role: "user", content: "", proposals: null, api_content: { provider: "openai", message: toolMsg } });
      }
      const made = proposals.slice(turnProposalsStart);
      if (made.length) assistantPending.proposals = made;
      yield { type: "status", text: "Thinking" };
    }
  } catch (err) {
    const msg = err instanceof OpenAI.APIError ? friendlyOpenAiError(err) : (err as Error).message;
    yield { type: "error", message: msg };
  }

  for (const m of pending) lastId = await storeMessage(input.dashboardId, m);
  yield { type: "done", messageId: lastId };
}
