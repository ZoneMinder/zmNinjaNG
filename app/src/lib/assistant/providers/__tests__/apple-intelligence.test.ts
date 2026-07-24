import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppleIntelligenceProvider } from '../apple-intelligence';
import { buildWebLlmMessages } from '../webllm';
import { buildSystemPrompt } from '../../system-prompt';
import { readOnlyTools } from '../../tools-readonly';
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

/** The standard fixture the instruction tests measure against: a real
 *  `buildSystemPrompt` output with every dynamic fact populated. */
const FIXTURE_SYSTEM = buildSystemPrompt({
  now: new Date('2026-07-22T18:00:00Z'),
  timezone: 'America/New_York',
  locale: 'en-US',
  zmVersion: '1.36.33',
  objectLabels: ['person', 'car', 'truck'],
});

/** One branch of the turn schema, as the plugin receives it. */
type Branch = { properties?: Record<string, unknown>; required?: string[] };

/** The system message the plugin actually received on the first call. */
function sentInstructions(): string {
  const { messagesJson } = chatMock.mock.calls[0][0] as { messagesJson: string };
  return (JSON.parse(messagesJson) as Array<{ role: string; content: string }>)[0].content;
}

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
    // The schema is part of the prompt budget under guided generation, so it is
    // counted alongside the messages (refs #270).
    const sent = chatMock.mock.calls[0][0] as { messagesJson: string; schemaJson: string };
    expect(turn.usage).toBeDefined();
    expect(turn.usage!.promptTokens).toBe(Math.ceil((sent.messagesJson.length + sent.schemaJson.length) / 3.5));
    expect(turn.usage!.promptTokens).toBeGreaterThan(Math.ceil(sent.messagesJson.length / 3.5));
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

  // A truncated constrained decode (the prompt crowding the window so generation
  // stops mid-JSON) rejects as ENGINE_FAILED with a deserialize message. That is
  // a failed attempt, not a failed turn, so the loop spends another attempt on it
  // (refs #270).
  it('retries an ENGINE_FAILED deserialize rejection and returns the next attempt\'s answer', async () => {
    chatMock
      .mockRejectedValueOnce(
        Object.assign(new Error('Failed to deserialize a Generable type from model output'), { code: 'ENGINE_FAILED' }),
      )
      .mockResolvedValueOnce({ content: '{"answer": "Four events."}' });

    const provider = new AppleIntelligenceProvider();
    const turn = await provider.chat([{ role: 'user', text: 'how many?' }], [], 'sys', new AbortController().signal);

    expect(turn.text).toBe('Four events.');
    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  it('rethrows the mapped engine error when every attempt truncates', async () => {
    chatMock.mockRejectedValue(
      Object.assign(new Error('Failed to deserialize a Generable type from model output'), { code: 'ENGINE_FAILED' }),
    );

    const provider = new AppleIntelligenceProvider();
    await expect(
      provider.chat([{ role: 'user', text: 'how many?' }], [], 'sys', new AbortController().signal),
    ).rejects.toThrow('__i18n:assistant.native_engine_failed');
    expect(chatMock).toHaveBeenCalledTimes(ASSISTANT.maxParseAttempts);
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

  // A failed call's error feedback also arrives as a `role: 'tool'` message, but
  // it is a correction, not data. Observed live, counting it unlocked the answer
  // branch and the model fabricated event counts instead of fixing the call.
  it('keeps the answer branch locked when the only tool result is an error', async () => {
    chatMock.mockResolvedValue({ content: '{"tool": "count_events", "input": {}}' });

    const provider = new AppleIntelligenceProvider();
    await provider.chat(
      [
        { role: 'user', text: 'how many today?' },
        { role: 'tool', toolResults: [{ callId: '1', output: 'Unknown tool: count_event', isError: true }] },
      ],
      [TOOL],
      'sys',
      new AbortController().signal,
    );

    const options = chatMock.mock.calls[0][0] as { schemaJson: string };
    expect(options.schemaJson).not.toContain('answer');
    const schema = JSON.parse(options.schemaJson) as { anyOf?: unknown; required?: string[] };
    expect(schema.anyOf).toBeUndefined();
    expect(schema.required).toEqual(['tool', 'input']);
  });

  it('offers the answer branch when one result succeeded alongside a failed one', async () => {
    chatMock.mockResolvedValue({ content: '{"answer": "ok"}' });

    const provider = new AppleIntelligenceProvider();
    await provider.chat(
      [
        { role: 'user', text: 'how many today?' },
        {
          role: 'tool',
          toolResults: [
            { callId: '1', output: 'bad arguments', isError: true },
            { callId: '2', output: '14 events' },
          ],
        },
      ],
      [TOOL],
      'sys',
      new AbortController().signal,
    );

    const options = chatMock.mock.calls[0][0] as { schemaJson: string };
    const schema = JSON.parse(options.schemaJson) as {
      anyOf: Array<{ properties?: { tool?: { enum?: string[] }; answer?: unknown } }>;
    };
    expect(schema.anyOf.some((s) => s.properties?.answer !== undefined && s.properties.tool === undefined)).toBe(true);
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
    expect(Object.keys(schema.properties ?? {})).toEqual(['reasoning', 'answer']);
  });

  // Apple's reasoning-first technique: generation is sequential, so a short
  // reason emitted BEFORE the decision is the only part that can condition it.
  // Optional in every branch, and ignored by the parser (refs #270).
  it.each([
    ['answer-only (no tools)', [] as ToolDefinition[], []],
    ['tool-only (no result yet)', [TOOL], []],
    ['the union (a tool result exists)', [TOOL], [{ role: 'tool' as const, toolResults: [{ callId: '1', output: '14 events' }] }]],
  ])('puts an optional reasoning property first in every %s schema branch', async (_label, turnTools, history) => {
    chatMock.mockResolvedValue({ content: '{"answer": "ok"}' });

    const provider = new AppleIntelligenceProvider();
    await provider.chat([{ role: 'user', text: 'hi' }, ...history], turnTools, 'sys', new AbortController().signal);

    const { schemaJson } = chatMock.mock.calls[0][0] as { schemaJson: string };
    const parsed = JSON.parse(schemaJson) as { anyOf?: Branch[] } & Branch;
    for (const branch of parsed.anyOf ?? [parsed]) {
      expect(Object.keys(branch.properties ?? {})[0]).toBe('reasoning');
      expect(branch.properties?.reasoning).toEqual({ type: 'string', description: 'One sentence of reasoning first.' });
      expect(branch.required).not.toContain('reasoning');
    }
  });

  it('ignores the reasoning field when parsing the reply', async () => {
    chatMock.mockResolvedValue({ content: '{"reasoning": "They asked for a count.", "tool": "count_events", "input": {"lastCount": 1, "lastUnit": "day"}}' });

    const provider = new AppleIntelligenceProvider();
    const turn = await provider.chat([{ role: 'user', text: 'how many?' }], [TOOL], 'sys', new AbortController().signal);

    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0]).toMatchObject({ name: 'count_events', input: { lastCount: 1, lastUnit: 'day' } });
  });

  // The plugin reports real counts when the OS exposes them; the chars/3.5
  // estimate is only the fallback (asserted by the usage test above).
  it('prefers the token counts the plugin reports over the estimate', async () => {
    chatMock.mockResolvedValue({ content: '{"answer": "ok"}', promptTokens: 812, completionTokens: 19 });

    const provider = new AppleIntelligenceProvider();
    const turn = await provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal);

    expect(turn.usage).toEqual({ promptTokens: 812, completionTokens: 19, totalTokens: 831 });
  });

  // Out of window is not a broken engine: re-sending the same prompt cannot
  // help, so the oldest half of the conversation is dropped and the turn is
  // sent again (Apple's condensed-transcript recovery, refs #270).
  it('drops the oldest half of the history on a CONTEXT_FULL rejection, then succeeds', async () => {
    chatMock
      .mockRejectedValueOnce(Object.assign(new Error('Context window full'), { code: 'CONTEXT_FULL' }))
      .mockResolvedValueOnce({ content: '{"answer": "Recovered."}' });

    const provider = new AppleIntelligenceProvider();
    const turn = await provider.chat(
      [
        { role: 'user', text: 'OLDEST_TURN' },
        { role: 'assistant', text: 'first reply' },
        { role: 'user', text: 'MIDDLE_TURN' },
        { role: 'assistant', text: 'second reply' },
        { role: 'user', text: 'NEWEST_TURN' },
      ],
      [],
      'sys',
      new AbortController().signal,
    );

    expect(turn.text).toBe('Recovered.');
    const first = JSON.parse((chatMock.mock.calls[0][0] as { messagesJson: string }).messagesJson) as Array<{ role: string }>;
    const second = JSON.parse((chatMock.mock.calls[1][0] as { messagesJson: string }).messagesJson) as Array<{ role: string; content: string }>;
    expect(first).toHaveLength(6);
    expect(second).toHaveLength(4);
    // The instructions survive, the oldest exchange is gone, the newest stays.
    expect(second[0].role).toBe('system');
    expect(second.map((m) => m.content).join('\n')).not.toContain('OLDEST_TURN');
    expect(second.map((m) => m.content).join('\n')).toContain('NEWEST_TURN');
  });

  it('rethrows when the context is still full after the history was halved', async () => {
    chatMock.mockRejectedValue(Object.assign(new Error('Context window full'), { code: 'CONTEXT_FULL' }));

    const provider = new AppleIntelligenceProvider();
    await expect(
      provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal),
    ).rejects.toThrow('__i18n:assistant.native_engine_failed');
    // One recovery attempt only, never the full parse-retry budget.
    expect(chatMock).toHaveBeenCalledTimes(2);
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

// The prompt rework (refs #270): Foundation Models is documented as bad at long
// prompts and good at a "You are ..." persona, short imperative rules, short
// examples inside the instructions, and the key rule repeated last. The shared
// system prompt is none of those, so this backend composes its own instructions
// around the caller's dynamic facts.
describe('AppleIntelligenceProvider instructions', () => {
  beforeEach(() => {
    chatMock.mockReset();
    chatMock.mockResolvedValue({ content: '{"answer": "ok"}' });
    isSupportedMock.mockResolvedValue({ supported: true, contextSize: 4096 });
  });

  async function runFixtureTurn(tools: ToolDefinition[] = readOnlyTools): Promise<string> {
    const provider = new AppleIntelligenceProvider();
    await provider.chat([{ role: 'user', text: 'how many events today?' }], tools, FIXTURE_SYSTEM, new AbortController().signal);
    return sentInstructions();
  }

  it('opens with the persona and who the person is, and closes on the grounding rule', async () => {
    const instructions = await runFixtureTurn();

    expect(instructions.startsWith('You are Ninjii, an expert assistant for the person\'s ZoneMinder security camera system.')).toBe(true);
    expect(instructions).toContain('The person owns these cameras and asks about their own recordings.');
    expect(instructions.trimEnd().endsWith('Every fact you state must come from a tool result in this turn. Never invent a count, a name, an id, or a time.')).toBe(true);
  });

  it('carries short tool-call examples in the exact turn shape, with placeholder values only', async () => {
    const instructions = await runFixtureTurn();

    expect(instructions).toContain('{"reasoning": "The person wants a rolling 24 hour total.", "tool": "count_events", "input": {"lastCount": 24, "lastUnit": "hour"}}');
    expect(instructions).toContain('"tool": "list_events", "input": {"when": "yesterday"}}');
    expect(instructions).toContain('EXAMPLE_MONITOR_ID');
    // Three examples, and none of them an answer carrying data the model could
    // repeat as this installation's own (the WebLLM few-shot failure).
    expect(instructions.match(/"tool":/g)).toHaveLength(3);
    expect(instructions).not.toContain('"answer":');
  });

  // The dynamic facts are the part that CANNOT be rewritten here, because only
  // the caller knows them. A reworded buildSystemPrompt must fail this test
  // rather than silently drop one.
  it('keeps every dynamic fact from the shared system prompt', async () => {
    const instructions = await runFixtureTurn();

    expect(instructions).toContain('Wednesday, 2026-07-22');
    expect(instructions).toContain('America/New_York');
    expect(instructions).toContain('ZoneMinder version: 1.36.33.');
    expect(instructions).toContain('locale code: en-US');
    expect(instructions).toContain('Detected object labels seen recently on this installation: person, car, truck.');
  });

  it('states each tool as its name plus the first sentence of its description only', async () => {
    const instructions = await runFixtureTurn();

    expect(instructions).toContain(
      '- list_monitors: List all monitors visible in the current profile: id, name, type, function, enabled/controllable flags, and live status (connection state, capture/analysis fps when available).',
    );
    // The rest of that description is gone: the turn schema enforces the call
    // shape, so the prose guard rails are dead weight in this window.
    expect(instructions).not.toContain('Call this first when the user refers to a monitor by name');
    expect(instructions).not.toContain('It has TWO hard limits.');
    // An abbreviation is not a sentence end.
    expect(instructions).toContain('- navigate: Navigate the app to a specific in-app path (e.g. "/monitors/3"');
  });

  it('is far shorter than the shared prompt plus the full tool catalog it replaces', async () => {
    const instructions = await runFixtureTurn();
    const previous = String(buildWebLlmMessages(FIXTURE_SYSTEM, [], readOnlyTools, 'apple', false, true, false)[0].content);

    expect(instructions.length).toBeLessThan(previous.length * 0.7);
  });

  it('says there are no tools and offers no examples on a tool-less turn', async () => {
    const instructions = await runFixtureTurn([]);

    expect(instructions).toContain('You have no tools this turn. Answer the person directly.');
    expect(instructions).not.toContain('"tool":');
    expect(instructions).not.toContain('SHOW: events=');
    // The persona and the closing rule still frame it.
    expect(instructions).toContain('You are Ninjii');
    expect(instructions).toContain('Every fact you state must come from a tool result in this turn.');
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
