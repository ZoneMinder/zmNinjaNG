import { describe, it, expect, vi } from 'vitest';
import { parseRequestKind, classifyRequest, buildNoToolPrompt } from '../triage';
import type { AssistantProvider } from '../types';

function providerSaying(text: string): AssistantProvider {
  return { complete: vi.fn().mockResolvedValue({ text }) } as unknown as AssistantProvider;
}

describe('parseRequestKind', () => {
  it('reads the three kinds', () => {
    expect(parseRequestKind('ZONEMINDER')).toBe('zoneminder');
    expect(parseRequestKind('ACTION')).toBe('action');
    expect(parseRequestKind('CHAT')).toBe('chat');
  });

  // The on-device paths wrap every reply in the JSON answer envelope and small
  // models add punctuation, so the keyword is matched inside whatever arrives
  // rather than requiring a clean one-word reply.
  it('finds the keyword inside a wrapped or punctuated reply', () => {
    expect(parseRequestKind('{"answer":"CHAT"}')).toBe('chat');
    expect(parseRequestKind('chat.')).toBe('chat');
    expect(parseRequestKind('The answer is ACTION')).toBe('action');
  });

  // Misrouting a real question to the no-tools path answers it with no data at
  // all, which is worse than letting small talk reach the tool loop.
  it('defaults to zoneminder when the reply says nothing useful', () => {
    expect(parseRequestKind('')).toBe('zoneminder');
    expect(parseRequestKind('I am not sure what you mean')).toBe('zoneminder');
  });

  it('prefers zoneminder when more than one keyword appears', () => {
    expect(parseRequestKind('not CHAT, this is ZONEMINDER')).toBe('zoneminder');
  });
});

describe('classifyRequest', () => {
  // `complete`, not `chat`: through `chat` the WebLLM and MNN paths wrap the
  // call in the agent's tool catalog, few-shot block and JSON output contract,
  // and the classifier answers like an assistant instead of classifying.
  it('uses a plain completion, with the triage prompt as the system message', async () => {
    const provider = providerSaying('CHAT');
    await classifyRequest(provider, 'hello', new AbortController().signal);

    const [system, text] = vi.mocked(provider.complete).mock.calls[0];
    expect(system).toContain('ZONEMINDER');
    expect(text).toBe('hello');
  });

  // A triage outage must degrade to the previous behaviour (everything reaches
  // the tool loop), never to an assistant that cannot answer questions.
  it('falls back to zoneminder when the provider throws', async () => {
    const provider = { complete: vi.fn().mockRejectedValue(new Error('offline')) } as unknown as AssistantProvider;
    await expect(classifyRequest(provider, 'is the server ok', new AbortController().signal)).resolves.toBe(
      'zoneminder',
    );
  });

  it('propagates an abort instead of swallowing it as a classification', async () => {
    const provider = {
      complete: vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')),
    } as unknown as AssistantProvider;
    await expect(classifyRequest(provider, 'hello', new AbortController().signal)).rejects.toThrow('Aborted');
  });

  it('reads the keyword out of a wrapped reply', async () => {
    await expect(
      classifyRequest(providerSaying('{"answer":"CHAT"}'), 'hi', new AbortController().signal),
    ).resolves.toBe('chat');
  });
});

describe('buildNoToolPrompt', () => {
  it('keeps the base prompt and tells a chat turn not to mention tools', () => {
    const prompt = buildNoToolPrompt('BASE PROMPT', 'chat');
    expect(prompt).toContain('BASE PROMPT');
    expect(prompt).toContain('not a question about this ZoneMinder installation');
    expect(prompt).toContain('Do not mention tools');
  });

  it('tells an action turn to refuse and say where to do it by hand', () => {
    const prompt = buildNoToolPrompt('BASE PROMPT', 'action');
    expect(prompt).toContain('cannot be undone');
    expect(prompt).toContain('Monitors screen');
  });
});
