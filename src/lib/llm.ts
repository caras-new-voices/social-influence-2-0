import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { llmMode } from "./claude";

/**
 * One non-streaming completion that returns plain text, through whichever provider is configured.
 * Throws Error("mock") in demo mode so callers can fall back to a scripted result.
 */
export async function complete(system: string, user: string, maxTokens = 1500): Promise<string> {
  const mode = llmMode();
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
    return res.choices[0]?.message?.content ?? "";
  }
  if (mode === "claude") {
    const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
    const client = new Anthropic({ maxRetries: 2, timeout: 120_000, ...(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}) });
    const res = await client.messages.create({
      model: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });
    return res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  }
  throw new Error("mock");
}
