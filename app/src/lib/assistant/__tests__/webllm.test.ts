/**
 * webllm.ts tests (refs #246)
 *
 * `buildWebLlmMessages` / `parseWebLlmTurn` are pure and tested directly.
 * `WebLlmProvider.chat` is tested against a mocked `getLoadedEngine` (from
 * model-download.ts) returning a canned engine, so nothing here touches
 * WebGPU or the real `@mlc-ai/web-llm` package.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildWebLlmMessages, parseWebLlmTurn, WebLlmProvider, resetGrammarUsableForTests } from '../providers/webllm';
import type { AssistantMessage, ToolDefinition } from '../types';
import { ASSISTANT } from '../../zmninja-ng-constants';
import { readOnlyTools } from '../tools-readonly';

vi.mock('../model-download', () => ({
  getLoadedEngine: vi.fn(),
}));

import { getLoadedEngine } from '../model-download';

function fakeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'list_events',
    description: 'List recent events for a monitor.',
    schema: { type: 'object', properties: { monitorId: { type: 'string' } } },
    execute: vi.fn(),
    ...overrides,
  };
}

// Non-Qwen model id used throughout, so these tests aren't coupled to the
// `/no_think` behavior covered separately below.
const GENERIC_MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';

// buildWebLlmMessages inserts a fixed block of few-shot example turns right
// after the system message (see buildFewShotExamples in providers/webllm.ts).
// Tests below that inspect the real conversation must skip past that block;
// FEW_SHOT_COUNT is the number of messages it contributes.
const FEW_SHOT_COUNT = 6;

describe('buildWebLlmMessages', () => {
  it('opens with a system message combining `system` and the tool catalog', () => {
    const tools = [fakeTool()];
    const messages = buildWebLlmMessages('You are zmNinjaNg assistant.', [], tools, GENERIC_MODEL_ID);

    expect(messages[0].role).toBe('system');
    const content = messages[0].content as string;
    expect(content).toContain('You are zmNinjaNg assistant.');
    expect(content).toContain('list_events');
    expect(content).toContain('List recent events for a monitor.');
  });

  // The output contract sits at the generation point, not the system message:
  // a small model weights the last tokens it read far more heavily, and the
  // system message is thousands of tokens away by then.
  it('puts the output contract on the last message, not the system message', () => {
    const history: AssistantMessage[] = [{ role: 'user', text: 'How many events?' }];
    const messages = buildWebLlmMessages('sys', history, [fakeTool()], GENERIC_MODEL_ID);

    expect(messages[0].content).not.toContain('"answer": "<your reply>"');
    const last = messages[messages.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toContain('How many events?');
    expect(last.content).toContain('"tool"');
    expect(last.content).toContain('"answer"');
  });

  // A compact signature line, not `JSON.stringify(tool.schema)`: the raw schema
  // dump for the whole registry cost roughly a thousand tokens per turn.
  it('renders each tool as a compact signature instead of a raw JSON schema dump', () => {
    const tool = fakeTool({
      schema: {
        type: 'object',
        properties: { monitorId: { type: 'string' }, range: { enum: ['today', 'yesterday'] } },
        required: ['monitorId'],
      },
    });
    const content = buildWebLlmMessages('sys', [], [tool], GENERIC_MODEL_ID)[0].content as string;

    expect(content).toContain('list_events(monitorId: string, range?: today|yesterday)');
    expect(content).not.toContain('additionalProperties');
    expect(content).not.toContain('"type":"object"');
  });

  it('tells the model it has no tools when the tool list is empty', () => {
    const messages = buildWebLlmMessages('system text', [], [], GENERIC_MODEL_ID);
    expect(messages[0].content).toContain('no tools available');
  });

  it('maps a user message to a user-role chat message', () => {
    const history: AssistantMessage[] = [{ role: 'user', text: 'Is the front door camera armed?' }];
    const messages = buildWebLlmMessages('sys', history, [], GENERIC_MODEL_ID);

    expect(messages[1 + FEW_SHOT_COUNT].role).toBe('user');
    expect(messages[1 + FEW_SHOT_COUNT].content).toContain('Is the front door camera armed?');
  });

  it('re-serializes a past assistant tool call as {"tool","input"} JSON', () => {
    const history: AssistantMessage[] = [
      { role: 'assistant', toolCalls: [{ id: 'call-1', name: 'list_monitors', input: { limit: 5 } }] },
    ];
    const messages = buildWebLlmMessages('sys', history, [], GENERIC_MODEL_ID);

    const msg = messages[1 + FEW_SHOT_COUNT];
    expect(msg.role).toBe('assistant');
    expect(JSON.parse(msg.content as string)).toEqual({ tool: 'list_monitors', input: { limit: 5 } });
  });

  it('re-serializes a past assistant text-only turn as {"answer"} JSON', () => {
    const history: AssistantMessage[] = [{ role: 'assistant', text: 'The front door camera is armed.', toolCalls: [] }];
    const messages = buildWebLlmMessages('sys', history, [], GENERIC_MODEL_ID);

    expect(JSON.parse(messages[1 + FEW_SHOT_COUNT].content as string)).toEqual({
      answer: 'The front door camera is armed.',
    });
  });

  it('folds tool results into a user message instead of an orphan tool-role message', () => {
    // web-llm's chat template rejects a `role: 'tool'` message with no
    // matching native `tool_calls` entry (this adapter drives tool-calling
    // through the prompt contract, never web-llm's native tools/tool_calls).
    const history: AssistantMessage[] = [
      { role: 'tool', toolResults: [{ callId: 'call-1', output: '3 events found' }] },
    ];
    const messages = buildWebLlmMessages('sys', history, [], GENERIC_MODEL_ID);

    expect(messages.some((m) => m.role === 'tool')).toBe(false);
    expect(messages[1 + FEW_SHOT_COUNT].role).toBe('user');
    expect(messages[1 + FEW_SHOT_COUNT].content).toContain('3 events found');
  });

  it('appends the /no_think directive to the system message for a Qwen3 model id', () => {
    const messages = buildWebLlmMessages('sys', [], [], 'Qwen3-1.7B-q4f16_1-MLC');
    expect(messages[0].content).toContain('/no_think');
  });

  it('matches "Qwen3" case-insensitively', () => {
    const messages = buildWebLlmMessages('sys', [], [], 'qwen3-tiny-test');
    expect(messages[0].content).toContain('/no_think');
  });

  it('does not append /no_think for a non-Qwen3 model id', () => {
    const messages = buildWebLlmMessages('sys', [], [], GENERIC_MODEL_ID);
    expect(messages[0].content).not.toContain('/no_think');
  });

  describe('few-shot examples', () => {
    it('inserts the few-shot block immediately after the system message and before real history', () => {
      const history: AssistantMessage[] = [{ role: 'user', text: 'real question' }];
      const messages = buildWebLlmMessages('sys', history, [], GENERIC_MODEL_ID);

      expect(messages).toHaveLength(1 + FEW_SHOT_COUNT + 1);
      expect(messages[0].role).toBe('system');
      // The example assistant tool call must appear before the real user turn.
      const realUserIndex = messages.findIndex((m) => typeof m.content === 'string' && m.content.startsWith('real question'));
      const exampleToolCallIndex = messages.findIndex(
        (m) => m.role === 'assistant' && m.content === '{"tool": "count_events", "input": {"interval": "1 day"}}',
      );
      expect(exampleToolCallIndex).toBeGreaterThan(0);
      expect(exampleToolCallIndex).toBeLessThan(realUserIndex);
    });

    // The example data used plausible names ("Front Door", "Garage") and
    // llama3.2 answered a real question with those names and their counts,
    // having called no tool at all. Example data must be unmistakably fake.
    it('never puts a plausible monitor name or count in the example data', () => {
      const messages = buildWebLlmMessages('sys', [], [], GENERIC_MODEL_ID);
      const text = messages.map((m) => String(m.content ?? '')).join('\n');

      for (const plausible of ['Front Door', 'Garage', 'Driveway', 'Back Yard', 'Backyard']) {
        expect(text).not.toContain(plausible);
      }
      // And the block says outright that its own data is not real, so a model
      // that does echo it has been told why not to.
      expect(text).toContain('FORMAT EXAMPLE');
      expect(text).toContain('not real');
    });

    it('demonstrates count_events with no monitorId for an all-monitors summary question', () => {
      const messages = buildWebLlmMessages('sys', [], [], GENERIC_MODEL_ID);
      expect(messages).toContainEqual({
        role: 'assistant',
        content: '{"tool": "count_events", "input": {"interval": "1 day"}}',
      });
    });

    it('uses only tool names present in the read-only tools registry', () => {
      const toolNames = readOnlyTools.map((t) => t.name);
      const messages = buildWebLlmMessages('sys', [], [], GENERIC_MODEL_ID);

      const exampleToolNames = messages
        .filter((m) => m.role === 'assistant')
        .map((m) => {
          try {
            return JSON.parse(m.content as string).tool as string | undefined;
          } catch {
            return undefined;
          }
        })
        .filter((name): name is string => Boolean(name));

      expect(exampleToolNames).toContain('count_events');
      for (const name of exampleToolNames) {
        expect(toolNames).toContain(name);
      }
    });

    it('folds the example tool result into a user message starting "Tool result:"', () => {
      const messages = buildWebLlmMessages('sys', [], [], GENERIC_MODEL_ID);
      const resultMsg = messages.find(
        (m) => m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('Tool result:\n[{"monitor"'),
      );
      expect(resultMsg).toBeDefined();
    });

    // Only the final message carries the contract; restating it on every
    // intermediate tool result spent tokens on a rule the model had followed.
    it('does not repeat the output contract on intermediate tool results', () => {
      const history: AssistantMessage[] = [
        { role: 'tool', toolResults: [{ callId: 'c1', output: '3 events found' }] },
        { role: 'assistant', toolCalls: [{ id: 'c2', name: 'get_event', input: {} }] },
        { role: 'tool', toolResults: [{ callId: 'c2', output: 'event detail' }] },
      ];
      const messages = buildWebLlmMessages('sys', history, [], GENERIC_MODEL_ID);

      const firstResult = messages.find((m) => typeof m.content === 'string' && m.content.includes('3 events found'));
      expect(firstResult?.content).not.toContain('"answer": "<your reply>"');
      expect(messages[messages.length - 1].content).toContain('"answer": "<your reply>"');
    });

    it('still places the real conversation after the fixed few-shot block regardless of tool list', () => {
      const history: AssistantMessage[] = [{ role: 'user', text: 'How many events on Garage today?' }];
      const messages = buildWebLlmMessages('sys', history, [fakeTool()], GENERIC_MODEL_ID);

      const last = messages[messages.length - 1];
      expect(last.role).toBe('user');
      expect(last.content).toContain('How many events on Garage today?');
    });
  });
});

describe('tool catalog signatures', () => {
  // The envelope paths read this compressed catalog instead of the schemas, so
  // a multi-type argument has to survive the compression: showing "string" for
  // objectType would contradict the system prompt asking for a list.
  it('shows every type a multi-type argument accepts', () => {
    const messages = buildWebLlmMessages('sys', [], readOnlyTools, GENERIC_MODEL_ID);
    const system = String(messages[0].content ?? '');
    expect(system).toContain('objectType?: string|string[]');
    expect(system).toContain('eventIds?: string[]');
  });
});

describe('parseWebLlmTurn', () => {
  it('parses a {"tool","input"} response into one ToolCall', () => {
    const turn = parseWebLlmTurn('{"tool": "list_monitors", "input": {"limit": 5}}');

    expect(turn.text).toBeUndefined();
    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0].name).toBe('list_monitors');
    expect(turn.toolCalls[0].input).toEqual({ limit: 5 });
    expect(typeof turn.toolCalls[0].id).toBe('string');
    expect(turn.toolCalls[0].id.length).toBeGreaterThan(0);
  });

  it('defaults input to {} when the tool shape omits it', () => {
    const turn = parseWebLlmTurn('{"tool": "list_monitors"}');
    expect(turn.toolCalls[0].input).toEqual({});
  });

  it('parses a {"answer"} response into a text-only turn', () => {
    const turn = parseWebLlmTurn('{"answer": "The front door camera is armed."}');
    expect(turn).toEqual({ text: 'The front door camera is armed.', toolCalls: [] });
  });

  it('strips a markdown JSON fence before parsing', () => {
    const turn = parseWebLlmTurn('```json\n{"answer": "ok"}\n```');
    expect(turn).toEqual({ text: 'ok', toolCalls: [] });
  });

  // A reply with no brace anywhere never attempted the envelope: the model
  // judged that this question needed no tool and no structure. Rejecting it
  // pressured the retry into inventing a tool call (a greeting once fetched
  // every camera), so it is taken at face value instead.
  it('takes a brace-free reply as the answer rather than failing', () => {
    const turn = parseWebLlmTurn('Hello! How can I help you today?');
    expect(turn).toEqual({ text: 'Hello! How can I help you today?', toolCalls: [] });
  });

  it('takes a brace-free reply that followed a think block as the answer', () => {
    const turn = parseWebLlmTurn('The user greeted me, no tool needed.\n</think>\n\nHello! How can I help you today?\n');
    expect(turn).toMatchObject({ text: 'Hello! How can I help you today?', toolCalls: [] });
  });

  // The reasoning is stripped from the answer but kept, so the panel can show
  // what the model was doing during a turn that makes several round trips.
  it('keeps the reasoning separately from the answer', () => {
    const turn = parseWebLlmTurn('The user greeted me, no tool needed.\n</think>\n\nHello!\n');
    expect(turn.reasoning).toBe('The user greeted me, no tool needed.');
    expect(turn.text).toBe('Hello!');
  });

  it('reports no reasoning for a reply that had no think block', () => {
    expect(parseWebLlmTurn('{"answer":"hi"}').reasoning).toBeUndefined();
  });

  // A brace means the model was reaching for the contract and got it wrong,
  // which IS worth re-rolling.
  it('still fails on a botched envelope, so the retry can re-roll it', () => {
    expect(() => parseWebLlmTurn('{"unclosed": ')).not.toThrow();
    const turn = parseWebLlmTurn('{"unclosed": ');
    expect(turn.toolCalls).toEqual([]);
    expect(turn.text).toBe('__i18n:assistant.parse_error');
  });

  it('sets `raw` to the original content on the parse-error path', () => {
    const turn = parseWebLlmTurn('{"unclosed": ');
    expect(turn.raw).toBe('{"unclosed": ');
  });

  it('fails on output with no letters at all, so a degenerate reply is re-rolled', () => {
    expect(parseWebLlmTurn('```').text).toBe('__i18n:assistant.parse_error');
    expect(parseWebLlmTurn('   ').text).toBe('__i18n:assistant.parse_error');
  });

  it('does not set `raw` on a successful parse', () => {
    const turn = parseWebLlmTurn('{"answer": "hi"}');
    expect(turn.raw).toBeUndefined();
  });

  it('falls back gracefully on well-formed JSON that matches neither shape', () => {
    const turn = parseWebLlmTurn('{"foo": "bar"}');
    expect(turn).toEqual({ text: '__i18n:assistant.parse_error', toolCalls: [], raw: '{"foo": "bar"}' });
  });

  it('recovers a {"answer"} object embedded in prose before it', () => {
    const turn = parseWebLlmTurn('Sure: {"answer":"hi"}');
    expect(turn).toEqual({ text: 'hi', toolCalls: [] });
  });

  it('recovers a {"tool","input"} object embedded in prose on both sides', () => {
    const turn = parseWebLlmTurn('Here you go {"tool":"list_monitors","input":{}} thanks');
    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0].name).toBe('list_monitors');
    expect(turn.toolCalls[0].input).toEqual({});
  });

  it('falls back gracefully when even the embedded-object recovery finds no valid JSON', () => {
    const turn = parseWebLlmTurn('Sure, here you go: { this is not valid json');
    expect(turn).toEqual({
      text: '__i18n:assistant.parse_error',
      toolCalls: [],
      raw: 'Sure, here you go: { this is not valid json',
    });
  });

  it('strips a closed <think> block before parsing a {"answer"} reply', () => {
    const turn = parseWebLlmTurn('<think>reasoning here</think>{"answer":"hi"}');
    expect(turn).toMatchObject({ text: 'hi', toolCalls: [] });
  });

  it('strips a closed <think> block containing brace-y text so the real tool call after it is parsed, not the one inside', () => {
    const turn = parseWebLlmTurn('<think>plan {"tool":"x"}</think>\n{"tool":"list_monitors","input":{}}');
    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0].name).toBe('list_monitors');
    expect(turn.toolCalls[0].input).toEqual({});
  });

  it('falls back gracefully on an unclosed <think> block with no JSON after it', () => {
    const turn = parseWebLlmTurn('<think>still reasoning and never finished');
    expect(turn).toMatchObject({
      text: '__i18n:assistant.parse_error',
      toolCalls: [],
      raw: '<think>still reasoning and never finished',
    });
  });

  it('parses a plain {"answer"} reply with no <think> block at all', () => {
    const turn = parseWebLlmTurn('{"answer":"hi"}');
    expect(turn).toEqual({ text: 'hi', toolCalls: [] });
  });

  // Some reasoning models emit an UNBALANCED think block: the chat template puts
  // the opening <think> into the generation prompt, so the model's output
  // starts mid-thought and carries only the closing tag. Verbatim from a real
  // on-device turn (refs #246).
  it('strips a closing </think> that has no opening tag, and ignores brace-y text before it', () => {
    const turn = parseWebLlmTurn(
      'The user wants me to summarize their day. According to the instructions, for a daily summary, ' +
        'I should first call list_events with {"range":"today"} to get the events for today.\n</think>\n\n' +
        '{"tool": "list_events", "input": {"range": "today"}}\n',
    );

    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0].name).toBe('list_events');
    expect(turn.toolCalls[0].input).toEqual({ range: 'today' });
  });

  // Even with the think block gone, the first balanced object in a reply can
  // be a fragment the model quoted while planning. Take the first candidate
  // that matches the contract, not the first that merely parses.
  it('skips a leading brace pair that matches neither contract shape', () => {
    const turn = parseWebLlmTurn('I should call list_events with {"range":"today"}: {"tool":"list_events","input":{}}');

    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0].name).toBe('list_events');
  });

  it('still fails when no candidate object matches the contract', () => {
    const turn = parseWebLlmTurn('reasoning about {"range":"today"} and {"foo":"bar"}');
    expect(turn.text).toBe('__i18n:assistant.parse_error');
  });

  it('recovers a duplicate quote before the final brace', () => {
    const turn = parseWebLlmTurn('{"answer":"Hello.""}');
    expect(turn).toEqual({ text: 'Hello.', toolCalls: [] });
  });

  // Observed on gemma-2-2b once a tool result was in the history: it wrapped
  // the call it had already made in the answer shape without escaping the
  // inner quotes, so nothing parsed and three attempts died the same way.
  it('recovers a tool call nested in an answer with unescaped quotes', () => {
    const turn = parseWebLlmTurn('{"answer": "{"tool": "list_events", "input": {"range": "today"}}"}');

    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0].name).toBe('list_events');
    expect(turn.toolCalls[0].input).toEqual({ range: 'today' });
  });

  it('recovers a nested tool call inside a fenced answer', () => {
    const turn = parseWebLlmTurn('{"answer": "```json\\n{"tool": "count_events", "input": {}}\\n```"}');

    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0].name).toBe('count_events');
  });

  it('recovers a nested tool call whose quotes were escaped correctly', () => {
    const turn = parseWebLlmTurn(JSON.stringify({ answer: '{"tool":"list_monitors","input":{}}' }));

    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0].name).toBe('list_monitors');
  });

  // The unwrapping above must not swallow an answer that merely mentions the
  // envelope, which parses as a well-formed answer before any of it runs.
  it('keeps an answer that quotes an envelope as prose', () => {
    const turn = parseWebLlmTurn(JSON.stringify({ answer: 'Call {"tool": "list_events"} to see them.' }));

    expect(turn.toolCalls).toHaveLength(0);
    expect(turn.text).toBe('Call {"tool": "list_events"} to see them.');
  });
});

describe('WebLlmProvider.chat', () => {
  beforeEach(() => {
    vi.mocked(getLoadedEngine).mockReset();
    // The grammar-fallback flag is module state; a test that flips it must not
    // leak into the next.
    resetGrammarUsableForTests();
  });

  it('throws AbortError immediately when the signal is already aborted, without loading the engine', async () => {
    const provider = new WebLlmProvider(ASSISTANT.defaultModelId);
    const controller = new AbortController();
    controller.abort();

    await expect(provider.chat([], [], 'sys', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(getLoadedEngine).not.toHaveBeenCalled();
  });

  it('returns a text-only turn for a canned {"answer"} completion', async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: '{"answer": "It is armed."}' } }] });
    vi.mocked(getLoadedEngine).mockResolvedValue({ chat: { completions: { create } } } as never);

    const provider = new WebLlmProvider(ASSISTANT.defaultModelId);
    const turn = await provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal);

    expect(turn).toMatchObject({ text: 'It is armed.', toolCalls: [] });
    expect(getLoadedEngine).toHaveBeenCalledWith(ASSISTANT.defaultModelId);
    const call = create.mock.calls[0][0];
    expect(call).toEqual(
      expect.objectContaining({
        max_tokens: ASSISTANT.maxTokens,
      }),
    );
    // Constrained to the envelope schema. The schema STRING is load-bearing:
    // web-llm 0.2.84's XGrammar compiler throws a WASM BindingError when
    // json_object mode is requested with no schema, so json_object must never
    // be sent bare.
    expect(call.response_format).toEqual({ type: 'json_object', schema: expect.stringContaining('"tool"') });
  });

  // The XGrammar compiler has crashed before (see the module header), so the
  // constraint must be belt-and-braces: an engine that rejects it degrades to
  // prompt + parser for the session instead of failing every turn.
  it('falls back to unconstrained generation when the engine rejects the schema', async () => {
    const create = vi
      .fn()
      .mockImplementation((req: { response_format?: unknown }) => {
        if (req.response_format) throw new Error('BindingError: Cannot pass non-string to std::string');
        return Promise.resolve({ choices: [{ message: { content: '{"answer": "ok"}' } }] });
      });
    vi.mocked(getLoadedEngine).mockResolvedValue({ chat: { completions: { create } } } as never);

    const provider = new WebLlmProvider(ASSISTANT.defaultModelId);
    const turn = await provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal);
    expect(turn.text).toBe('ok');

    // And the rejection is remembered: the next turn goes straight to
    // unconstrained instead of paying the crash again.
    const callsBefore = create.mock.calls.length;
    await provider.chat([{ role: 'user', text: 'hi again' }], [], 'sys', new AbortController().signal);
    const newCalls = create.mock.calls.slice(callsBefore) as Array<[{ response_format?: unknown }]>;
    expect(newCalls.every(([req]) => req.response_format === undefined)).toBe(true);
  });

  // The model produced just "```" (a bare code fence, nothing inside) on a real
  // Gemma 2B turn. Sampling is non-deterministic, so a retry recovers (refs #246).
  it('retries a degenerate reply and returns the recovered answer', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: '```' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"answer": "Two people came."}' } }] });
    vi.mocked(getLoadedEngine).mockResolvedValue({ chat: { completions: { create } } } as never);

    const provider = new WebLlmProvider(ASSISTANT.defaultModelId);
    const turn = await provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal);

    expect(turn.text).toBe('Two people came.');
    expect(create).toHaveBeenCalledTimes(2);

    // The retry is a self-repair, not a blind re-roll: the failed reply plus a
    // correction restating the contract are appended, and the greedy
    // temperature is kept (only the FINAL attempt raises it).
    const retryCall = create.mock.calls[1][0] as { temperature: number; messages: Array<{ role: string; content: string }> };
    expect(retryCall.messages.at(-2)).toMatchObject({ role: 'assistant', content: '```' });
    expect(retryCall.messages.at(-1)?.content).toContain('not one valid JSON object');
    expect(retryCall.temperature).toBe(ASSISTANT.assistantTemperature);
  });

  it('gives up with the parse-error apology, carrying raw, after every attempt degenerates', async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: '```' } }] });
    vi.mocked(getLoadedEngine).mockResolvedValue({ chat: { completions: { create } } } as never);

    const provider = new WebLlmProvider(ASSISTANT.defaultModelId);
    const turn = await provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal);

    expect(turn.text).toBe('__i18n:assistant.parse_error');
    expect(turn.raw).toBe('```');
    expect(create).toHaveBeenCalledTimes(ASSISTANT.maxParseAttempts);
  });

  // The Abort button used to be cosmetic on this backend: the loop only
  // checked the signal BETWEEN attempts, so an in-flight generation ran to
  // completion regardless.
  it('interrupts an in-flight generation on abort and throws AbortError', async () => {
    const controller = new AbortController();
    const interruptGenerate = vi.fn();
    const create = vi.fn().mockImplementation(() => {
      // Abort while the request is "in flight"; the wired listener should
      // interrupt the engine, and the resolved partial reply must be discarded.
      controller.abort();
      return Promise.resolve({ choices: [{ message: { content: '{"answer": "partial' } }] });
    });
    vi.mocked(getLoadedEngine).mockResolvedValue({ chat: { completions: { create } }, interruptGenerate } as never);

    const provider = new WebLlmProvider(ASSISTANT.defaultModelId);
    await expect(
      provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(interruptGenerate).toHaveBeenCalled();
  });

  it('does not retry a valid answer', async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: '{"answer": "ok"}' } }] });
    vi.mocked(getLoadedEngine).mockResolvedValue({ chat: { completions: { create } } } as never);
    const provider = new WebLlmProvider(ASSISTANT.defaultModelId);
    await provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('returns a ToolCall turn for a canned {"tool","input"} completion', async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '{"tool": "list_monitors", "input": {}}' } }],
    });
    vi.mocked(getLoadedEngine).mockResolvedValue({ chat: { completions: { create } } } as never);

    const provider = new WebLlmProvider(ASSISTANT.defaultModelId);
    const turn = await provider.chat([], [fakeTool()], 'sys', new AbortController().signal);

    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0].name).toBe('list_monitors');
  });

  it('logs the raw response at DEBUG so a parse failure is diagnosable', async () => {
    const { log, LogLevel: Level } = await import('../../logger');
    const spy = vi.spyOn(log, 'assistant');
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: '{"answer": "hi"}' } }] });
    vi.mocked(getLoadedEngine).mockResolvedValue({ chat: { completions: { create } } } as never);

    const provider = new WebLlmProvider(ASSISTANT.defaultModelId);
    await provider.chat([], [], 'sys', new AbortController().signal);

    expect(spy).toHaveBeenCalledWith(
      'WebLLM raw response',
      Level.DEBUG,
      expect.objectContaining({ modelId: ASSISTANT.defaultModelId, content: '{"answer": "hi"}' }),
    );
  });

  it('logs at WARN with the raw content when the response fails to parse', async () => {
    const { log, LogLevel: Level } = await import('../../logger');
    const spy = vi.spyOn(log, 'assistant');
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: '{"unclosed": ' } }] });
    vi.mocked(getLoadedEngine).mockResolvedValue({ chat: { completions: { create } } } as never);

    const provider = new WebLlmProvider(ASSISTANT.defaultModelId);
    const turn = await provider.chat([], [], 'sys', new AbortController().signal);

    expect(turn.text).toBe('__i18n:assistant.parse_error');
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('failed to parse'),
      Level.WARN,
      expect.objectContaining({ modelId: ASSISTANT.defaultModelId, content: '{"unclosed": ' }),
    );
  });
});
