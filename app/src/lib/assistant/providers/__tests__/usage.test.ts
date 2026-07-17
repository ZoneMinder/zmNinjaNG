/**
 * `toTokenUsage` (refs #246): the OpenAI-shaped `usage` block both backends
 * answer with, mapped to what the context-window check reads.
 */
import { describe, it, expect } from 'vitest';
import { toTokenUsage } from '../usage';

describe('toTokenUsage', () => {
  it('maps a full usage block', () => {
    expect(toTokenUsage({ prompt_tokens: 1200, completion_tokens: 30, total_tokens: 1230 })).toEqual({
      promptTokens: 1200,
      completionTokens: 30,
      totalTokens: 1230,
    });
  });

  it('derives total_tokens when the backend omits it', () => {
    expect(toTokenUsage({ prompt_tokens: 100, completion_tokens: 20 })).toEqual({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
    });
  });

  // A missing block must not read as a measured zero: that would make
  // isContextNearlyFull permanently false and silently disable auto-clear.
  it('returns undefined for a missing or empty usage block', () => {
    expect(toTokenUsage(undefined)).toBeUndefined();
    expect(toTokenUsage(null)).toBeUndefined();
    expect(toTokenUsage({})).toBeUndefined();
  });

  it('returns undefined when prompt_tokens is absent, even if other fields are present', () => {
    expect(toTokenUsage({ completion_tokens: 20, total_tokens: 20 })).toBeUndefined();
  });

  it('keeps a genuine zero prompt count', () => {
    expect(toTokenUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });
});
