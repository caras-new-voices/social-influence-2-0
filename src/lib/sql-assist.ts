import { llmMode } from "./claude";
import { assertCanSpend, complete, recordEstimate, type CompletionMeta } from "./llm";
import type { UsageLine } from "./usage-shared";
import { runWidgetQuery } from "./query";
import { datasetDoc } from "./schema-doc";

export interface AssistWidget {
  title?: string;
  type?: string;
  x?: string;
  y?: string;
  series?: string;
}

export type AssistResult =
  | { mode: "explain"; explanation: string; usage?: UsageLine }
  | { mode: "modify"; sql: string; summary: string; columns: string[]; rowCount: number; warning?: string; usage?: UsageLine };

const system = () => `You help an analyst edit the SQL behind a dashboard element in the Social Influence workspace. Postgres only; a single SELECT or WITH statement; no semicolons; never name third-party data providers.

${datasetDoc()}`;

function widgetContext(w: AssistWidget): string {
  return `Element: "${w.title ?? "untitled"}" (type ${w.type ?? "unknown"}${w.x ? `, x column ${w.x}` : ""}${w.y ? `, value column ${w.y}` : ""}${w.series ? `, series column ${w.series}` : ""}).`;
}

function extractSql(text: string): string {
  const fence = /```(?:sql)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fence ? fence[1] : text).trim();
  return body.replace(/;+\s*$/, "");
}

export async function assistSql(input: { mode: "explain" | "modify"; sql: string; request?: string; widget: AssistWidget; dashboardId?: string | null }): Promise<AssistResult> {
  const ctx = widgetContext(input.widget);
  const meta: CompletionMeta = { kind: "sql_assist", dashboardId: input.dashboardId ?? null, label: `${input.mode === "explain" ? "Explain query" : `Change query: ${input.request ?? ""}`} (${input.widget.title ?? "element"})` };
  await assertCanSpend();
  if (llmMode() === "mock") {
    if (input.mode === "explain") {
      const demo =
          "**Demo mode.** With an LLM key configured, this would explain the query in plain language: what rows it reads, how it groups and filters them, and what each output column means.\n\nThis query reads from the dataset tables, groups the rows by the first column and returns one row per group.";
      return { mode: "explain", explanation: demo, usage: await recordEstimate(meta, system() + ctx + input.sql, demo) };
    }
    const res = await runWidgetQuery(input.sql, 5);
    const note = "Demo mode: no LLM key is configured, so the query was left unchanged.";
    return { mode: "modify", sql: input.sql, summary: note, columns: res.ok ? res.columns : [], rowCount: res.ok ? res.rows.length : 0, usage: await recordEstimate(meta, system() + ctx + input.sql + (input.request ?? ""), note + input.sql) };
  }

  if (input.mode === "explain") {
    const { text, usage } = await complete(
      system(),
      `${ctx}\n\nExplain this SQL to a marketing analyst who does not write SQL. Use plain language, at most 120 words: what data it reads, how it filters and groups, and what each output column means. Use markdown bullets. Do not repeat the SQL.\n\n\`\`\`sql\n${input.sql}\n\`\`\``,
      700,
      meta,
    );
    return { mode: "explain", explanation: text.trim(), usage };
  }

  const request = (input.request ?? "").trim();
  if (!request) throw new Error("Describe the change you want.");
  let attempt = 0;
  let lastError = "";
  let sql = input.sql;
  let spent = 0;
  while (attempt < 2) {
    attempt++;
    const { text, usage: u } = await complete(
      system(),
      `${ctx}\n\nCurrent SQL:\n\`\`\`sql\n${input.sql}\n\`\`\`\n\nRequested change: ${request}\n${lastError ? `\nYour previous attempt failed with: ${lastError}. Fix it.\n` : ""}
Rewrite the SQL to apply the change. Keep the output columns compatible with the element where possible (same column names for x, value and series), unless the change requires otherwise. Reply with exactly two parts: first a one-sentence summary of what changed, then the full new SQL in a \`\`\`sql fenced block. Nothing else.`,
      1500,
      meta,
    );
    // A retry spends again: report the total for the request, with the balance after the last call.
    const usage: UsageLine = { ...u, total: u.total + spent };
    spent += u.total;
    sql = extractSql(text.slice(text.indexOf("```") >= 0 ? text.indexOf("```") : 0));
    const summary = text.slice(0, text.indexOf("```") >= 0 ? text.indexOf("```") : text.length).trim().replace(/^summary:\s*/i, "") || "Query updated.";
    const res = await runWidgetQuery(sql, 500);
    if (res.ok) {
      const warning = res.rows.length === 0 ? "The new query returned no rows." : undefined;
      return { mode: "modify", sql, summary, columns: res.columns, rowCount: res.rows.length, warning, usage };
    }
    lastError = res.error;
  }
  throw new Error(`The assistant could not produce a working query: ${lastError}`);
}
