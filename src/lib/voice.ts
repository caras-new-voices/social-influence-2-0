import OpenAI from "openai";
import { competitorNames, focalName, getWorkspace } from "./brands";
import type { Row } from "./db";
import { datasetDoc } from "./schema-doc";
import type { WidgetSpec } from "./widgets";

export const VOICE_MODEL = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime";
export const VOICE_NAME = process.env.OPENAI_REALTIME_VOICE ?? "marin";

function openAiKey(): string | undefined {
  return process.env.OPEN_AI_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || undefined;
}

export function voiceAvailable(): boolean {
  return !!openAiKey();
}

/** Compact JSON of the element's rows for the voice agent's context (capped so the prompt stays small). */
function rowsForPrompt(rows: Row[], cap = 6000): string {
  const out: Row[] = [];
  let size = 2;
  for (const r of rows) {
    const compact = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" && v.length > 120 ? v.slice(0, 120) + "…" : v]));
    const s = JSON.stringify(compact);
    if (size + s.length > cap) break;
    out.push(compact);
    size += s.length + 1;
  }
  const note = out.length < rows.length ? ` (first ${out.length} of ${rows.length} rows)` : "";
  return `${JSON.stringify(out)}${note}`;
}

export function voiceInstructions(widget: WidgetSpec, rows: Row[]): string {
  const competitors = competitorNames().join(", ");
  const ws = getWorkspace();
  const definition = widget.sql ? `SQL behind it:\n${widget.sql}\n\nCurrent data${rows.length ? "" : " (none)"}:\n${rowsForPrompt(rows)}` : widget.content ? `Content:\n${widget.content}` : "It is a section header.";
  return `You are a friendly, concise voice analyst inside the Social Influence workspace, an IMAI product. You are talking to a brand manager${ws.company ? ` at ${ws.company}` : ""} about ${focalName()} and its competitors (${competitors}), using a dataset of creator posts and audience comments.

The person just opened a voice session on one dashboard element:
Title: "${widget.title}"${widget.subtitle ? `\nSubtitle: ${widget.subtitle}` : ""}
Type: ${widget.type}
${definition}

How to behave:
- Start immediately, without waiting for the person: in two or three short sentences, say what this element shows, then give the single most interesting insight with the key numbers, then say what it suggests for ${focalName()}. Then invite a question.
- Speak naturally and briefly: this is a conversation, not a report. Round numbers. No lists, no markdown, no reading out column names or SQL.
- When a question needs data you do not have in front of you, call run_sql with a single Postgres SELECT, then answer from the result. Say "let me check" while you do. Keep result sets small by aggregating.
- Brand names must match exactly: ${ws.brands.map((b) => `'${b.name}'`).join(", ")}. "Us", "we" and "our brand" mean ${focalName()}.
- Never name third-party data providers or collection tooling. If asked where the data comes from, say it was collected by IMAI's social listening.
- If you are unsure, say so rather than guessing.

${datasetDoc()}`;
}

export interface VoiceSession {
  clientSecret: string;
  expiresAt: number;
  model: string;
}

export async function createVoiceSession(widget: WidgetSpec, rows: Row[]): Promise<VoiceSession> {
  const apiKey = openAiKey();
  if (!apiKey) throw new Error("Voice needs an OpenAI key. Set OPEN_AI_KEY in the deployment's environment variables.");
  const client = new OpenAI({ apiKey, maxRetries: 1, timeout: 30_000 });
  const res = await client.realtime.clientSecrets.create({
    expires_after: { anchor: "created_at", seconds: 600 },
    session: {
      type: "realtime",
      model: VOICE_MODEL,
      instructions: voiceInstructions(widget, rows),
      audio: {
        input: { transcription: { model: "gpt-4o-mini-transcribe" }, noise_reduction: { type: "near_field" } },
        output: { voice: VOICE_NAME },
      },
      tools: [
        {
          type: "function",
          name: "run_sql",
          description: "Run a read-only Postgres SELECT against the social listening dataset and return up to 200 rows as JSON.",
          parameters: {
            type: "object",
            properties: { sql: { type: "string", description: "A single SELECT or WITH statement, Postgres syntax, no semicolon." } },
            required: ["sql"],
          },
        },
      ],
    },
  });
  return { clientSecret: res.value, expiresAt: res.expires_at, model: VOICE_MODEL };
}
