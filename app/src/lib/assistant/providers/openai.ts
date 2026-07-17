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
import type { AssistantProvider, AssistantMessage, AssistantTurn, ToolCall, ToolDefinition } from '../types';
import { httpGet, httpPost } from '../../http';
import { ASSISTANT } from '../../zmninja-ng-constants';
import { log, LogLevel } from '../../logger';

/** i18n-free (rule 5): AskPanel resolves this sentinel via `t()`, same
 *  sentinel `providers/webllm.ts` uses for its own parse failures. */
const PARSE_ERROR_TEXT = '__i18n:assistant.parse_error';

export interface OpenAiProviderConfig {
  /** e.g. `http://localhost:11434/v1` (no trailing `/chat/completions`). */
  baseUrl: string;
  /** Model name as known to the server, e.g. `qwen2.5:3b`. */
  model: string;
  /** Optional Bearer key. Ollama itself needs none. */
  apiKey?: string;
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
  choices?: Array<{ message?: OpenAiResponseMessage }>;
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
export function buildOpenAiMessages(system: string, history: AssistantMessage[]): OpenAiMessageWire[] {
  const messages: OpenAiMessageWire[] = [{ role: 'system', content: system }];

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

  return { text: message.content ?? '', toolCalls: [] };
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

    const body = {
      model,
      messages: buildOpenAiMessages(system, messages),
      tools: toOpenAiTools(tools),
      tool_choice: 'auto',
      stream: false,
      max_tokens: ASSISTANT.maxTokens,
    };

    log.assistant('Sending Ollama chat completion request', LogLevel.DEBUG, {
      baseUrl,
      model,
      messageCount: body.messages.length,
    });

    const response = await httpPost<OpenAiChatResponse>(url, body, {
      headers,
      signal,
      timeoutMs: ASSISTANT.requestTimeoutMs,
      intent: 'Assistant Ollama chat',
    });

    const message = response.data?.choices?.[0]?.message;
    log.assistant('Ollama raw response', LogLevel.DEBUG, { baseUrl, model, message });

    const turn = parseOpenAiTurn(message);
    if (turn.text === PARSE_ERROR_TEXT) {
      log.assistant('Ollama response failed to parse into a tool call or answer', LogLevel.WARN, {
        baseUrl,
        model,
        response: response.data,
      });
    }
    return turn;
  }
}
