import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildOpenAiMessages, toOpenAiTools, parseOpenAiTurn, OpenAiProvider, listOpenAiModels, probeToolSupport, toolSupportFromError, suggestOllamaBaseUrl, resetNativeToolServersForTests, resetContextWindowsForTests, warmOllamaModel, resetWarmedModelsForTests } from '../openai';
import type { AssistantMessage, ToolDefinition } from '../../types';
import { ASSISTANT } from '../../../zmninja-ng-constants';

const httpPostMock = vi.fn();
const httpGetMock = vi.fn();
vi.mock('../../../http', () => ({
  httpPost: (url: string, body: unknown, options: unknown) => httpPostMock(url, body, options),
  httpGet: (url: string, options: unknown) => httpGetMock(url, options),
}));

const TOOL: ToolDefinition = {
  name: 'count_events',
  description: 'Counts events',
  schema: { type: 'object', properties: { interval: { type: 'string' } } },
  execute: vi.fn(),
};

describe('buildOpenAiMessages', () => {
  it('adds a portable JSON fallback to the native tool contract', () => {
    const messages = buildOpenAiMessages('You are the assistant.', []);
    expect(messages[0]).toMatchObject({ role: 'system', content: expect.stringContaining('You are the assistant.') });
    expect(messages[0].content).toContain('If you cannot emit a native tool call');
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

  // Triage routes chat and refusal turns here with no tools. Telling the model
  // how to emit a tool call in that state is not merely useless: it did emit
  // one, `{"tool":"list_events",...}` as content, which the loop then had to
  // refuse. The on-device path has always said "no tools available" here.
  it('says there are no tools, instead of teaching a tool-call format, when there are none', () => {
    const messages = buildOpenAiMessages('sys', [], false);
    expect(messages[0].content).toContain('You have no tools available');
    expect(messages[0].content).not.toContain('If you cannot emit a native tool call');
  });

  it('keeps the portable fallback when tools are available', () => {
    expect(buildOpenAiMessages('sys', [], true)[0].content).toContain('If you cannot emit a native tool call');
  });

  // Once a server has emitted a native tool call, the fallback is dead weight
  // that invites `{"answer":...}` JSON as text; the prompt drops it.
  it('drops the portable fallback when told the server calls tools natively', () => {
    expect(buildOpenAiMessages('sys', [], true, false)[0].content).toBe('sys');
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

  it('accepts the portable JSON tool fallback from a server without native tools', () => {
    const turn = parseOpenAiTurn({ content: '{"tool":"count_events","input":{"interval":"1 day"}}' });
    expect(turn).toMatchObject({ toolCalls: [{ name: 'count_events', input: { interval: '1 day' } }] });
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

  // Measured against qwen3:30b-a3b through Ollama: a reasoning model that
  // spends the whole token budget thinking returns its chain of thought in a
  // separate `reasoning` field and leaves `content` empty. Rendered as-is that
  // was a blank message in the panel.
  it('degrades an empty answer to the parse-error sentinel rather than a blank message', () => {
    expect(parseOpenAiTurn({ content: '' })).toEqual({
      text: '__i18n:assistant.parse_error',
      toolCalls: [],
    });
    expect(parseOpenAiTurn({ content: '   \n ' })).toEqual({
      text: '__i18n:assistant.parse_error',
      toolCalls: [],
    });
  });
});

describe('probeToolSupport', () => {
  beforeEach(() => httpPostMock.mockReset());

  // A model's NAME says nothing: qwen3-coder scores full marks on this
  // assistant and qwen2.5-coder never calls a tool at all. Both failures are
  // one request away from being known, so they are asked about rather than
  // guessed from an allowlist that would rot.
  it('reports supported when the model actually calls the tool', async () => {
    httpPostMock.mockResolvedValue({
      data: { choices: [{ message: { tool_calls: [{ id: '1', type: 'function', function: { name: 'get_weather', arguments: '{}' } }] } }] },
    });

    await expect(probeToolSupport('http://localhost:11434/v1', 'gemma4')).resolves.toBe('supported');
  });

  // qwen2.5-coder: no error at all, just prose. The assistant would silently
  // never fetch anything.
  it('reports no-tool-call when the model answers in prose instead', async () => {
    httpPostMock.mockResolvedValue({ data: { choices: [{ message: { content: 'It is sunny in Paris.' } }] } });

    await expect(probeToolSupport('http://localhost:11434/v1', 'qwen2.5-coder')).resolves.toBe('no-tool-call');
  });

  // gemma2: Ollama rejects it outright, in as many words. The decision is
  // tested through `toolSupportFromError` rather than a rejected transport
  // mock, which left vitest holding the rejection and reporting it as an
  // unhandled error however the assertion was written.
  it('reads the server\'s own "does not support tools" as a verdict', () => {
    expect(toolSupportFromError(new Error('registry.ollama.ai/library/gemma2:9b does not support tools'))).toBe(
      'unsupported',
    );
  });

  // An unreachable server is not a verdict about the model: undefined means
  // the probe rethrows and the caller surfaces the real failure.
  it('does not blame the model for an unrelated failure', () => {
    expect(toolSupportFromError(new Error('Network request failed'))).toBeUndefined();
    expect(toolSupportFromError(new Error('401 Unauthorized'))).toBeUndefined();
  });
});

describe('OpenAiProvider.chat', () => {
  beforeEach(() => {
    httpPostMock.mockReset();
  });

  // Was single-shot while the on-device path re-rolled: one degenerate reply
  // here went straight to the user as the parse-error apology.
  it('retries an unusable reply instead of surfacing the apology on the first one', async () => {
    httpPostMock
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: '' } }] } })
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: 'All good.' } }] } });

    const provider = new OpenAiProvider({ baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' });
    const turn = await provider.chat([{ role: 'user', text: 'ok?' }], [TOOL], 'sys', new AbortController().signal);

    expect(httpPostMock).toHaveBeenCalledTimes(2);
    expect(turn.text).toBe('All good.');
  });

  it('gives up after the shared attempt cap rather than looping', async () => {
    httpPostMock.mockResolvedValue({ data: { choices: [{ message: { content: '' } }] } });

    const provider = new OpenAiProvider({ baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' });
    const turn = await provider.chat([{ role: 'user', text: 'ok?' }], [TOOL], 'sys', new AbortController().signal);

    expect(httpPostMock).toHaveBeenCalledTimes(ASSISTANT.maxParseAttempts);
    expect(turn.text).toBe('__i18n:assistant.parse_error');
  });

  // The panel's collapsible transcript renders whatever lands here, so this
  // pins the shape rather than the prose: backend/model identify which path
  // answered, and `sent` must carry the tool schemas, which on THIS backend
  // travel in `tools` rather than in the prompt.
  it('omits tools and tool_choice from the body when the turn has none', async () => {
    httpPostMock.mockResolvedValue({ data: { choices: [{ message: { content: 'Hello!' } }] } });

    const provider = new OpenAiProvider({ baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' });
    await provider.chat([{ role: 'user', text: 'hello' }], [], 'sys', new AbortController().signal);

    const body = httpPostMock.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('tool_choice');
  });

  // The panel offers "show model output" under the apology, but only when the
  // turn carries what failed. This path used to give an apology and nothing
  // to inspect.
  it('keeps the raw reply on a parse failure, so the panel can show it', async () => {
    httpPostMock.mockResolvedValue({ data: { choices: [{ message: { content: '' } }] } });

    const provider = new OpenAiProvider({ baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' });
    const turn = await provider.chat([{ role: 'user', text: 'q' }], [TOOL], 'sys', new AbortController().signal);

    expect(turn.text).toBe('__i18n:assistant.parse_error');
    expect(turn.raw).toBeTruthy();
  });

  it('captures the request and reply on the turn for the panel transcript', async () => {
    httpPostMock.mockResolvedValue({
      data: { choices: [{ message: { content: 'All good.' } }] },
    });

    const provider = new OpenAiProvider({ baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' });
    const turn = await provider.chat([{ role: 'user', text: 'ok?' }], [TOOL], 'sys', new AbortController().signal);

    expect(turn.exchange).toMatchObject({ backend: 'ollama', model: 'llama3.2' });
    expect(turn.exchange!.sent).toContain('count_events');
    expect(turn.exchange!.received).toContain('All good.');
    expect(turn.exchange!.ms).toBeGreaterThanOrEqual(0);
  });

  it('posts to <baseUrl>/chat/completions with no Authorization header when apiKey is unset', async () => {
    httpPostMock.mockResolvedValue({
      data: { choices: [{ message: { content: 'Yes, the server is healthy.' } }] },
    });

    const provider = new OpenAiProvider({ baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:3b' });
    const controller = new AbortController();
    const turn = await provider.chat([{ role: 'user', text: 'Is the server healthy?' }], [TOOL], 'sys', controller.signal);

    expect(turn).toMatchObject({ text: 'Yes, the server is healthy.', toolCalls: [] });
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
      // Not `maxTokens`: a remote reasoning model spends that budget thinking
      // before it writes any answer (see `ollamaMaxTokens`).
      max_tokens: ASSISTANT.ollamaMaxTokens,
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

    expect(turn).toMatchObject({
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

describe('listOpenAiModels', () => {
  beforeEach(() => {
    httpGetMock.mockReset();
  });

  it('parses {data:[{id}]} into a sorted, de-duplicated id list', async () => {
    httpGetMock.mockResolvedValue({
      data: { data: [{ id: 'qwen2.5:3b' }, { id: 'gemma2' }, { id: 'gemma2' }] },
    });

    const models = await listOpenAiModels('http://localhost:11434/v1');

    expect(models).toEqual(['gemma2', 'qwen2.5:3b']);
  });

  it('calls GET <baseUrl>/models with no Authorization header when apiKey is unset', async () => {
    httpGetMock.mockResolvedValue({ data: { data: [] } });

    await listOpenAiModels('http://localhost:11434/v1');

    expect(httpGetMock).toHaveBeenCalledTimes(1);
    const [url, options] = httpGetMock.mock.calls[0] as [string, { headers: Record<string, string>; timeoutMs: number }];
    expect(url).toBe('http://localhost:11434/v1/models');
    expect(options.headers.Authorization).toBeUndefined();
    expect(options.timeoutMs).toBe(ASSISTANT.requestTimeoutMs);
  });

  it('defaults to the full request timeout, but honors a shorter caller-supplied timeout (refs #246)', async () => {
    httpGetMock.mockResolvedValue({ data: { data: [] } });

    await listOpenAiModels('http://localhost:11434/v1', undefined, ASSISTANT.testConnectionTimeoutMs);

    const [, options] = httpGetMock.mock.calls[0] as [string, { timeoutMs: number }];
    expect(options.timeoutMs).toBe(ASSISTANT.testConnectionTimeoutMs);
    expect(ASSISTANT.testConnectionTimeoutMs).toBeLessThan(ASSISTANT.requestTimeoutMs);
  });

  it('adds a Bearer Authorization header when apiKey is set', async () => {
    httpGetMock.mockResolvedValue({ data: { data: [] } });

    await listOpenAiModels('http://localhost:11434/v1', 'secret-key');

    const [, options] = httpGetMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(options.headers.Authorization).toBe('Bearer secret-key');
  });

  it('returns [] when data is missing, without throwing', async () => {
    httpGetMock.mockResolvedValue({ data: {} });

    await expect(listOpenAiModels('http://localhost:11434/v1')).resolves.toEqual([]);
  });

  it('lets a rejected httpGet propagate to the caller', async () => {
    httpGetMock.mockRejectedValue(new Error('Network error'));

    await expect(listOpenAiModels('http://localhost:11434/v1')).rejects.toThrow('Network error');
  });
});

describe('suggestOllamaBaseUrl', () => {
  it('borrows the ZoneMinder host and adds the Ollama port', () => {
    expect(suggestOllamaBaseUrl('http://192.168.1.50/zm/api')).toBe('http://192.168.1.50:11434/v1');
  });

  it('keeps https when the portal uses it', () => {
    expect(suggestOllamaBaseUrl('https://zm.example.com/zm/api')).toBe(
      'https://zm.example.com:11434/v1',
    );
  });

  it('returns undefined for a missing or unparseable URL so the caller keeps its fallback', () => {
    expect(suggestOllamaBaseUrl(undefined)).toBeUndefined();
    expect(suggestOllamaBaseUrl('')).toBeUndefined();
    expect(suggestOllamaBaseUrl('not a url')).toBeUndefined();
  });
});

describe('probeToolSupport timeouts', () => {
  beforeEach(() => {
    httpPostMock.mockReset();
    httpGetMock.mockReset();
  });

  it('reports a timeout as its own verdict rather than blaming the model', async () => {
    // A cold model pays its load cost before the first token, so a slow probe
    // means "not loaded yet", not "cannot call tools".
    httpPostMock.mockRejectedValue(new Error('Native request timed out after 90000ms'));
    await expect(probeToolSupport('http://zm:11434/v1', 'gemma4')).resolves.toBe('timeout');
  });

  it('treats an aborted request as a timeout too', async () => {
    httpPostMock.mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));
    await expect(probeToolSupport('http://zm:11434/v1', 'gemma4')).resolves.toBe('timeout');
  });

  it('uses the model-probe budget, not the reachability one', async () => {
    httpPostMock.mockResolvedValue({ data: { choices: [{ message: { tool_calls: [{}] } }] } });
    await probeToolSupport('http://zm:11434/v1', 'gemma4');
    expect(httpPostMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ timeoutMs: ASSISTANT.modelProbeTimeoutMs }),
    );
    expect(ASSISTANT.modelProbeTimeoutMs).toBeGreaterThan(ASSISTANT.testConnectionTimeoutMs);
  });

  it('probes with the same token budget a real turn gets', async () => {
    // Regression: a probe-only cap of 64 truncated gemma4 before it emitted the
    // call (finish_reason 'length', no tool_calls), and the probe read that as
    // "never calls tools": a working model reported as broken.
    httpPostMock.mockResolvedValue({ data: { choices: [{ message: { tool_calls: [{}] } }] } });
    await probeToolSupport('http://zm:11434/v1', 'gemma4');
    expect(httpPostMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ max_tokens: ASSISTANT.ollamaMaxTokens }),
      expect.any(Object),
    );
  });

  it('does not claim a truncated answer proves the model cannot call tools', async () => {
    httpPostMock.mockResolvedValue({
      data: { choices: [{ finish_reason: 'length', message: { content: '' } }] },
    });
    // Still 'no-tool-call' (nothing came back), but the cap is logged so the
    // next person sees truncation rather than guessing at the model.
    await expect(probeToolSupport('http://zm:11434/v1', 'gemma4')).resolves.toBe('no-tool-call');
  });

  it('still rethrows errors that are neither a timeout nor a tool-support verdict', async () => {
    httpPostMock.mockRejectedValue(new Error('boom'));
    await expect(probeToolSupport('http://zm:11434/v1', 'gemma4')).rejects.toThrow('boom');
  });
});

describe('native tool-call memory', () => {
  beforeEach(() => {
    httpPostMock.mockReset();
    resetNativeToolServersForTests();
  });

  it('drops the portable fallback for a server that has emitted a native tool call', async () => {
    httpPostMock.mockResolvedValue({
      data: { choices: [{ message: { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'count_events', arguments: '{}' } }] } }] },
    });
    const p = new OpenAiProvider({ baseUrl: 'http://zm:11434/v1', model: 'llama3.2' });
    await p.chat([{ role: 'user', text: 'count today' }], [TOOL], 'sys', new AbortController().signal);
    const first = httpPostMock.mock.calls[0][1] as { messages: Array<{ content: string }> };
    expect(first.messages[0].content).toContain('If you cannot emit a native tool call');

    // A FRESH provider instance for the same server: AskPanel builds one per
    // turn, so the memory must live beyond the instance.
    const p2 = new OpenAiProvider({ baseUrl: 'http://zm:11434/v1', model: 'llama3.2' });
    await p2.chat([{ role: 'user', text: 'count today' }], [TOOL], 'sys', new AbortController().signal);
    const second = httpPostMock.mock.calls[1][1] as { messages: Array<{ content: string }> };
    expect(second.messages[0].content).not.toContain('If you cannot emit a native tool call');
  });
});

describe('context window discovery', () => {
  beforeEach(() => {
    httpPostMock.mockReset();
    httpGetMock.mockReset();
    resetContextWindowsForTests();
    resetNativeToolServersForTests();
  });

  it('learns num_ctx from /api/ps after a chat and serves it to later instances', async () => {
    httpPostMock.mockResolvedValue({ data: { choices: [{ message: { content: 'hi' } }] } });
    httpGetMock.mockResolvedValue({ data: { models: [{ model: 'llama3.2', context_length: 131072 }] } });

    const p = new OpenAiProvider({ baseUrl: 'http://zm:11434/v1', model: 'llama3.2' });
    expect(p.contextWindow).toBeUndefined();
    await p.chat([{ role: 'user', text: 'hello' }], [], 'sys', new AbortController().signal);
    await Promise.resolve();

    // The native endpoint, not the OpenAI-compatible one.
    expect(httpGetMock.mock.calls[0][0]).toBe('http://zm:11434/api/ps');
    // AskPanel builds a fresh provider each turn; the window must survive that.
    const p2 = new OpenAiProvider({ baseUrl: 'http://zm:11434/v1', model: 'llama3.2' });
    expect(p2.contextWindow).toBe(131072);
  });

  // reasoning_effort is Ollama-only: a genuine OpenAI server rejects it on
  // non-reasoning models, so it is sent only once /api/ps has confirmed the
  // server. Measured ~5x faster turns on thinking models, identical scores.
  it('sends reasoning_effort only after the server is confirmed Ollama', async () => {
    httpPostMock.mockResolvedValue({ data: { choices: [{ message: { content: 'hi' } }] } });
    httpGetMock.mockResolvedValue({ data: { models: [{ model: 'qwen3:8b', context_length: 40960 }] } });

    const p = new OpenAiProvider({ baseUrl: 'http://zm:11434/v1', model: 'qwen3:8b' });
    await p.chat([{ role: 'user', text: 'hello' }], [], 'sys', new AbortController().signal);
    expect(httpPostMock.mock.calls[0][1]).not.toHaveProperty('reasoning_effort');
    await Promise.resolve();

    const p2 = new OpenAiProvider({ baseUrl: 'http://zm:11434/v1', model: 'qwen3:8b' });
    await p2.chat([{ role: 'user', text: 'again' }], [], 'sys', new AbortController().signal);
    expect(httpPostMock.mock.calls[1][1]).toMatchObject({ reasoning_effort: ASSISTANT.ollamaReasoningEffort });
  });

  it('records a server without the endpoint and never asks again', async () => {
    httpPostMock.mockResolvedValue({ data: { choices: [{ message: { content: 'hi' } }] } });
    httpGetMock.mockRejectedValue(new Error('HTTP 404'));

    const p = new OpenAiProvider({ baseUrl: 'http://api.example/v1', model: 'gpt' });
    await p.chat([{ role: 'user', text: 'hello' }], [], 'sys', new AbortController().signal);
    await Promise.resolve();
    await p.chat([{ role: 'user', text: 'again' }], [], 'sys', new AbortController().signal);
    await Promise.resolve();

    expect(p.contextWindow).toBeUndefined();
    expect(httpGetMock).toHaveBeenCalledTimes(1);
  });
});

describe('warmOllamaModel', () => {
  beforeEach(() => {
    httpPostMock.mockReset();
    httpGetMock.mockReset();
    resetWarmedModelsForTests();
    resetContextWindowsForTests();
    resetNativeToolServersForTests();
  });

  it('loads the model via the native generate endpoint and confirms the server', async () => {
    httpPostMock.mockResolvedValue({ data: { done: true } });
    httpGetMock.mockResolvedValue({ data: { models: [{ model: 'qwen3:8b', context_length: 40960 }] } });

    const warmed = await warmOllamaModel({ baseUrl: 'http://zm:11434/v1', model: 'qwen3:8b' });
    expect(warmed).toBe(true);
    expect(httpPostMock.mock.calls[0][0]).toBe('http://zm:11434/api/generate');
    expect(httpPostMock.mock.calls[0][1]).toEqual({ model: 'qwen3:8b' });

    // The whole point: the FIRST chat after a warmup already runs confirmed,
    // with reasoning disabled and the context window known.
    httpPostMock.mockResolvedValue({ data: { choices: [{ message: { content: 'hi' } }] } });
    const p = new OpenAiProvider({ baseUrl: 'http://zm:11434/v1', model: 'qwen3:8b' });
    expect(p.contextWindow).toBe(40960);
    await p.chat([{ role: 'user', text: 'hello' }], [], 'sys', new AbortController().signal);
    expect(httpPostMock.mock.calls.at(-1)?.[1]).toMatchObject({ reasoning_effort: ASSISTANT.ollamaReasoningEffort });
  });

  it('issues one warmup per server and model for the session', async () => {
    httpPostMock.mockResolvedValue({ data: { done: true } });
    httpGetMock.mockResolvedValue({ data: { models: [] } });
    await warmOllamaModel({ baseUrl: 'http://zm:11434/v1', model: 'qwen3:8b' });
    await expect(warmOllamaModel({ baseUrl: 'http://zm:11434/v1', model: 'qwen3:8b' })).resolves.toBe(false);
    expect(httpPostMock).toHaveBeenCalledTimes(1);
  });

  it('never throws, and lets a later open retry after a failure', async () => {
    httpPostMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(warmOllamaModel({ baseUrl: 'http://down:11434/v1', model: 'qwen3:8b' })).resolves.toBe(false);

    httpPostMock.mockResolvedValue({ data: { done: true } });
    httpGetMock.mockResolvedValue({ data: { models: [] } });
    await expect(warmOllamaModel({ baseUrl: 'http://down:11434/v1', model: 'qwen3:8b' })).resolves.toBe(true);
  });
});

describe('constrained completion', () => {
  beforeEach(() => {
    httpPostMock.mockReset();
  });

  it('sends jsonSchema as response_format json_schema', async () => {
    httpPostMock.mockResolvedValue({ data: { choices: [{ message: { content: '{"kind":"CHAT"}' } }] } });
    const p = new OpenAiProvider({ baseUrl: 'http://zm:11434/v1', model: 'llama3.2' });
    const schema = { type: 'object', properties: { kind: { type: 'string' } } };
    const result = await p.complete('sys', 'hello', new AbortController().signal, schema);
    expect(result.text).toBe('{"kind":"CHAT"}');
    expect(httpPostMock.mock.calls[0][1]).toMatchObject({
      response_format: { type: 'json_schema', json_schema: { name: 'result', schema, strict: true } },
    });
  });

  it('sends no response_format without a schema', async () => {
    httpPostMock.mockResolvedValue({ data: { choices: [{ message: { content: 'CHAT' } }] } });
    const p = new OpenAiProvider({ baseUrl: 'http://zm:11434/v1', model: 'llama3.2' });
    await p.complete('sys', 'hello', new AbortController().signal);
    expect(httpPostMock.mock.calls[0][1]).not.toHaveProperty('response_format');
  });
});

describe('sampling temperature', () => {
  beforeEach(() => {
    httpPostMock.mockReset();
    httpGetMock.mockReset();
  });

  // Measured, not assumed: against this app's own prompt and tools, the SAME
  // prompt scored 57/66 and 66/66 on consecutive runs at Ollama's default 0.8,
  // and 66/66 twice at 0. Nothing here needs a creative sample.
  it('sends a greedy first attempt', async () => {
    httpPostMock.mockResolvedValue({
      data: { choices: [{ message: { content: 'There were 5 events today.' } }] },
    });
    const p = new OpenAiProvider({ baseUrl: 'http://zm:11434/v1', model: 'llama3.2' });
    await p.chat([{ role: 'user', text: 'summarize today' }], [], 'sys', new AbortController().signal);
    expect(httpPostMock.mock.calls[0][1]).toMatchObject({
      temperature: ASSISTANT.assistantTemperature,
    });
  });

  it('self-repairs on a retry, and only raises the temperature on the last attempt', async () => {
    // The retry is not a blind re-roll: the failed reply plus a correction are
    // appended, so a greedy retry already generates from a different prompt.
    // Only the final attempt raises the temperature, for a model stuck on the
    // same broken shape regardless of the correction.
    httpPostMock.mockResolvedValue({ data: { choices: [{ message: {} }] } });
    const p = new OpenAiProvider({ baseUrl: 'http://zm:11434/v1', model: 'llama3.2' });
    await p.chat([{ role: 'user', text: 'summarize today' }], [], 'sys', new AbortController().signal);
    expect(httpPostMock.mock.calls.length).toBe(ASSISTANT.maxParseAttempts);

    const secondAttempt = httpPostMock.mock.calls[1][1] as { temperature: number; messages: Array<{ role: string; content: string }> };
    expect(secondAttempt.temperature).toBe(ASSISTANT.assistantTemperature);
    expect(secondAttempt.messages.at(-1)?.content).toContain('empty or unusable');

    const lastAttempt = httpPostMock.mock.calls[ASSISTANT.maxParseAttempts - 1][1] as { temperature: number };
    expect(lastAttempt.temperature).toBe(ASSISTANT.assistantRetryTemperature);
    expect(ASSISTANT.assistantRetryTemperature).toBeGreaterThan(ASSISTANT.assistantTemperature);
  });
});
