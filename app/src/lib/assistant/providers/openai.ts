/**
 * OpenAI-compatible remote adapter (refs #246)
 *
 * Ollama (and any other OpenAI-compatible server) speaks the
 * `chat/completions` REST API with native tool-calling support. That is the
 * key difference from the on-device WebLLM adapter (`providers/webllm.ts`),
 * which drives tool use through a prompt-only JSON contract because small
 * on-device models are unreliable at native function calling. A capable
 * Ollama model (e.g. Qwen2.5, Llama 3.1+) supports the OpenAI `tools` /
 * `tool_calls` fields directly, so this adapter uses those instead of
 * reimplementing the prompt contract: `toOpenAiTools` sends each
 * `ToolDefinition` as a `type: 'function'` entry, and `parseOpenAiTurn` maps
 * a reply's `message.tool_calls` straight onto our `ToolCall` shape.
 *
 * Requests go through `lib/http.ts`'s `httpPost` (rule 10), not raw `fetch`:
 * on iOS/Android this routes through CapacitorHttp, which runs outside the
 * WebView and so is not subject to the WebView's CORS restrictions. A
 * bare-metal Ollama server has no reason to send
 * `Access-Control-Allow-Origin`, so a `fetch()`-based adapter would be
 * unusable from a native build talking to a LAN Ollama instance.
 */
import type { AssistantProvider, AssistantMessage, AssistantTurn, CompletionResult, ToolCall, ToolDefinition } from '../types';
import { httpGet, httpPost } from '../../http';
import { ASSISTANT } from '../../zmninja-ng-constants';
import { isAbortError } from '../../is-abort-error';
import { log, LogLevel } from '../../logger';
import { toTokenUsage, type OpenAiUsage } from './usage';
import { parseWebLlmTurn } from './webllm';
import { captureExchange } from '../exchange';

/** i18n-free (rule 5): AskPanel resolves this sentinel via `t()`, same
 *  sentinel `providers/webllm.ts` uses for its own parse failures. */
const PARSE_ERROR_TEXT = '__i18n:assistant.parse_error';
/** Mirrors `buildToolCatalog`'s empty case in webllm.ts. */
const NO_TOOLS_NOTICE = 'You have no tools available. You must answer directly, in plain text.';
const PORTABLE_TOOL_FALLBACK =
  'If you cannot emit a native tool call, respond with exactly one JSON object: ' +
  '{"tool":"<tool name>","input":{...}} or {"answer":"<text>"}.';

/** Appended (with the failed reply) before a parse retry, so the retry knows
 *  what went wrong instead of being re-rolled blind; see webllm.ts's
 *  SELF_REPAIR_PROMPT for why a blind retry at temperature 0 is wasted. */
const SELF_REPAIR_PROMPT =
  'Your last reply was empty or unusable. Reply again: answer the user in plain text, ' +
  'or call one of the provided tools.';

/** `baseUrl::model` pairs that have emitted a NATIVE tool call this session.
 *  Once a server has demonstrated native tool calling, the portable JSON
 *  fallback is dropped from its system prompt: for a capable model that
 *  instruction is not just dead weight, it invites `{"answer":...}` JSON as
 *  text where a plain answer or a native call was wanted. Module state, not an
 *  instance field, because AskPanel builds a fresh provider every turn.
 *  ponytail: session-only memory; persist the Settings probe verdict into
 *  profile settings if the first turn of every session needs it too. */
const NATIVE_TOOL_SERVERS = new Set<string>();

/** Test-only: module state survives across tests in one file. */
export function resetNativeToolServersForTests(): void {
  NATIVE_TOOL_SERVERS.clear();
}

/** `baseUrl::model` -> the context window the server is actually running the
 *  model with, learned from Ollama's native `/api/ps` (the OpenAI-compatible
 *  API never reports `num_ctx`, which is why `contextWindow` was permanently
 *  unknown here and auto-clear never ran on this backend). `0` marks a server
 *  that was asked and had no answer (not Ollama, model not loaded), so it is
 *  not asked again every turn. Session-scoped like NATIVE_TOOL_SERVERS. */
const CONTEXT_WINDOWS = new Map<string, number>();

/** Test-only. */
export function resetContextWindowsForTests(): void {
  CONTEXT_WINDOWS.clear();
  OLLAMA_SERVERS.clear();
}

/** Base URLs whose native `/api/ps` endpoint answered, i.e. confirmed Ollama.
 *  Gates Ollama-only request fields (`reasoning_effort`): a genuine OpenAI
 *  server rejects that param on non-reasoning models, so it is only sent
 *  where it is known safe. Populated by `refreshContextWindow`, which runs
 *  after the first completed turn; the first turn against a fresh server
 *  therefore still pays for reasoning, every later one skips it. */
const OLLAMA_SERVERS = new Set<string>();

interface OllamaPsResponse {
  models?: Array<{ name?: string; model?: string; context_length?: number }>;
}

/** `baseUrl::model` pairs a warmup has already been issued for this session,
 *  so reopening the panel does not re-post a load. A FAILED warmup is removed
 *  again: the server may simply have been down at that moment, and the next
 *  panel open should retry rather than remember the outage all session. */
const WARMED_MODELS = new Set<string>();

/** Test-only. */
export function resetWarmedModelsForTests(): void {
  WARMED_MODELS.clear();
}

/**
 * Loads `model` into the Ollama server's memory before the first question
 * (refs #261). An empty `/api/generate` body is Ollama's documented
 * load-only call: it resolves once the model is resident and generates
 * nothing. This is also the earliest possible Ollama confirmation, so the
 * FIRST chat of the session already runs with `reasoning_effort` applied and
 * a known context window; without it, both waited for the first completed
 * call, which is how a first question came to cost ~36s (cold load plus one
 * full thinking chain) while every later one took ~2s.
 *
 * Resolves `true` when the model is loaded, `false` when the warmup was
 * already issued or failed. Never throws: a warmup must not break the panel,
 * and a real turn surfaces real failures with better messages.
 */
export async function warmOllamaModel(config: OpenAiProviderConfig): Promise<boolean> {
  const key = `${config.baseUrl}::${config.model}`;
  if (WARMED_MODELS.has(key)) return false;
  WARMED_MODELS.add(key);
  const root = config.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  try {
    await httpPost(
      `${root}/api/generate`,
      { model: config.model },
      { headers, timeoutMs: ASSISTANT.modelProbeTimeoutMs, intent: 'Assistant Ollama model warmup' },
    );
    OLLAMA_SERVERS.add(config.baseUrl);
    // The window while we are here, same data refreshContextWindow reads
    // after a turn; the model is certainly loaded now.
    const ps = await httpGet<OllamaPsResponse>(`${root}/api/ps`, {
      timeoutMs: ASSISTANT.testConnectionTimeoutMs,
      intent: 'Assistant Ollama context window',
    });
    const entry = ps?.data?.models?.find((m) => m.model === config.model || m.name === config.model);
    if (entry?.context_length) CONTEXT_WINDOWS.set(key, entry.context_length);
    log.assistant('Ollama model warmed', LogLevel.INFO, { model: config.model, contextWindow: entry?.context_length });
    return true;
  } catch (error) {
    WARMED_MODELS.delete(key);
    log.assistant('Ollama model warmup failed; the first question will load it instead', LogLevel.WARN, {
      model: config.model,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export interface OpenAiProviderConfig {
  /** e.g. `http://localhost:11434/v1` (no trailing `/chat/completions`). */
  baseUrl: string;
  /** Model name as known to the server, e.g. `qwen2.5:3b`. */
  model: string;
  /** Optional Bearer key. Ollama itself needs none. */
  apiKey?: string;
  /** Sampling temperature. Omitted falls back to the measured default. */
  temperature?: number;
  /** Timeout for one reply, in ms. Omitted falls back to the measured default. */
  timeoutMs?: number;
}

interface OpenAiToolCallWire {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAiMessageWire {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OpenAiToolCallWire[];
  tool_call_id?: string;
}

interface OpenAiResponseMessage {
  content?: string | null;
  tool_calls?: OpenAiToolCallWire[];
}

interface OpenAiChatResponse {
  choices?: Array<{ message?: OpenAiResponseMessage; finish_reason?: string }>;
  usage?: OpenAiUsage;
}

/** Maps the app's `AssistantMessage[]` (roles user/assistant/tool) onto the
 *  OpenAI `chat/completions` message shape, prefixed by a system message.
 *  Unlike `webllm.ts`'s `buildWebLlmMessages`, `system` is sent AS-IS with no
 *  appended tool contract: native `tools`/`tool_choice` (see `toOpenAiTools`
 *  and `OpenAiProvider.chat`) carry that job instead of the prompt.
 *  A past assistant turn's `toolCalls` round-trip as native `tool_calls`
 *  (not re-serialized into JSON text like the WebLLM adapter does), and each
 *  tool result becomes its own `role: 'tool'` message keyed by `tool_call_id`
 *  so the server can pair it back to the call that produced it. */
export function buildOpenAiMessages(
  system: string,
  history: AssistantMessage[],
  /** Whether this turn has any tools at all. With none, the portable
   *  tool-call instruction is not just useless but harmful: it teaches the
   *  model to emit `{"tool":...}` when nothing can run it. Triage routes chat
   *  and refusal turns here with no tools, and the model duly replied
   *  `{"tool":"list_events",...}`, which the loop then had to refuse. The
   *  on-device path has always said "You have no tools available" in this
   *  case; this says the same thing. */
  hasTools = true,
  /** Whether the portable JSON fallback is still worth teaching. False once
   *  the server has emitted a native tool call (see NATIVE_TOOL_SERVERS). */
  includePortableFallback = true,
): OpenAiMessageWire[] {
  const contract = !hasTools ? NO_TOOLS_NOTICE : includePortableFallback ? PORTABLE_TOOL_FALLBACK : undefined;
  const messages: OpenAiMessageWire[] = [{ role: 'system', content: contract ? `${system}\n${contract}` : system }];

  for (const msg of history) {
    if (msg.role === 'user') {
      messages.push({ role: 'user', content: msg.text ?? '' });
    } else if (msg.role === 'assistant') {
      const toolCalls = msg.toolCalls ?? [];
      if (toolCalls.length > 0) {
        messages.push({
          role: 'assistant',
          content: msg.text ?? '',
          tool_calls: toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.input) },
          })),
        });
      } else {
        messages.push({ role: 'assistant', content: msg.text ?? '' });
      }
    } else {
      // role: 'tool', one wire message per result, paired to its call via
      // `tool_call_id` (ToolResult.callId already pairs with the ToolCall.id
      // that produced it; see agent.ts's runAssistantTurn).
      for (const result of msg.toolResults ?? []) {
        messages.push({ role: 'tool', tool_call_id: result.callId, content: result.output });
      }
    }
  }

  return messages;
}

/** Maps our `ToolDefinition[]` onto the OpenAI `tools` array format. */
export function toOpenAiTools(
  tools: ToolDefinition[],
): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.schema },
  }));
}

/** Parses one `chat.completions.create` response's `choices[0].message` into
 *  an `AssistantTurn`. Never throws: a missing message (malformed response
 *  shape) or unparsable tool-call arguments degrade to a fallback turn/empty
 *  input instead of crashing the agent loop, matching `parseWebLlmTurn`'s
 *  contract in `webllm.ts`. */
export function parseOpenAiTurn(message: OpenAiResponseMessage | undefined): AssistantTurn {
  if (!message) {
    return { text: PARSE_ERROR_TEXT, toolCalls: [] };
  }

  if (message.tool_calls && message.tool_calls.length > 0) {
    const toolCalls: ToolCall[] = message.tool_calls.map((tc) => {
      let input: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(tc.function.arguments || '{}');
        if (parsed !== null && typeof parsed === 'object') input = parsed as Record<string, unknown>;
      } catch {
        input = {};
      }
      return { id: tc.id, name: tc.function.name, input };
    });
    return { toolCalls };
  }

  const content = message.content ?? '';
  // A reasoning model that spends the whole token budget thinking returns no
  // content at all (the reasoning lands in its own field, which this adapter
  // does not read). Rendering that as the answer gave the user a blank
  // message, which reads as the app being broken rather than the reply being
  // cut off, so fall back to the apology every other unusable reply gets.
  if (content.trim() === '') return { text: PARSE_ERROR_TEXT, toolCalls: [] };
  const portableTurn = parseWebLlmTurn(content);
  if (portableTurn.text !== PARSE_ERROR_TEXT) return portableTurn;
  return { text: content, toolCalls: [] };
}

/**
 * The Ollama base URL to suggest when the profile has none.
 *
 * `localhost` is the wrong guess almost everywhere it matters: on a phone or
 * tablet it means the phone, which is never running Ollama. The ZoneMinder
 * server's own host is a far better one, since a self-hosted Ollama usually
 * lives on that machine or beside it on the same network.
 *
 * Port and path are Ollama's defaults; only the host is borrowed. Returns
 * undefined for a profile whose URL cannot be parsed, so the caller keeps its
 * own fallback.
 */
export function suggestOllamaBaseUrl(zoneminderUrl: string | undefined): string | undefined {
  if (!zoneminderUrl) return undefined;
  try {
    const { protocol, hostname } = new URL(zoneminderUrl);
    if (!hostname) return undefined;
    // http, not the portal's scheme: Ollama serves plain HTTP by default, and
    // suggesting https against a server without a certificate fails in a way
    // that reads as "unreachable" rather than "wrong scheme".
    return `${protocol === 'https:' ? 'https' : 'http'}://${hostname}:11434/v1`;
  } catch {
    return undefined;
  }
}

/**
 * Whether an error is a request that ran out of time rather than one the
 * server answered.
 *
 * The two HTTP paths report it differently: the web adapter aborts the signal
 * (a `DOMException` named 'AbortError'), while the native one rejects with a
 * plain `Error` reading "Native request timed out after Nms". Both mean the
 * same thing to a caller deciding what to tell the user.
 */
export function isTimeoutError(error: unknown): boolean {
  if (isAbortError(error)) return true;
  const name = (error as { name?: unknown })?.name;
  if (name === 'TimeoutError') return true;
  return error instanceof Error && /timed out/i.test(error.message);
}

/** What a tool-support probe found. */
export type ToolSupport = 'supported' | 'unsupported' | 'no-tool-call' | 'timeout';

/**
 * Whether a model can actually drive this assistant, asked of the server
 * rather than guessed from the model's name.
 *
 * A name tells you nothing: `qwen3-coder` scores full marks here and
 * `qwen2.5-coder` never emits a tool call at all. Two distinct failures show
 * up, and only one of them announces itself:
 *
 * - 'unsupported': Ollama rejects the request outright, e.g.
 *   `"registry.ollama.ai/library/gemma2:9b does not support tools"`. The model
 *   has no tool template.
 * - 'no-tool-call': the request succeeds and the model replies with prose (or
 *   prints the call as text) instead of calling the tool. Nothing errors; the
 *   assistant simply never fetches anything.
 *
 * Deliberately a probe and not an allowlist. New models appear constantly, and
 * a hardcoded list of names would rot exactly as a hardcoded taxonomy did.
 */
export async function probeToolSupport(
  baseUrl: string,
  model: string,
  apiKey?: string,
  timeoutMs = ASSISTANT.modelProbeTimeoutMs,
): Promise<ToolSupport> {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const body = {
    model,
    messages: [{ role: 'user', content: 'What is the weather in Paris? Use the tool.' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get the current weather for a city.',
          parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
        },
      },
    ],
    tool_choice: 'auto',
    stream: false,
    // The SAME budget a real turn gets. A tight probe-only cap looks like a
    // safe optimisation and is not: gemma4 spends tokens before it emits the
    // call, so a 64-token cap returned finish_reason 'length' with no
    // `tool_calls`, which this function then reported as "never calls tools",
    // condemning a model that works. Probe under the conditions being probed.
    max_tokens: ASSISTANT.ollamaMaxTokens,
    temperature: ASSISTANT.assistantTemperature,
  };

  try {
    const response = await httpPost<OpenAiChatResponse>(url, body, {
      headers,
      timeoutMs,
      intent: 'Assistant Ollama tool-support probe',
    });
    const choice = response.data?.choices?.[0];
    if ((choice?.message?.tool_calls?.length ?? 0) > 0) return 'supported';
    // Truncation is not a verdict about the model. Say so in the log rather
    // than letting a cut-off answer masquerade as a refusal to call tools.
    if (choice?.finish_reason === 'length') {
      log.assistant('Ollama tool-support probe hit the token cap', LogLevel.WARN, {
        model,
        maxTokens: ASSISTANT.ollamaMaxTokens,
      });
    }
    return 'no-tool-call';
  } catch (error) {
    const verdict = toolSupportFromError(error);
    if (verdict) return verdict;
    // A timeout is a verdict of its own, not a failure to report. The server
    // answered the reachability probe moments ago, so "unreachable" would be
    // wrong and "cannot use tools" would be a guess: the model simply did not
    // finish loading in time, which has its own fix (load it, or wait).
    if (isTimeoutError(error)) return 'timeout';
    throw error;
  }
}

/** 'unsupported' when a failure is the server saying this model has no tool
 *  template, undefined when it is a real failure the caller must surface as
 *  itself (an unreachable host is not a verdict about the model).
 *
 *  Pure and separate so the decision is testable without mocking the
 *  transport: asserting on a rejected transport mock left vitest holding the
 *  rejection and reporting it as an unhandled error, whatever assertion form
 *  was used. The string is Ollama's own, e.g.
 *  `"registry.ollama.ai/library/gemma2:9b does not support tools"`. */
export function toolSupportFromError(error: unknown): ToolSupport | undefined {
  // BOTH the message and the response body. `createHttpError` builds the
  // message as "HTTP 400: Bad Request" and parks the server's own words in
  // `data`, so matching the message alone found nothing and the caller
  // surfaced a generic failure with no explanation, which is exactly what a
  // model without tool support looked like in the UI.
  const message = error instanceof Error ? error.message : String(error);
  const data = (error as { data?: unknown })?.data;
  const body = data === undefined ? '' : typeof data === 'string' ? data : JSON.stringify(data);
  return /does not support tools/i.test(`${message} ${body}`) ? 'unsupported' : undefined;
}

interface OpenAiModelsResponse {
  data?: Array<{ id?: string }>;
}

/** Lists the models an OpenAI-compatible server (Ollama's `/v1/models`)
 *  currently serves, for the model picker in `AssistantOllamaSection.tsx` and
 *  the Test-connection reachability probe (`handleTestConnection`, refs #246).
 *  A reachable server with no models registered yet is not an error: it
 *  returns `[]` so the caller falls back to manual entry. A network or HTTP
 *  failure (unreachable server, wrong URL, 401) rejects instead, so the
 *  caller can distinguish "empty" from "broken" and surface the real error.
 *  `timeoutMs` defaults to the full `ASSISTANT.requestTimeoutMs` (120s, sized
 *  for the model-picker's own use); the Test-connection button passes the
 *  much shorter `ASSISTANT.testConnectionTimeoutMs` (8s) instead, since a
 *  reachability check has no reason to wait as long as an actual chat turn. */
export async function listOpenAiModels(
  baseUrl: string,
  apiKey?: string,
  timeoutMs: number = ASSISTANT.requestTimeoutMs,
): Promise<string[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`;
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await httpGet<OpenAiModelsResponse>(url, {
    headers,
    timeoutMs,
    intent: 'Assistant Ollama list models',
  });

  const entries = response.data?.data;
  if (!Array.isArray(entries)) return [];

  const ids = entries
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  return Array.from(new Set(ids)).sort();
}

/** The Ollama / OpenAI-compatible remote provider: no WebGPU, no local
 *  weights, one `httpPost` per turn against `${baseUrl}/chat/completions`. */
export class OpenAiProvider implements AssistantProvider {
  private readonly config: OpenAiProviderConfig;

  constructor(config: OpenAiProviderConfig) {
    this.config = config;
  }

  private get serverKey(): string {
    return `${this.config.baseUrl}::${this.config.model}`;
  }

  /** The window `/api/ps` reported for this server+model, once a turn has run
   *  and the lookup resolved (see `refreshContextWindow`). AskPanel reads this
   *  after each turn, and the cache is module-scoped, so the window learned
   *  during turn N drives the auto-clear decision from turn N+1 on. */
  get contextWindow(): number | undefined {
    const window = CONTEXT_WINDOWS.get(this.serverKey);
    return window ? window : undefined;
  }

  /** Fire-and-forget: asks Ollama's native API what window the loaded model
   *  actually runs with. `/api/ps` only lists LOADED models, so this runs
   *  after a chat completion, when the model is certainly loaded. A server
   *  without the endpoint (not Ollama) records 0 and is never asked again. */
  private refreshContextWindow(): void {
    if (CONTEXT_WINDOWS.has(this.serverKey)) return;
    const { baseUrl, model } = this.config;
    const root = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
    void (async () => {
      try {
        const response = await httpGet<OllamaPsResponse>(`${root}/api/ps`, {
          timeoutMs: ASSISTANT.testConnectionTimeoutMs,
          intent: 'Assistant Ollama context window',
        });
        // The endpoint answering at all is the Ollama confirmation the
        // reasoning_effort gate needs, whether or not this model is listed.
        OLLAMA_SERVERS.add(this.config.baseUrl);
        const entry = response?.data?.models?.find((m) => m.model === model || m.name === model);
        CONTEXT_WINDOWS.set(this.serverKey, entry?.context_length ?? 0);
        log.assistant('Ollama context window learned', LogLevel.DEBUG, { model, contextWindow: entry?.context_length });
      } catch {
        CONTEXT_WINDOWS.set(this.serverKey, 0);
      }
    })();
  }

  /** The configured value, or the measured default when Settings has none. */
  private get temperature(): number {
    return this.config.temperature ?? ASSISTANT.assistantTemperature;
  }

  /** `reasoning_effort` for confirmed Ollama servers only (see
   *  OLLAMA_SERVERS and ASSISTANT.ollamaReasoningEffort): measured at ~5x
   *  faster turns on thinking models with identical eval scores. */
  private get reasoningFields(): Record<string, string> {
    return OLLAMA_SERVERS.has(this.config.baseUrl)
      ? { reasoning_effort: ASSISTANT.ollamaReasoningEffort }
      : {};
  }

  private get timeoutMs(): number {
    return this.config.timeoutMs ?? ASSISTANT.requestTimeoutMs;
  }

  /** Bare system + user, with no `tools` field at all; see
   *  `AssistantProvider.complete`. This path never carried the envelope
   *  scaffolding, but it did send tool schemas the classifier had no use for.
   *  `jsonSchema` becomes `response_format: json_schema`, which Ollama >= 0.5
   *  compiles into a grammar constraint; a server that rejects the field
   *  fails the request, which callers like triage already treat as "no
   *  verdict" and degrade from. */
  async complete(system: string, text: string, signal: AbortSignal, jsonSchema?: Record<string, unknown>): Promise<CompletionResult> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const { baseUrl, model, apiKey } = this.config;
    const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const body = {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text },
      ],
      stream: false,
      max_tokens: ASSISTANT.ollamaMaxTokens,
      temperature: this.temperature,
      ...this.reasoningFields,
      ...(jsonSchema
        ? { response_format: { type: 'json_schema', json_schema: { name: 'result', schema: jsonSchema, strict: true } } }
        : {}),
    };
    const startedAt = Date.now();
    const response = await httpPost<OpenAiChatResponse>(url, body, {
      headers,
      signal,
      timeoutMs: this.timeoutMs,
      intent: 'Assistant Ollama completion',
    });
    const content = response.data?.choices?.[0]?.message?.content ?? '';
    // A completion loads the model just as a chat does, so this is also a
    // valid moment to learn the window and confirm the server is Ollama.
    this.refreshContextWindow();
    return {
      text: content,
      exchange: captureExchange({ backend: 'ollama', model, sent: body, received: content, startedAt }),
    };
  }

  async chat(
    messages: AssistantMessage[],
    tools: ToolDefinition[],
    system: string,
    signal: AbortSignal,
  ): Promise<AssistantTurn> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    const { baseUrl, model, apiKey } = this.config;
    const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    // `tools`/`tool_choice` omitted entirely when there are none, rather than
    // sent empty with `tool_choice: 'auto'`, which invites a server to look for
    // a tool that is not there.
    const chatMessages = buildOpenAiMessages(system, messages, tools.length > 0, !NATIVE_TOOL_SERVERS.has(this.serverKey));
    const body = {
      model,
      messages: chatMessages,
      ...(tools.length > 0 ? { tools: toOpenAiTools(tools), tool_choice: 'auto' } : {}),
      stream: false,
      max_tokens: ASSISTANT.ollamaMaxTokens,
      temperature: this.temperature,
      ...this.reasoningFields,
    };

    // Retried like the on-device path, not single-shot. A degenerate reply
    // (empty content, prose that is neither a native tool call nor the portable
    // JSON) used to surface the apology to the user directly here, while the
    // WebLLM path quietly re-rolled and recovered. The retry is a self-repair:
    // the failed reply and a correction naming the fault are appended, so even
    // the greedy first temperature (0, measured best for accuracy) produces a
    // different generation. The final attempt also raises the temperature, in
    // case the model is stuck regardless of the correction. The cost is one
    // more network round trip on a reply that was going to be discarded anyway.
    let turn: AssistantTurn = { text: PARSE_ERROR_TEXT, toolCalls: [] };
    for (let attempt = 1; attempt <= ASSISTANT.maxParseAttempts; attempt++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      log.assistant('Sending Ollama chat completion request', LogLevel.DEBUG, {
        baseUrl,
        model,
        messageCount: chatMessages.length,
        attempt,
      });

      // Rebuilt per attempt: the self-repair context grows and the temperature
      // may change; everything else is the same body.
      const attemptBody = {
        ...body,
        messages: [...chatMessages],
        // The retry must be able to move even when the first attempt is greedy,
        // so it raises whatever temperature was configured rather than
        // replacing it.
        temperature:
          attempt < ASSISTANT.maxParseAttempts
            ? this.temperature
            : Math.max(this.temperature, ASSISTANT.assistantRetryTemperature),
      };
      const startedAt = Date.now();
      const response = await httpPost<OpenAiChatResponse>(url, attemptBody, {
        headers,
        signal,
        timeoutMs: this.timeoutMs,
        intent: 'Assistant Ollama chat',
      });

      const message = response.data?.choices?.[0]?.message;
      log.assistant('Ollama raw response', LogLevel.DEBUG, { baseUrl, model, message, attempt });
      // A native tool call proves the server's tool template works; later
      // turns stop teaching the portable JSON fallback (see NATIVE_TOOL_SERVERS).
      if ((message?.tool_calls?.length ?? 0) > 0) NATIVE_TOOL_SERVERS.add(this.serverKey);
      // The model is certainly loaded now, so /api/ps can say what window it
      // runs with; enables auto-clear on this backend from the next turn.
      this.refreshContextWindow();

      // Nothing downstream can tell a complete answer from one that stopped
      // mid-sentence, so the truncation has to be named here or it is
      // invisible. A reasoning model hitting this means `ollamaMaxTokens` is
      // too low for it.
      if (response.data?.choices?.[0]?.finish_reason === 'length') {
        log.assistant('Ollama reply hit the token cap and was truncated', LogLevel.WARN, {
          model,
          maxTokens: ASSISTANT.ollamaMaxTokens,
          completionTokens: response.data?.usage?.completion_tokens,
        });
      }

      turn = parseOpenAiTurn(message);
      // The panel offers "show model output" under the apology, but only when
      // the turn carries what failed. The on-device path has always set this;
      // here a parse failure gave the user an apology and nothing to inspect.
      if (turn.text === PARSE_ERROR_TEXT) turn.raw = JSON.stringify(message ?? response.data);
      turn.usage = toTokenUsage(response.data?.usage);
      // `body`, not just its messages: on this backend the tool schemas ride in
      // `tools` rather than in the prompt, so omitting them would hide half of
      // what the model was actually given. Captured on every attempt, so a
      // retried turn shows what it retried from.
      turn.exchange = captureExchange({
        backend: 'ollama',
        model,
        sent: attemptBody,
        received: message ?? response.data,
        startedAt,
      });
      if (turn.text !== PARSE_ERROR_TEXT) return turn;

      log.assistant('Ollama response failed to parse into a tool call or answer; retrying if attempts remain', LogLevel.WARN, {
        baseUrl,
        model,
        attempt,
        maxAttempts: ASSISTANT.maxParseAttempts,
        response: response.data,
      });
      // The self-repair context the next attempt sees: what came back, and why
      // it was unusable. Accumulates across attempts on purpose.
      chatMessages.push({ role: 'assistant', content: message?.content ?? '' });
      chatMessages.push({ role: 'user', content: SELF_REPAIR_PROMPT });
    }
    return turn;
  }
}
