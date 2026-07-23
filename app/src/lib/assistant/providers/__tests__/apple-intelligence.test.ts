import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppleIntelligenceProvider } from '../apple-intelligence';
import type { ToolDefinition } from '../../types';
import { ASSISTANT } from '../../../zmninja-ng-constants';

const chatMock = vi.fn();
const cancelChatMock = vi.fn().mockResolvedValue(undefined);
const isSupportedMock = vi.fn().mockResolvedValue({ supported: true, contextSize: 4096 });
vi.mock('../../../../plugins/apple-intelligence', () => ({
  AppleIntelligence: {
    // Same device-faithful trap as native-llm's mock: the real Capacitor proxy
    // treats `.then` as a native method, so resolving a promise with the plugin
    // object hangs on device. Throwing keeps this test honest about that contract.
    then: () => {
      throw new Error('"AppleIntelligence.then()" is not implemented (never resolve a promise with the plugin proxy)');
    },
    chat: (options: unknown) => chatMock(options),
    cancelChat: () => cancelChatMock(),
    isSupported: () => isSupportedMock(),
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

describe('AppleIntelligenceProvider.chat', () => {
  beforeEach(() => {
    chatMock.mockReset();
    cancelChatMock.mockClear();
    isSupportedMock.mockClear();
    isSupportedMock.mockResolvedValue({ supported: true, contextSize: 4096 });
  });

  it('adopts the usable context window learned from isSupported', async () => {
    isSupportedMock.mockResolvedValue({ supported: true, contextSize: 4096 });
    chatMock.mockResolvedValue({ content: '{"answer":"ok"}' });
    const provider = new AppleIntelligenceProvider();
    expect(provider.contextWindow).toBeUndefined(); // not learned until the first native call
    await provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal);
    expect(provider.contextWindow).toBe(4096);
  });

  it('parses a well-formed reply into an answer turn', async () => {
    chatMock.mockResolvedValue({ content: '{"answer": "There were 5 events today."}' });

    const provider = new AppleIntelligenceProvider();
    const turn = await provider.chat([{ role: 'user', text: 'how many today?' }], [TOOL], 'sys', new AbortController().signal);

    expect(turn.text).toBe('There were 5 events today.');
    expect(turn.toolCalls).toEqual([]);
  });

  // Retry: a garbage first reply is followed by the failed reply plus a
  // neutral correction (never WebLLM's contract-restating SELF_REPAIR_PROMPT,
  // refs #270), and the second attempt recovers.
  it('retries a garbage reply with a contract-free correction, then succeeds', async () => {
    chatMock
      .mockResolvedValueOnce({ content: '```' })
      .mockResolvedValueOnce({ content: '{"answer": "Two people came."}' });

    const provider = new AppleIntelligenceProvider();
    const turn = await provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal);

    expect(turn.text).toBe('Two people came.');
    expect(chatMock).toHaveBeenCalledTimes(2);

    const secondOptions = chatMock.mock.calls[1][0] as { messagesJson: string };
    const secondMessages = JSON.parse(secondOptions.messagesJson) as Array<{ role: string; content: string }>;
    expect(secondMessages.at(-2)).toMatchObject({ role: 'assistant', content: '```' });
    expect(secondMessages.at(-1)?.content).toContain('empty or unusable');
    expect(secondOptions.messagesJson).not.toContain('Respond with ONLY a single JSON object');
  });

  it('cancels the native call and throws AbortError when the signal aborts mid-flight', async () => {
    const controller = new AbortController();
    chatMock.mockImplementation(() => {
      controller.abort();
      return Promise.resolve({ content: '{"answer": "partial"}' });
    });

    const provider = new AppleIntelligenceProvider();
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
      return Promise.resolve({ content: '{"answer": "partial"}' });
    });

    const provider = new AppleIntelligenceProvider();
    await expect(
      provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    // Lets any unhandled rejection from the fire-and-forget cancelChat surface.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(spy).toHaveBeenCalledWith('Apple Intelligence cancelChat failed', Level.WARN, expect.objectContaining({ error: expect.any(Error) }));
  });

  it('attaches an exchange and estimated usage to the returned turn', async () => {
    const content = '{"answer": "ok"}';
    chatMock.mockResolvedValue({ content });

    const provider = new AppleIntelligenceProvider();
    const turn = await provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal);

    // Foundation Models reports no counts; usage is a chars/3.5 estimate so
    // AskPanel's auto-clear can act before the small context window overflows.
    expect(turn.usage).toBeDefined();
    expect(turn.usage!.promptTokens).toBeGreaterThan(0);
    expect(turn.usage!.completionTokens).toBe(Math.ceil(content.length / 3.5));
    expect(turn.usage!.totalTokens).toBe(turn.usage!.promptTokens + turn.usage!.completionTokens);
    expect(turn.exchange).toMatchObject({ backend: 'apple', model: ASSISTANT.appleIntelligenceModelId });
    expect(turn.exchange!.received).toContain('ok');
  });

  // Coded plugin rejections (the native side's `reject(message, code)`, refs
  // #270): the provider translates `.code`, not the raw English message.
  it('maps a CHAT_BUSY rejection to the localized busy sentinel', async () => {
    chatMock.mockRejectedValue(Object.assign(new Error('A chat is already running'), { code: 'CHAT_BUSY' }));

    const provider = new AppleIntelligenceProvider();
    await expect(
      provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal),
    ).rejects.toThrow('__i18n:assistant.native_busy');
  });

  it('maps an ENGINE_FAILED (or any other/missing) rejection to the generic localized sentinel, logging the raw reason', async () => {
    const { log, LogLevel: Level } = await import('../../../logger');
    const spy = vi.spyOn(log, 'assistant');
    chatMock.mockRejectedValue(Object.assign(new Error('Failed to run model'), { code: 'ENGINE_FAILED' }));

    const provider = new AppleIntelligenceProvider();
    await expect(
      provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal),
    ).rejects.toThrow('__i18n:assistant.native_engine_failed');

    expect(spy).toHaveBeenCalledWith(
      'Apple Intelligence chat failed',
      Level.ERROR,
      expect.objectContaining({ code: 'ENGINE_FAILED', message: 'Failed to run model' }),
    );
  });

  it('falls back to the generic localized sentinel for a rejection with no code at all', async () => {
    chatMock.mockRejectedValue(new Error('network hiccup'));

    const provider = new AppleIntelligenceProvider();
    await expect(
      provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal),
    ).rejects.toThrow('__i18n:assistant.native_engine_failed');
  });

  // Constrained decoding: with tools and a tool result already in the turn, the
  // plugin gets a schema whose anyOf carries the answer shape plus one tool
  // branch pinning each tool name.
  it('passes a schemaJson whose anyOf pins the tool name and offers the answer branch once a tool result exists', async () => {
    chatMock.mockResolvedValue({ content: '{"answer": "ok"}' });

    const provider = new AppleIntelligenceProvider();
    await provider.chat(
      [
        { role: 'user', text: 'hi' },
        { role: 'tool', toolResults: [{ callId: '1', output: '14 events' }] },
      ],
      [TOOL],
      'sys',
      new AbortController().signal,
    );

    const options = chatMock.mock.calls[0][0] as { schemaJson: string };
    const schema = JSON.parse(options.schemaJson) as {
      anyOf: Array<{ properties?: { tool?: { enum?: string[] }; answer?: unknown; input?: unknown } }>;
    };
    // The answer branch is present...
    expect(schema.anyOf.some((s) => s.properties?.answer !== undefined && s.properties.tool === undefined)).toBe(true);
    // ...and a tool branch pins count_events with its input schema inlined.
    const toolBranch = schema.anyOf.find((s) => s.properties?.tool?.enum?.includes('count_events'));
    expect(toolBranch).toBeDefined();
    expect(toolBranch!.properties!.input).toEqual(TOOL.schema);
  });

  // The fabrication fix (refs #270): tools registered and nothing fetched yet
  // means NO answer branch at all, so this model cannot answer a data question
  // out of thin air. A lone tool needs no anyOf wrapper.
  it('drops the answer branch entirely when tools are given and no tool result is in the turn', async () => {
    chatMock.mockResolvedValue({ content: '{"tool": "count_events", "input": {}}' });

    const provider = new AppleIntelligenceProvider();
    await provider.chat([{ role: 'user', text: 'how many today?' }], [TOOL], 'sys', new AbortController().signal);

    const options = chatMock.mock.calls[0][0] as { schemaJson: string };
    expect(options.schemaJson).not.toContain('answer');
    const schema = JSON.parse(options.schemaJson) as {
      anyOf?: unknown;
      required?: string[];
      properties?: { tool?: { enum?: string[] }; input?: unknown };
    };
    expect(schema.anyOf).toBeUndefined();
    expect(schema.required).toEqual(['tool', 'input']);
    expect(schema.properties?.tool?.enum).toEqual(['count_events']);
    expect(schema.properties?.input).toEqual(TOOL.schema);
  });

  it('offers every tool branch and no answer branch when several tools are given with no tool result', async () => {
    chatMock.mockResolvedValue({ content: '{"tool": "count_events", "input": {}}' });
    const other: ToolDefinition = { name: 'list_monitors', description: 'Lists monitors', schema: { type: 'object', properties: {} }, execute: vi.fn() };

    const provider = new AppleIntelligenceProvider();
    await provider.chat([{ role: 'user', text: 'how many today?' }], [TOOL, other], 'sys', new AbortController().signal);

    const options = chatMock.mock.calls[0][0] as { schemaJson: string };
    expect(options.schemaJson).not.toContain('answer');
    const schema = JSON.parse(options.schemaJson) as { anyOf: Array<{ properties?: { tool?: { enum?: string[] } } }> };
    expect(schema.anyOf.map((s) => s.properties?.tool?.enum?.[0])).toEqual(['count_events', 'list_monitors']);
  });

  // The retry path must not quietly widen the schema back to the union: the
  // same tool-only schema is re-sent with the neutral correction.
  it('re-sends the same tool-only schema on a retry attempt', async () => {
    chatMock
      .mockResolvedValueOnce({ content: '```' })
      .mockResolvedValueOnce({ content: '{"tool": "count_events", "input": {}}' });

    const provider = new AppleIntelligenceProvider();
    await provider.chat([{ role: 'user', text: 'how many today?' }], [TOOL], 'sys', new AbortController().signal);

    const first = chatMock.mock.calls[0][0] as { schemaJson: string };
    const second = chatMock.mock.calls[1][0] as { schemaJson: string };
    expect(second.schemaJson).toBe(first.schemaJson);
    expect(second.schemaJson).not.toContain('answer');
  });

  // A tool-less turn gets the answer-only schema, so a tool call is structurally
  // impossible where there is no tool to call.
  it('passes an answer-only schemaJson when no tools are given', async () => {
    chatMock.mockResolvedValue({ content: '{"answer": "ok"}' });

    const provider = new AppleIntelligenceProvider();
    await provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal);

    const options = chatMock.mock.calls[0][0] as { schemaJson: string };
    const schema = JSON.parse(options.schemaJson) as { anyOf?: unknown; required?: string[]; properties?: Record<string, unknown> };
    expect(schema.anyOf).toBeUndefined();
    expect(schema.required).toEqual(['answer']);
    expect(Object.keys(schema.properties ?? {})).toEqual(['answer']);
  });

  it('forwards a complete() jsonSchema to the plugin as schemaJson', async () => {
    chatMock.mockResolvedValue({ content: 'OK' });
    const jsonSchema = { type: 'object', properties: { verdict: { type: 'string' } }, required: ['verdict'] };

    const provider = new AppleIntelligenceProvider();
    await provider.complete('sys', 'check this', new AbortController().signal, jsonSchema);

    const options = chatMock.mock.calls[0][0] as { schemaJson?: string };
    expect(options.schemaJson).toBeDefined();
    expect(JSON.parse(options.schemaJson!)).toEqual(jsonSchema);
  });

  it('omits schemaJson from complete() when no jsonSchema is given', async () => {
    chatMock.mockResolvedValue({ content: 'OK' });

    const provider = new AppleIntelligenceProvider();
    await provider.complete('sys', 'hi', new AbortController().signal);

    const options = chatMock.mock.calls[0][0] as { schemaJson?: string };
    expect(options.schemaJson).toBeUndefined();
  });

  // All format teaching leaves the prompt on this backend: the schema enforces
  // the reply shape at the decoder, and the textual contract made the model
  // write JSON inside the constrained answer string while the few-shot got
  // parroted verbatim (refs #270). Asserted on BOTH turn kinds.
  it.each([
    ['with tools', [TOOL]],
    ['tool-less', [] as ToolDefinition[]],
  ])('omits the few-shot examples and the output contract on a %s chat turn', async (_label, turnTools) => {
    chatMock.mockResolvedValue({ content: '{"answer": "Hi there."}' });

    const provider = new AppleIntelligenceProvider();
    await provider.chat([{ role: 'user', text: 'hello' }], turnTools, 'sys', new AbortController().signal);

    const options = chatMock.mock.calls[0][0] as { messagesJson: string };
    expect(options.messagesJson).not.toContain('EXAMPLE_MONITOR_A');
    expect(options.messagesJson).not.toContain('Respond with ONLY a single JSON object');
    const messages = JSON.parse(options.messagesJson) as Array<{ role: string; content: string }>;
    // The real user turn follows the system message directly, verbatim.
    expect(messages[1]).toMatchObject({ role: 'user', content: 'hello' });
  });
});

describe('AppleIntelligenceProvider platform gate', () => {
  it('throws the shared "not available" message when not running on a native platform', async () => {
    vi.resetModules();
    vi.doMock('../../../platform', () => ({ Platform: { isNative: false } }));
    const { AppleIntelligenceProvider: GatedProvider, APPLE_INTELLIGENCE_NOT_AVAILABLE_MESSAGE: gatedMessage } = await import('../apple-intelligence');
    const provider = new GatedProvider();
    await expect(provider.chat([], [], 'sys', new AbortController().signal)).rejects.toThrow(gatedMessage);
    vi.doUnmock('../../../platform');
  });
});
