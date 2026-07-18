/**
 * webllm.ts tests (refs #246)
 *
 * `buildWebLlmMessages` / `parseWebLlmTurn` are pure and tested directly.
 * `WebLlmProvider.chat` is tested against a mocked `getLoadedEngine` (from
 * model-download.ts) returning a canned engine, so nothing here touches
 * WebGPU or the real `@mlc-ai/web-llm` package.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildWebLlmMessages, parseWebLlmTurn, WebLlmProvider } from '../providers/webllm';
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
    destructive: false,
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
const FEW_SHOT_COUNT = 4;

describe('buildWebLlmMessages', () => {
  it('opens with a system message combining `system` and the tool contract', () => {
    const tools = [fakeTool()];
    const messages = buildWebLlmMessages('You are zmNinjaNg assistant.', [], tools, GENERIC_MODEL_ID);

    expect(messages[0].role).toBe('system');
    const content = messages[0].content as string;
    expect(content).toContain('You are zmNinjaNg assistant.');
    expect(content).toContain('list_events');
    expect(content).toContain('List recent events for a monitor.');
    expect(content).toContain('"tool"');
    expect(content).toContain('"answer"');
  });

  it('tells the model it has no tools when the tool list is empty', () => {
    const messages = buildWebLlmMessages('system text', [], [], GENERIC_MODEL_ID);
    expect(messages[0].content).toContain('no tools available');
  });

  it('maps a user message to a user-role chat message', () => {
    const history: AssistantMessage[] = [{ role: 'user', text: 'Is the front door camera armed?' }];
    const messages = buildWebLlmMessages('sys', history, [], GENERIC_MODEL_ID);

    expect(messages[1 + FEW_SHOT_COUNT]).toEqual({ role: 'user', content: 'Is the front door camera armed?' });
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
      const realUserIndex = messages.findIndex((m) => m.content === 'real question');
      const exampleToolCallIndex = messages.findIndex(
        (m) => m.role === 'assistant' && m.content === '{"tool": "count_events", "input": {"interval": "1 day"}}',
      );
      expect(exampleToolCallIndex).toBeGreaterThan(0);
      expect(exampleToolCallIndex).toBeLessThan(realUserIndex);
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

    it('folds the example tool result into a user message starting "Tool result:" with the reminder sentence', () => {
      const messages = buildWebLlmMessages('sys', [], [], GENERIC_MODEL_ID);
      const resultMsg = messages.find(
        (m) => m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('Tool result:\n[{"monitor"'),
      );
      expect(resultMsg).toBeDefined();
      expect(resultMsg?.content).toContain(
        'Respond with ONLY a single JSON object: {"tool": "<name>", "input": {...}} to call another tool, ' +
          'or {"answer": "<text>"} to answer the user.',
      );
    });

    it('still places the real conversation after the fixed few-shot block regardless of tool list', () => {
      const history: AssistantMessage[] = [{ role: 'user', text: 'How many events on Garage today?' }];
      const messages = buildWebLlmMessages('sys', history, [fakeTool()], GENERIC_MODEL_ID);

      expect(messages[messages.length - 1]).toEqual({
        role: 'user',
        content: 'How many events on Garage today?',
      });
    });
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

  it('falls back gracefully on malformed JSON instead of throwing', () => {
    expect(() => parseWebLlmTurn('this is not json at all')).not.toThrow();
    const turn = parseWebLlmTurn('this is not json at all');
    expect(turn.toolCalls).toEqual([]);
    expect(turn.text).toBe('__i18n:assistant.parse_error');
  });

  it('sets `raw` to the original content on the parse-error path', () => {
    const turn = parseWebLlmTurn('this is not json at all');
    expect(turn.raw).toBe('this is not json at all');
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
    expect(turn).toEqual({ text: 'hi', toolCalls: [] });
  });

  it('strips a closed <think> block containing brace-y text so the real tool call after it is parsed, not the one inside', () => {
    const turn = parseWebLlmTurn('<think>plan {"tool":"x"}</think>\n{"tool":"list_monitors","input":{}}');
    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0].name).toBe('list_monitors');
    expect(turn.toolCalls[0].input).toEqual({});
  });

  it('falls back gracefully on an unclosed <think> block with no JSON after it', () => {
    const turn = parseWebLlmTurn('<think>still reasoning and never finished');
    expect(turn).toEqual({
      text: '__i18n:assistant.parse_error',
      toolCalls: [],
      raw: '<think>still reasoning and never finished',
    });
  });

  it('parses a plain {"answer"} reply with no <think> block at all', () => {
    const turn = parseWebLlmTurn('{"answer":"hi"}');
    expect(turn).toEqual({ text: 'hi', toolCalls: [] });
  });
});

describe('WebLlmProvider.chat', () => {
  beforeEach(() => {
    vi.mocked(getLoadedEngine).mockReset();
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

    expect(turn).toEqual({ text: 'It is armed.', toolCalls: [] });
    expect(getLoadedEngine).toHaveBeenCalledWith(ASSISTANT.defaultModelId);
    const call = create.mock.calls[0][0];
    expect(call).toEqual(
      expect.objectContaining({
        max_tokens: ASSISTANT.maxTokens,
      }),
    );
    // response_format crashes web-llm 0.2.84's XGrammar JSON-schema compiler
    // with a BindingError when no schema string is supplied; must never be sent.
    expect(call).not.toHaveProperty('response_format');
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
  });

  it('gives up with the parse-error apology, carrying raw, after every attempt degenerates', async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: '```' } }] });
    vi.mocked(getLoadedEngine).mockResolvedValue({ chat: { completions: { create } } } as never);

    const provider = new WebLlmProvider(ASSISTANT.defaultModelId);
    const turn = await provider.chat([{ role: 'user', text: 'hi' }], [], 'sys', new AbortController().signal);

    expect(turn.text).toBe('__i18n:assistant.parse_error');
    expect(turn.raw).toBe('```');
    expect(create).toHaveBeenCalledTimes(ASSISTANT.webllmMaxAttempts);
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
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: 'not json at all' } }] });
    vi.mocked(getLoadedEngine).mockResolvedValue({ chat: { completions: { create } } } as never);

    const provider = new WebLlmProvider(ASSISTANT.defaultModelId);
    const turn = await provider.chat([], [], 'sys', new AbortController().signal);

    expect(turn.text).toBe('__i18n:assistant.parse_error');
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('failed to parse'),
      Level.WARN,
      expect.objectContaining({ modelId: ASSISTANT.defaultModelId, content: 'not json at all' }),
    );
  });
});
