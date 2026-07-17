/**
 * Maps an OpenAI-shaped `usage` block to `TokenUsage` (refs #246).
 *
 * Shared by both providers: web-llm and Ollama each answer with the OpenAI
 * chat-completion schema, so the same snake_case-to-camelCase mapping serves
 * both. It lives here rather than in `provider.ts` because that module imports
 * both providers, and importing it back from them would be a cycle (rule 31).
 */
import type { TokenUsage } from '../types';

/** The `usage` block as both backends report it. Every field is optional:
 *  usage is absent on an Ollama server that omits it, and web-llm only fills
 *  it on non-streaming responses. */
export interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

/** Returns undefined unless `prompt_tokens` is a real number. That field is
 *  the only one the context-window check reads, so a usage block without it is
 *  worth no more than no usage block at all, and saying so explicitly keeps a
 *  partial report from being mistaken for a measured zero. */
export function toTokenUsage(usage: OpenAiUsage | undefined | null): TokenUsage | undefined {
  if (!usage || typeof usage.prompt_tokens !== 'number') return undefined;
  const promptTokens = usage.prompt_tokens;
  const completionTokens = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens:
      typeof usage.total_tokens === 'number' ? usage.total_tokens : promptTokens + completionTokens,
  };
}
