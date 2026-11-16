import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { llmMode, llmModel } from "./claude";
import { canSpend, estimateTokens, recordUsage } from "./usage";
import { OUT_OF_TOKENS_MESSAGE, type UsageKind, type UsageLine } from "./usage-shared";

/** What the call is for, so its tokens land in the usage log under the right kind. */
export interface CompletionMeta {
  kind: UsageKind;
  dashboardId?: string | null;
  label?: string;
  /** True when no person triggered it. */
  automatic?: boolean;
}

/** Throws the out-of-tokens error when the account has nothing left. */
export async function assertCanSpend() {
  if (!(await canSpend())) throw new Error(OUT_OF_TOKENS_MESSAGE);
}

/**
 * One non-streaming completion that returns plain text, through whichever provider is configured,
 * and records the tokens it used. Throws Error("mock") in demo mode so callers can fall back to a
 * scripted result (and record an estimate with recordEstimate).
 */
export async function complete(system: string, user: string, maxTokens: number, meta: CompletionMeta): Promise<{ text: string; usage: UsageLine }> {
  const mode = llmMode();
  if (mode === "mock") throw new Error("mock");
  await assertCanSpend();
  const started = Date.now();
  let text = "";
  let input = 0, output = 0, cached = 0;
  if (mode === "openai") {
    const client = new OpenAI({ apiKey: process.env.OPEN_AI_KEY?.trim() || process.env.OPENAI_API_KEY?.trim(), maxRetries: 2, timeout: 120_000 });
    const res = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-5.2",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_completion_tokens: maxTokens,
    });
    text = res.choices[0]?.message?.content ?? "";
    input = res.usage?.prompt_tokens ?? 0;
    output = res.usage?.completion_tokens ?? 0;
    cached = res.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  } else {
    const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
    const client = new Anthropic({ maxRetries: 2, timeout: 120_000, ...(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}) });
    const res = await client.messages.create({
      model: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });
    text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    cached = res.usage?.cache_read_input_tokens ?? 0;
    input = (res.usage?.input_tokens ?? 0) + cached + (res.usage?.cache_creation_input_tokens ?? 0);
    output = res.usage?.output_tokens ?? 0;
  }
  if (input + output === 0) {
    input = estimateTokens(system + user);
    output = estimateTokens(text);
  }
  const usage = await recordUsage({ ...meta, provider: mode, model: llmModel(), input, output, cached, durationMs: Date.now() - started });
  return { text, usage };
}

/** Demo mode: records an estimate for a scripted result, from the text a real call would send and receive. */
export async function recordEstimate(meta: CompletionMeta, sent: string, received: string): Promise<UsageLine> {
  return recordUsage({ ...meta, provider: "demo", model: "demo", input: estimateTokens(sent), output: estimateTokens(received), estimated: true });
}
