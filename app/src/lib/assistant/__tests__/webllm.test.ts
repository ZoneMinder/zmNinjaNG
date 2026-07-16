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

describe('buildWebLlmMessages', () => {
  it('opens with a system message combining `system` and the tool contract', () => {
    const tools = [fakeTool()];
    const messages = buildWebLlmMessages('You are zmNinjaNg assistant.', [], tools);

    expect(messages[0].role).toBe('system');
    const content = messages[0].content as string;
    expect(content).toContain('You are zmNinjaNg assistant.');
    expect(content).toContain('list_events');
    expect(content).toContain('List recent events for a monitor.');
    expect(content).toContain('"tool"');
    expect(content).toContain('"answer"');
  });

  it('tells the model it has no tools when the tool list is empty', () => {
    const messages = buildWebLlmMessages('system text', [], []);
    expect(messages[0].content).toContain('no tools available');
  });

  it('maps a user message to a user-role chat message', () => {
    const history: AssistantMessage[] = [{ role: 'user', text: 'Is the front door camera armed?' }];
    const messages = buildWebLlmMessages('sys', history, []);

    expect(messages[1]).toEqual({ role: 'user', content: 'Is the front door camera armed?' });
  });

  it('re-serializes a past assistant tool call as {"tool","input"} JSON', () => {
    const history: AssistantMessage[] = [
      { role: 'assistant', toolCalls: [{ id: 'call-1', name: 'list_monitors', input: { limit: 5 } }] },
    ];
    const messages = buildWebLlmMessages('sys', history, []);

    expect(messages[1].role).toBe('assistant');
    expect(JSON.parse(messages[1].content as string)).toEqual({ tool: 'list_monitors', input: { limit: 5 } });
  });

  it('re-serializes a past assistant text-only turn as {"answer"} JSON', () => {
    const history: AssistantMessage[] = [{ role: 'assistant', text: 'The front door camera is armed.', toolCalls: [] }];
    const messages = buildWebLlmMessages('sys', history, []);

    expect(JSON.parse(messages[1].content as string)).toEqual({ answer: 'The front door camera is armed.' });
  });

  it('maps tool results to tool-role messages carrying tool_call_id', () => {
    const history: AssistantMessage[] = [
      { role: 'tool', toolResults: [{ callId: 'call-1', output: '3 events found' }] },
    ];
    const messages = buildWebLlmMessages('sys', history, []);

    expect(messages[1]).toEqual({ role: 'tool', content: '3 events found', tool_call_id: 'call-1' });
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

  it('falls back gracefully on well-formed JSON that matches neither shape', () => {
    const turn = parseWebLlmTurn('{"foo": "bar"}');
    expect(turn).toEqual({ text: '__i18n:assistant.parse_error', toolCalls: [] });
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
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: { type: 'json_object' },
        max_tokens: ASSISTANT.maxTokens,
      }),
    );
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
});
