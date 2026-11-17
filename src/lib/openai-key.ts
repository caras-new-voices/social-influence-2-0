/**
 * The OpenAI key, from the first of these environment variables that is set:
 * OPEN_AI_2 (the current key), then OPEN_AI_KEY, then OPENAI_API_KEY. Everything that talks to
 * OpenAI (the analyst, month reviews, the query assistant, voice) reads it from here.
 */
export function openAiKey(): string | undefined {
  return process.env.OPEN_AI_2?.trim() || process.env.OPEN_AI_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || undefined;
}
