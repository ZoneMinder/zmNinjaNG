import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiNanoProvider, GEMINI_NANO_NOT_AVAILABLE_MESSAGE } from '../gemini-nano';
import type { ToolDefinition } from '../../types';
import { ASSISTANT } from '../../../zmninja-ng-constants';

const chatMock = vi.fn();
const cancelChatMock = vi.fn().mockResolvedValue(undefined);
const isSupportedMock = vi.fn().mockResolvedValue({ supported: true, contextSize: 7168 });
vi.mock('../../../../plugins/gemini-nano', () => ({
  GeminiNano: {
    // Same device-faithful trap as the other native plugin mocks: the real Capacitor proxy
    // treats `.then` as a native method, so resolving a promise with the plugin object hangs
    // on device. Throwing keeps this test honest about that contract.
    then: () => {
      throw new Error('"GeminiNano.then()" is not implemented (never resolve a promise with the plugin proxy)');
    },
    chat: (options: unknown) => chatMock(options),
    cancelChat: () => cancelChatMock(),
    isSupported: () => isSupportedMock(),
    download: () => Promise.resolve(),
    addListener: () => Promise.resolve({ remove: () => Promise.resolve() }),
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

/** The options object handed to the plugin on the nth (1-based) chat call. */
function sentOptions(call = 1): { messagesJson: string; temperature: number; maxTokens: number; utility?: boolean } {
  return chatMock.mock.calls[call - 1][0];
}

function sentMessages(call = 1): Array<{ role: string; content: string }> {
  return JSON.parse(sentOptions(call).messagesJson);
}

describe('GeminiNanoProvider', () => {
  beforeEach(() => {
    chatMock.mockReset();
    cancelChatMock.mockClear();
    isSupportedMock.mockClear();
    isSupportedMock.mockResolvedValue({ supported: true, contextSize: 7168 });
  });

  it('adopts the device window from isSupported (Pixel 10 reports an 8192 limit)', async () => {
    chatMock.mockResolvedValue({ content: '{"answer":"ok"}', promptTokens: 100 });
    const provider = new GeminiNanoProvider();
    expect(provider.contextWindow).toBeUndefined(); // not learned until the first native call
    await provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal);
    expect(provider.contextWindow).toBe(7168);
  });

  it('parses a well-formed reply into an answer turn', async () => {
    chatMock.mockResolvedValue({ content: '{"answer":"There were 14 events."}', promptTokens: 900 });
    const provider = new GeminiNanoProvider();
    const turn = await provider.chat([{ role: 'user', text: 'how many?' }], [TOOL], 'sys', new AbortController().signal);
    expect(turn.text).toBe('There were 14 events.');
    expect(turn.toolCalls).toEqual([]);
  });

  it('parses a tool call and passes its arguments through', async () => {
    chatMock.mockResolvedValue({
      content: '{"tool":"count_events","input":{"interval":"today"}}',
      promptTokens: 900,
    });
    const provider = new GeminiNanoProvider();
    const turn = await provider.chat([{ role: 'user', text: 'how many?' }], [TOOL], 'sys', new AbortController().signal);
    expect(turn.toolCalls).toEqual([expect.objectContaining({ name: 'count_events', input: { interval: 'today' } })]);
  });

  it('counts the prompt from the plugin and estimates only the completion', async () => {
    const content = '{"answer":"ok"}';
    chatMock.mockResolvedValue({ content, promptTokens: 913 });
    const provider = new GeminiNanoProvider();
    const turn = await provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal);
    // Exact from the tokenizer, NOT the chars/3.5 estimate: the prompt count is what the
    // auto-clear budget is spent against, so a guess there overflows the context.
    expect(turn.usage?.promptTokens).toBe(913);
    expect(turn.usage?.completionTokens).toBe(Math.ceil(content.length / 3.5));
  });

  it('falls back to an estimate when the plugin could not count the prompt', async () => {
    chatMock.mockResolvedValue({ content: '{"answer":"ok"}' }); // promptTokens absent
    const provider = new GeminiNanoProvider();
    const turn = await provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal);
    const sent = sentOptions().messagesJson;
    expect(turn.usage?.promptTokens).toBe(Math.ceil(sent.length / 3.5));
  });

  it('retries an unparseable reply with a self-repair turn appended, raising temperature only on the last attempt', async () => {
    // A bare fence is the reply shape `parseWebLlmTurn` cannot rescue; prose alone is not,
    // since it is accepted as an answer.
    chatMock.mockResolvedValue({ content: '```', promptTokens: 900 });
    const provider = new GeminiNanoProvider();
    await provider.chat([{ role: 'user', text: 'how many?' }], [TOOL], 'sys', new AbortController().signal);

    expect(chatMock).toHaveBeenCalledTimes(ASSISTANT.maxParseAttempts);
    // The failed reply plus the correction are appended before each retry, so the second
    // call carries two more messages than the first.
    expect(sentMessages(2).length).toBe(sentMessages(1).length + 2);
    expect(sentMessages(2).at(-2)).toEqual({ role: 'assistant', content: '```' });
    expect(sentOptions(1).temperature).toBe(ASSISTANT.assistantTemperature);
    expect(sentOptions(ASSISTANT.maxParseAttempts).temperature).toBe(ASSISTANT.assistantRetryTemperature);
  });

  it('recovers on the second attempt when the self-repair reply parses', async () => {
    chatMock
      .mockResolvedValueOnce({ content: '```', promptTokens: 50 })
      .mockResolvedValueOnce({ content: '{"answer":"Two people came."}', promptTokens: 60 });
    const provider = new GeminiNanoProvider();
    const turn = await provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal);
    expect(turn.text).toBe('Two people came.');
    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  it('routes complete() to the second busy slot so a nested interpreter call is never CHAT_BUSY', async () => {
    chatMock.mockResolvedValue({ content: 'today', promptTokens: 40 });
    const provider = new GeminiNanoProvider();
    await provider.complete('sys', 'interpret this', new AbortController().signal);
    expect(sentOptions().utility).toBe(true);
    // A tool-loop turn must NOT claim that slot, or the two would collide.
    chatMock.mockReset();
    chatMock.mockResolvedValue({ content: '{"answer":"ok"}', promptTokens: 40 });
    await provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal);
    expect(sentOptions().utility).toBeUndefined();
  });

  it('cancels the native call on abort and reports it as an AbortError', async () => {
    const controller = new AbortController();
    chatMock.mockImplementation(async () => {
      controller.abort();
      throw new Error('cancelled natively');
    });
    const provider = new GeminiNanoProvider();
    await expect(provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(cancelChatMock).toHaveBeenCalled();
  });

  describe('plugin error codes', () => {
    // Each code GeminiNanoPlugin.java rejects with maps to a message the panel can act on.
    // BACKGROUND_BLOCKED and QUOTA_EXCEEDED are the two AICore-specific ones, and both are
    // user-recoverable, which is why neither may collapse into the generic engine failure:
    // "try again" is wrong advice for both.
    const cases: Array<[string, string]> = [
      ['MODEL_NOT_AVAILABLE', GEMINI_NANO_NOT_AVAILABLE_MESSAGE],
      ['CHAT_BUSY', '__i18n:assistant.native_busy'],
      ['BACKGROUND_BLOCKED', '__i18n:assistant.gemini_background_blocked'],
      ['QUOTA_EXCEEDED', '__i18n:assistant.gemini_quota_exceeded'],
      ['ENGINE_FAILED', '__i18n:assistant.native_engine_failed'],
      ['SOMETHING_NEW', '__i18n:assistant.native_engine_failed'],
    ];
    it.each(cases)('maps %s to its own message', async (code, expected) => {
      chatMock.mockRejectedValue(Object.assign(new Error('native said no'), { code }));
      const provider = new GeminiNanoProvider();
      await expect(provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal)).rejects.toThrow(
        expected,
      );
    });
  });
});
