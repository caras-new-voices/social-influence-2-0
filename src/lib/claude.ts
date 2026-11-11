import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { BRANDS, FOCAL_BRAND } from "./brands";
import { getDb, type Row } from "./db";
import { runWidgetQuery } from "./query";
import { ensureReady } from "./schema";
import { DATASET_DOC } from "./schema-doc";
import { materialize, ProposedWidgetSchema, type WidgetSpec } from "./widgets";

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "status"; text: string }
  | { type: "query"; sql: string; ok: boolean; rows?: number; error?: string; ms?: number }
  | { type: "widget"; widget: WidgetSpec; data: Row[]; replaces?: string; error?: string }
  | { type: "done"; messageId: number | null }
  | { type: "error"; message: string };

export interface WidgetSummary {
  id: string;
  type: string;
  title: string;
}

export interface ChatTurnInput {
  dashboardId: string;
  userText: string;
  widgets: WidgetSummary[];
}

type MsgParam = Anthropic.Beta.BetaMessageParam;
type ContentBlock = Anthropic.Beta.BetaContentBlockParam;

export function llmMode(): "claude" | "mock" {
  if (process.env.MOCK_LLM === "1") return "mock";
  return process.env.ANTHROPIC_API_KEY ? "claude" : "mock";
}

const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.CLAUDE_EFFORT ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max";
const MAX_TOOL_ROUNDS = 8;
const TOOL_RESULT_CHAR_CAP = 7000;
const HISTORY_ROWS = 30;

/* ------------------------------------------------------------------ */
/* Prompt                                                                */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `You are the analyst inside the Social Influence workspace, an IMAI product. You help a brand team at P&G understand creator content and audience reactions about ${FOCAL_BRAND.name} and its competitors (${BRANDS.filter((b) => b.role === "competitor").map((b) => b.name).join(", ")}), and you help them build a dashboard.

You have two tools:
- run_sql: run a read-only Postgres SELECT against the dataset and read the rows.
- propose_widget: propose a dashboard element (a saved query plus a rendering recipe). The person sees a preview card and decides whether to add it. You cannot add widgets yourself.

${DATASET_DOC}

## How to work
- Ground every claim in a query. Never guess numbers. Run the queries you need (usually 1 to 3) before answering; keep result sets small by aggregating in SQL. For examples of verbatim comments select at most 8 rows and use left(text, 220).
- Postgres syntax only. Single SELECT or WITH statement, no semicolons. Useful idioms: count(*) FILTER (WHERE ...), to_char(date_trunc('month', published_at), 'YYYY-MM') AS month, round(x::numeric, 3), NULLIF for divisions, ::int casts for counts.
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
- Alias the value column AS value, the category AS the name you pass in x, and the series AS the name you pass in series. Always add rationale (one sentence: why this element matters).`;

/* ------------------------------------------------------------------ */
/* Tools                                                                 */
/* ------------------------------------------------------------------ */

const RunSqlInput = z.object({ sql: z.string().min(1), purpose: z.string().optional() });
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
      },
      required: ["type", "title", "rationale"],
    },
    eager_input_streaming: true,
  },
];

/* ------------------------------------------------------------------ */
/* Persistence                                                           */
/* ------------------------------------------------------------------ */

interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  proposals: Array<{ widget: WidgetSpec; replaces?: string }> | null;
  api_content: ContentBlock[] | string;
}

async function loadHistory(dashboardId: string): Promise<MsgParam[]> {
  const db = await getDb();
  const rows = await db.query<{ role: string; api_content: unknown }>(
    `SELECT role, api_content FROM (
       SELECT id, role, api_content FROM chat_messages WHERE dashboard_id = $1 AND api_content IS NOT NULL ORDER BY id DESC LIMIT ${HISTORY_ROWS}
     ) t ORDER BY id ASC`,
    [dashboardId],
  );
  const msgs: MsgParam[] = rows.map((r) => ({
    role: r.role as "user" | "assistant",
    content: (typeof r.api_content === "string" ? JSON.parse(r.api_content) : r.api_content) as ContentBlock[],
  }));
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
    `INSERT INTO chat_messages (dashboard_id, role, content, proposals, api_content) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb) RETURNING id`,
    [dashboardId, m.role, m.content, m.proposals ? JSON.stringify(m.proposals) : null, JSON.stringify(m.api_content)],
  );
  return Number(rows[0].id);
}

export interface DisplayMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  proposals: Array<{ widget: WidgetSpec; replaces?: string }> | null;
  created_at: string;
}

export async function listMessages(dashboardId: string): Promise<DisplayMessage[]> {
  await ensureReady();
  const db = await getDb();
  const rows = await db.query<{ id: number; role: string; content: string; proposals: unknown; created_at: string }>(
    `SELECT id, role, content, proposals, created_at FROM chat_messages WHERE dashboard_id = $1 ORDER BY id ASC`,
    [dashboardId],
  );
  return rows
    .filter((r) => r.content.trim().length > 0 || (r.proposals && (r.proposals as unknown[]).length > 0))
    .map((r) => ({
      id: Number(r.id),
      role: r.role as "user" | "assistant",
      content: r.content,
      proposals: (typeof r.proposals === "string" ? JSON.parse(r.proposals) : r.proposals) as DisplayMessage["proposals"],
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

function contextBlock(widgets: WidgetSummary[]): string {
  if (!widgets.length) return "[Dashboard context: the dashboard is empty.]";
  return `[Dashboard context: current widgets: ${widgets.map((w) => `${w.id} (${w.type}) "${w.title}"`).join("; ")}]`;
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
): Promise<{ content: string; isError: boolean }> {
  if (name === "run_sql") {
    const parsed = RunSqlInput.safeParse(input);
    if (!parsed.success) return { content: `INVALID_INPUT: ${parsed.error.message}`, isError: true };
    emit({ type: "status", text: parsed.data.purpose ? `Querying: ${parsed.data.purpose}` : "Querying the data" });
    const res = await runWidgetQuery(parsed.data.sql, 500);
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
      const res = await runWidgetQuery(widget.sql, 500);
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
  if (llmMode() === "mock") {
    yield* mockTurn(input, existingWidgets);
    return;
  }

  const client = new Anthropic({ maxRetries: 2, timeout: 180_000 });
  const history = await loadHistory(input.dashboardId);
  const userApiText = `${input.userText}\n\n${contextBlock(input.widgets)}`;
  const messages: MsgParam[] = [...history, { role: "user", content: [{ type: "text", text: userApiText }] }];
  await storeMessage(input.dashboardId, { role: "user", content: input.userText, proposals: null, api_content: [{ type: "text", text: userApiText }] });

  const pending: StoredMessage[] = [];
  const proposals: Array<{ widget: WidgetSpec; replaces?: string }> = [];
  let finalText = "";
  let lastId: number | null = null;
  const useFallbacks = process.env.CLAUDE_FALLBACKS !== "0";

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const queue = new EventQueue<ChatEvent>();
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
      stream.on("text", (delta) => queue.push({ type: "text", delta }));
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
      const text = message.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("");
      finalText += text;

      if (message.stop_reason === "refusal") {
        yield { type: "text", delta: "\n\nI can't help with that request." };
        break;
      }
      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      const assistantContent = message.content as unknown as ContentBlock[];
      messages.push({ role: "assistant", content: assistantContent });
      const turnProposalsStart = proposals.length;

      if (message.stop_reason !== "tool_use" || toolUses.length === 0) {
        pending.push({ role: "assistant", content: text, proposals: null, api_content: assistantContent });
        if (message.stop_reason === "max_tokens") yield { type: "text", delta: "\n\n(The reply was cut short.)" };
        break;
      }

      const results: ContentBlock[] = [];
      for (const tu of toolUses) {
        const toolEvents: ChatEvent[] = [];
        const r = await executeTool(tu.name, tu.input, existingWidgets, (e) => toolEvents.push(e), proposals);
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
    const msg = err instanceof Anthropic.APIError ? `Claude API error ${err.status}: ${err.message}` : (err as Error).message;
    yield { type: "error", message: msg };
  }

  for (const m of pending) lastId = await storeMessage(input.dashboardId, m);
  void finalText;
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

async function* mockTurn(input: ChatTurnInput, existing: WidgetSpec[]): AsyncGenerator<ChatEvent> {
  await storeMessage(input.dashboardId, { role: "user", content: input.userText, proposals: null, api_content: [{ type: "text", text: input.userText }] });
  const recipe = MOCK_RECIPES.find((r) => r.match.test(input.userText)) ?? MOCK_RECIPES[0];
  yield { type: "status", text: "Querying the data" };
  const widget = materialize(recipe.widget, existing);
  const res = widget.sql ? await runWidgetQuery(widget.sql, 500) : ({ ok: true, rows: [] as Row[] } as const);
  const rows = res.ok ? res.rows : [];
  yield { type: "query", sql: widget.sql ?? "", ok: res.ok, rows: rows.length, error: res.ok ? undefined : res.error };
  const answer = recipe.answer(rows);
  const words = answer.split(/(\s+)/);
  for (const w of words) {
    yield { type: "text", delta: w };
    await new Promise((r) => setTimeout(r, 12));
  }
  const note = "\n\n_Demo mode: no ANTHROPIC_API_KEY is configured, so this reply came from a scripted recipe instead of Claude._";
  yield { type: "text", delta: note };
  yield { type: "widget", widget, data: rows };
  const id = await storeMessage(input.dashboardId, {
    role: "assistant",
    content: answer + note,
    proposals: [{ widget }],
    api_content: [{ type: "text", text: answer }],
  });
  yield { type: "done", messageId: id };
}
