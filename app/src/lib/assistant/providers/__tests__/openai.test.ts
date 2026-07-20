import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildOpenAiMessages, toOpenAiTools, parseOpenAiTurn, OpenAiProvider, listOpenAiModels, probeToolSupport, toolSupportFromError, suggestOllamaBaseUrl } from '../openai';
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

  it('raises the temperature on a retry so the sampler can escape a bad reply', async () => {
    // At temperature 0 a retry returns the identical unparseable text, which
    // would spend every attempt for nothing.
    httpPostMock.mockResolvedValue({ data: { choices: [{ message: {} }] } });
    const p = new OpenAiProvider({ baseUrl: 'http://zm:11434/v1', model: 'llama3.2' });
    await p.chat([{ role: 'user', text: 'summarize today' }], [], 'sys', new AbortController().signal);
    expect(httpPostMock.mock.calls.length).toBeGreaterThan(1);
    expect(httpPostMock.mock.calls[1][1]).toMatchObject({
      temperature: ASSISTANT.assistantRetryTemperature,
    });
    expect(ASSISTANT.assistantRetryTemperature).toBeGreaterThan(ASSISTANT.assistantTemperature);
  });
});
