import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildOpenAiMessages, toOpenAiTools, parseOpenAiTurn, OpenAiProvider } from '../openai';
import type { AssistantMessage, ToolDefinition } from '../../types';
import { ASSISTANT } from '../../../zmninja-ng-constants';

const httpPostMock = vi.fn();
vi.mock('../../../http', () => ({
  httpPost: (url: string, body: unknown, options: unknown) => httpPostMock(url, body, options),
}));

const TOOL: ToolDefinition = {
  name: 'count_events',
  description: 'Counts events',
  schema: { type: 'object', properties: { interval: { type: 'string' } } },
  destructive: false,
  execute: vi.fn(),
};

describe('buildOpenAiMessages', () => {
  it('sends the system message as-is, with no appended tool contract', () => {
    const messages = buildOpenAiMessages('You are the assistant.', []);
    expect(messages).toEqual([{ role: 'system', content: 'You are the assistant.' }]);
  });

  it('maps a user message', () => {
    const history: AssistantMessage[] = [{ role: 'user', text: 'How many events today?' }];
    const messages = buildOpenAiMessages('sys', history);
    expect(messages[1]).toEqual({ role: 'user', content: 'How many events today?' });
  });

  it('maps an assistant tool-call turn to native tool_calls, not JSON text', () => {
    const history: AssistantMessage[] = [
      {
        role: 'assistant',
        toolCalls: [{ id: 'call_1', name: 'count_events', input: { interval: '1 day' } }],
      },
    ];
    const messages = buildOpenAiMessages('sys', history);
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'count_events', arguments: '{"interval":"1 day"}' } },
      ],
    });
  });

  it('maps a text-only assistant turn to a plain assistant message', () => {
    const history: AssistantMessage[] = [{ role: 'assistant', text: 'There were 12 events.', toolCalls: [] }];
    const messages = buildOpenAiMessages('sys', history);
    expect(messages[1]).toEqual({ role: 'assistant', content: 'There were 12 events.' });
  });

  it('maps tool results to one role:tool message per result, keyed by callId', () => {
    const history: AssistantMessage[] = [
      {
        role: 'tool',
        toolResults: [
          { callId: 'call_1', output: '{"count":12}' },
          { callId: 'call_2', output: '{"count":3}' },
        ],
      },
    ];
    const messages = buildOpenAiMessages('sys', history);
    expect(messages.slice(1)).toEqual([
      { role: 'tool', tool_call_id: 'call_1', content: '{"count":12}' },
      { role: 'tool', tool_call_id: 'call_2', content: '{"count":3}' },
    ]);
  });
});

describe('toOpenAiTools', () => {
  it('maps a ToolDefinition to the OpenAI function-tool shape', () => {
    expect(toOpenAiTools([TOOL])).toEqual([
      {
        type: 'function',
        function: {
          name: 'count_events',
          description: 'Counts events',
          parameters: TOOL.schema,
        },
      },
    ]);
  });

  it('returns an empty array for no tools', () => {
    expect(toOpenAiTools([])).toEqual([]);
  });
});

describe('parseOpenAiTurn', () => {
  it('maps tool_calls to ToolCall, parsing arguments JSON', () => {
    const turn = parseOpenAiTurn({
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'count_events', arguments: '{"interval":"1 day"}' } }],
    });
    expect(turn).toEqual({
      toolCalls: [{ id: 'call_1', name: 'count_events', input: { interval: '1 day' } }],
    });
  });

  it('maps content to text when there are no tool_calls', () => {
    const turn = parseOpenAiTurn({ content: 'There were 12 events.' });
    expect(turn).toEqual({ text: 'There were 12 events.', toolCalls: [] });
  });

  it('degrades bad tool-call arguments to an empty input instead of throwing', () => {
    const turn = parseOpenAiTurn({
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'count_events', arguments: 'not json' } }],
    });
    expect(turn).toEqual({ toolCalls: [{ id: 'call_1', name: 'count_events', input: {} }] });
  });

  it('degrades a missing message to the parse-error sentinel instead of throwing', () => {
    const turn = parseOpenAiTurn(undefined);
    expect(turn).toEqual({ text: '__i18n:assistant.parse_error', toolCalls: [] });
  });
});

describe('OpenAiProvider.chat', () => {
  beforeEach(() => {
    httpPostMock.mockReset();
  });

  it('posts to <baseUrl>/chat/completions with no Authorization header when apiKey is unset', async () => {
    httpPostMock.mockResolvedValue({
      data: { choices: [{ message: { content: 'Yes, the server is healthy.' } }] },
    });

    const provider = new OpenAiProvider({ baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:3b' });
    const controller = new AbortController();
    const turn = await provider.chat([{ role: 'user', text: 'Is the server healthy?' }], [TOOL], 'sys', controller.signal);

    expect(turn).toEqual({ text: 'Yes, the server is healthy.', toolCalls: [] });
    expect(httpPostMock).toHaveBeenCalledTimes(1);
    const [url, body, options] = httpPostMock.mock.calls[0] as [
      string,
      { model: string; tool_choice: string; stream: boolean; max_tokens: number; tools: unknown },
      { headers: Record<string, string>; signal: AbortSignal },
    ];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(body).toMatchObject({
      model: 'qwen2.5:3b',
      tool_choice: 'auto',
      stream: false,
      max_tokens: ASSISTANT.maxTokens,
    });
    expect(body.tools).toEqual(toolsToExpect());
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(options.headers.Authorization).toBeUndefined();
    expect(options.signal).toBe(controller.signal);
  });

  it('adds a Bearer Authorization header when apiKey is set', async () => {
    httpPostMock.mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              tool_calls: [
                { id: 'call_1', type: 'function', function: { name: 'count_events', arguments: '{"interval":"1 day"}' } },
              ],
            },
          },
        ],
      },
    });

    const provider = new OpenAiProvider({ baseUrl: 'http://ollama.local:11434/v1', model: 'qwen2.5:3b', apiKey: 'secret-key' });
    const controller = new AbortController();
    const turn = await provider.chat([{ role: 'user', text: 'How many events today?' }], [TOOL], 'sys', controller.signal);

    expect(turn).toEqual({
      toolCalls: [{ id: 'call_1', name: 'count_events', input: { interval: '1 day' } }],
    });
    const [, , options] = httpPostMock.mock.calls[0] as [string, unknown, { headers: Record<string, string> }];
    expect(options.headers.Authorization).toBe('Bearer secret-key');
  });

  it('throws immediately on an already-aborted signal, without calling httpPost', async () => {
    const provider = new OpenAiProvider({ baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:3b' });
    const controller = new AbortController();
    controller.abort();

    await expect(provider.chat([], [], 'sys', controller.signal)).rejects.toThrow();
    expect(httpPostMock).not.toHaveBeenCalled();
  });

  function toolsToExpect() {
    return [{ type: 'function', function: { name: TOOL.name, description: TOOL.description, parameters: TOOL.schema } }];
  }
});
