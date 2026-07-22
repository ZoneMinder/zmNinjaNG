import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NativeLlmProvider, NATIVE_LLM_NOT_AVAILABLE_MESSAGE } from '../native-llm';
import type { ToolDefinition } from '../../types';
import { ASSISTANT } from '../../../zmninja-ng-constants';

const chatMock = vi.fn();
const cancelChatMock = vi.fn().mockResolvedValue(undefined);
const removeMock = vi.fn().mockResolvedValue(undefined);
let capturedStatusCb: ((p: Record<string, unknown>) => void) | null = null;
const addListenerMock = vi.fn(async (_event: string, cb: (p: Record<string, unknown>) => void) => {
  capturedStatusCb = cb;
  return { remove: removeMock };
});
vi.mock('../../../../plugins/native-llm', () => ({
  NativeLlm: {
    // Same device-faithful trap as the global mock in tests/setup.ts: the
    // real Capacitor proxy treats `.then` as a native method, so resolving a
    // promise with the plugin object hangs on device. Throwing keeps this
    // test honest about that contract.
    then: () => {
      throw new Error('"NativeLlm.then()" is not implemented (never resolve a promise with the plugin proxy)');
    },
    chat: (options: unknown) => chatMock(options),
    cancelChat: () => cancelChatMock(),
    addListener: (event: string, cb: (p: Record<string, unknown>) => void) => addListenerMock(event, cb),
  },
}));

vi.mock('../../../platform', () => ({
  Platform: { isNative: true },
}));

const TOOL: ToolDefinition = {
  name: 'count_events',
  description: 'Counts events',
  schema: { type: 'object', properties: { interval: { type: 'string' } } },
  execute: vi.fn(),
};

describe('NativeLlmProvider.chat', () => {
  beforeEach(() => {
    chatMock.mockReset();
    cancelChatMock.mockClear();
    removeMock.mockClear();
    addListenerMock.mockClear();
    capturedStatusCb = null;
  });

  it('forwards native chatStatus phases to onStatus and always removes the listener', async () => {
    chatMock.mockImplementation(async () => {
      capturedStatusCb?.({ phase: 'prefill', progress: 0.5, tokens: 1000, cached: 200 });
      return { content: '{"answer":"ok"}', promptTokens: 1200, completionTokens: 5 };
    });
    const onStatus = vi.fn();
    const provider = new NativeLlmProvider();
    await provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal, onStatus);
    // `cached` is dropped; the UI only needs phase/progress/tokens.
    expect(onStatus).toHaveBeenCalledWith({ phase: 'prefill', progress: 0.5, tokens: 1000 });
    expect(removeMock).toHaveBeenCalledTimes(1);
  });

  it('parses a well-formed reply into an answer turn', async () => {
    chatMock.mockResolvedValue({ content: '{"answer": "There were 5 events today."}', promptTokens: 100, completionTokens: 20 });

    const provider = new NativeLlmProvider();
    const turn = await provider.chat([{ role: 'user', text: 'how many today?' }], [TOOL], 'sys', new AbortController().signal);

    expect(turn.text).toBe('There were 5 events today.');
    expect(turn.toolCalls).toEqual([]);
  });

  // Self-repair retry: a garbage first reply is followed by the failed reply
  // plus a correction, and the second attempt recovers.
  it('retries a garbage reply with a self-repair prompt, then succeeds', async () => {
    chatMock
      .mockResolvedValueOnce({ content: '```', promptTokens: 50, completionTokens: 5 })
      .mockResolvedValueOnce({ content: '{"answer": "Two people came."}', promptTokens: 60, completionTokens: 10 });

    const provider = new NativeLlmProvider();
    const turn = await provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal);

    expect(turn.text).toBe('Two people came.');
    expect(chatMock).toHaveBeenCalledTimes(2);

    const secondOptions = chatMock.mock.calls[1][0] as { messagesJson: string };
    const secondMessages = JSON.parse(secondOptions.messagesJson) as Array<{ role: string; content: string }>;
    expect(secondMessages.at(-2)).toMatchObject({ role: 'assistant', content: '```' });
    expect(secondMessages.at(-1)?.content).toContain('not one valid JSON object');
  });

  it('cancels the native call and throws AbortError when the signal aborts mid-flight', async () => {
    const controller = new AbortController();
    chatMock.mockImplementation(() => {
      controller.abort();
      return Promise.resolve({ content: '{"answer": "partial"}', promptTokens: 1, completionTokens: 1 });
    });

    const provider = new NativeLlmProvider();
    await expect(
      provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelChatMock).toHaveBeenCalled();
  });

  // Fire-and-forget cancelChat() must not become an unhandled rejection when
  // the native side has nothing in flight to cancel: caught and logged at
  // WARN, and the abort still surfaces cleanly as AbortError.
  it('logs a rejecting cancelChat at WARN instead of an unhandled rejection, and still throws AbortError', async () => {
    const { log, LogLevel: Level } = await import('../../../logger');
    const spy = vi.spyOn(log, 'assistant');
    cancelChatMock.mockRejectedValueOnce(new Error('nothing to cancel'));
    const controller = new AbortController();
    chatMock.mockImplementation(() => {
      controller.abort();
      return Promise.resolve({ content: '{"answer": "partial"}', promptTokens: 1, completionTokens: 1 });
    });

    const provider = new NativeLlmProvider();
    await expect(
      provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    // Lets any unhandled rejection from the fire-and-forget cancelChat surface.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(spy).toHaveBeenCalledWith('Native LLM cancelChat failed', Level.WARN, expect.objectContaining({ error: expect.any(Error) }));
  });

  it('attaches usage and exchange to the returned turn', async () => {
    chatMock.mockResolvedValue({ content: '{"answer": "ok"}', promptTokens: 123, completionTokens: 45 });

    const provider = new NativeLlmProvider();
    const turn = await provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal);

    expect(turn.usage).toEqual({ promptTokens: 123, completionTokens: 45, totalTokens: 168 });
    expect(turn.exchange).toMatchObject({ backend: 'native', model: ASSISTANT.nativeLlmModel.id });
    expect(turn.exchange!.received).toContain('ok');
  });

  // Coded plugin rejections (LlamaPlugin.swift's `call.reject(message, code)`,
  // refs #270): the provider translates `.code`, not the raw English message,
  // into what AskPanel renders.
  it('maps a MODEL_NOT_DOWNLOADED rejection to the shared "not available" message', async () => {
    chatMock.mockRejectedValue(Object.assign(new Error('Model is not downloaded'), { code: 'MODEL_NOT_DOWNLOADED' }));

    const provider = new NativeLlmProvider();
    await expect(
      provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal),
    ).rejects.toThrow(NATIVE_LLM_NOT_AVAILABLE_MESSAGE);
  });

  it('maps a CHAT_BUSY rejection to the localized busy sentinel', async () => {
    chatMock.mockRejectedValue(Object.assign(new Error('A chat is already running'), { code: 'CHAT_BUSY' }));

    const provider = new NativeLlmProvider();
    await expect(
      provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal),
    ).rejects.toThrow('__i18n:assistant.native_busy');
  });

  it('maps an ENGINE_FAILED (or any other/missing) rejection to the generic localized sentinel, logging the raw reason', async () => {
    const { log, LogLevel: Level } = await import('../../../logger');
    const spy = vi.spyOn(log, 'assistant');
    chatMock.mockRejectedValue(Object.assign(new Error('Failed to load model'), { code: 'ENGINE_FAILED' }));

    const provider = new NativeLlmProvider();
    await expect(
      provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal),
    ).rejects.toThrow('__i18n:assistant.native_engine_failed');

    expect(spy).toHaveBeenCalledWith(
      'Native LLM chat failed',
      Level.ERROR,
      expect.objectContaining({ code: 'ENGINE_FAILED', message: 'Failed to load model' }),
    );
  });

  it('falls back to the generic localized sentinel for a rejection with no code at all', async () => {
    chatMock.mockRejectedValue(new Error('network hiccup'));

    const provider = new NativeLlmProvider();
    await expect(
      provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal),
    ).rejects.toThrow('__i18n:assistant.native_engine_failed');
  });

  it('builds messages via buildWebLlmMessages: few-shot present, /no_think appended for the qwen3 model id', async () => {
    chatMock.mockResolvedValue({ content: '{"answer": "ok"}', promptTokens: 10, completionTokens: 5 });

    const provider = new NativeLlmProvider();
    await provider.chat([{ role: 'user', text: 'hi' }], [TOOL], 'sys', new AbortController().signal);

    const options = chatMock.mock.calls[0][0] as { messagesJson: string; modelId: string };
    const messages = JSON.parse(options.messagesJson) as Array<{ role: string; content: string }>;
    expect(options.modelId).toBe(ASSISTANT.nativeLlmModel.id);
    expect(messages[0].content).toContain('/no_think');
    // Few-shot anchors follow the system message.
    expect(messages[1]).toMatchObject({ role: 'user', content: 'How many events were recorded today?' });
  });
});

describe('NativeLlmProvider platform gate', () => {
  it('throws the shared "not available" message when not running on a native platform', async () => {
    vi.resetModules();
    vi.doMock('../../../platform', () => ({ Platform: { isNative: false } }));
    const { NativeLlmProvider: GatedProvider, NATIVE_LLM_NOT_AVAILABLE_MESSAGE: gatedMessage } = await import('../native-llm');
    const provider = new GatedProvider();
    await expect(provider.chat([], [], 'sys', new AbortController().signal)).rejects.toThrow(gatedMessage);
    vi.doUnmock('../../../platform');
  });
});
