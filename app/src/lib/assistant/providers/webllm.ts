/**
 * On-device WebLLM adapter (refs #246)
 *
 * Small on-device models are unreliable at WebLLM's native function-calling
 * protocol, so this adapter never uses `ChatCompletionRequest.tools`. Instead
 * every turn is constrained with `response_format: { type: 'json_object' }`
 * and a system-prompt instruction to reply with exactly one of two JSON
 * shapes: `{"tool": "<name>", "input": {...}}` for one tool call, or
 * `{"answer": "<text>"}` to answer directly. `response_format.schema` (a JSON
 * Schema STRING) exists in this web-llm version, but encoding a `{tool,input}
 * | {answer}` union as a single JSON-Schema string added more complexity than
 * the prompt-instruction approach for a two-shape contract, so it is left
 * unused here; the request-builder/parser pair below is the constraint.
 *
 * `buildWebLlmMessages` and `parseWebLlmTurn` are pure and exported so they
 * unit-test without WebGPU; only `WebLlmProvider.chat` touches the engine.
 */
import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm';
import type { AssistantProvider, AssistantMessage, AssistantTurn, ToolCall, ToolDefinition } from '../types';
import { ASSISTANT } from '../../zmninja-ng-constants';
import { log, LogLevel } from '../../logger';
import { getLoadedEngine } from '../model-download';

/** i18n-free (rule 5): AskPanel resolves this sentinel via `t()`, same as
 *  agent.ts's iteration-cap message. */
const PARSE_ERROR_TEXT = '__i18n:assistant.parse_error';

function describeTool(tool: ToolDefinition): string {
  return `- ${tool.name}: ${tool.description} Input schema: ${JSON.stringify(tool.schema)}`;
}

function buildToolContract(tools: ToolDefinition[]): string {
  if (tools.length === 0) {
    return 'You have no tools available. Respond with ONLY {"answer": "<text>"}.';
  }
  return [
    'You may call ONE tool per turn, or answer the user directly. Available tools:',
    tools.map(describeTool).join('\n'),
    '',
    'Respond with ONLY a single JSON object and nothing else: no markdown fences, no commentary.',
    'To call a tool: {"tool": "<tool name>", "input": { ... matching its input schema ... }}',
    'To answer the user directly: {"answer": "<your reply>"}',
  ].join('\n');
}

/** Maps the app's `AssistantMessage[]` (roles user/assistant/tool) onto the
 *  OpenAI-shaped messages web-llm expects, prefixed by a system message that
 *  folds in `system` plus the tool contract above. Past assistant turns are
 *  re-serialized into the same `{tool,input}` / `{answer}` JSON shape the
 *  model is instructed to produce, so its own history stays consistent with
 *  the contract instead of showing it free-form text it never generated. */
export function buildWebLlmMessages(
  system: string,
  history: AssistantMessage[],
  tools: ToolDefinition[],
): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: `${system}\n\n${buildToolContract(tools)}` },
  ];

  for (const msg of history) {
    if (msg.role === 'user') {
      messages.push({ role: 'user', content: msg.text ?? '' });
    } else if (msg.role === 'assistant') {
      const call = msg.toolCalls?.[0];
      const content = call
        ? JSON.stringify({ tool: call.name, input: call.input })
        : JSON.stringify({ answer: msg.text ?? '' });
      messages.push({ role: 'assistant', content });
    } else {
      for (const result of msg.toolResults ?? []) {
        messages.push({ role: 'tool', content: result.output, tool_call_id: result.callId });
      }
    }
  }

  return messages;
}

function extractJsonPayload(content: string): string {
  // Some models wrap JSON in a markdown fence despite being told not to;
  // strip it before parsing rather than failing the whole turn over it.
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

/** Parses one `chat.completions.create` response's message content into an
 *  `AssistantTurn`. Never throws: malformed or unrecognized JSON degrades to
 *  a fallback apology turn with no tool calls, so a single bad generation
 *  doesn't crash the agent loop (agent.ts pushes this turn as-is and stops,
 *  same as any other answer-only turn). */
export function parseWebLlmTurn(content: string): AssistantTurn {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonPayload(content));
  } catch {
    return { text: PARSE_ERROR_TEXT, toolCalls: [] };
  }

  if (parsed !== null && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;

    if (typeof obj.tool === 'string') {
      const input = obj.input !== null && typeof obj.input === 'object' ? (obj.input as Record<string, unknown>) : {};
      const toolCall: ToolCall = { id: crypto.randomUUID(), name: obj.tool, input };
      return { toolCalls: [toolCall] };
    }

    if (typeof obj.answer === 'string') {
      return { text: obj.answer, toolCalls: [] };
    }
  }

  return { text: PARSE_ERROR_TEXT, toolCalls: [] };
}

/** The on-device provider: one WebLLM engine (owned by model-download.ts),
 *  driven with the constrained-JSON contract above instead of native
 *  function calling. */
export class WebLlmProvider implements AssistantProvider {
  private readonly modelId: string;

  constructor(modelId: string) {
    this.modelId = modelId;
  }

  async chat(
    messages: AssistantMessage[],
    tools: ToolDefinition[],
    system: string,
    signal: AbortSignal,
  ): Promise<AssistantTurn> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    const engine = await getLoadedEngine(this.modelId);
    const chatMessages = buildWebLlmMessages(system, messages, tools);

    log.assistant('Sending WebLLM chat completion request', LogLevel.DEBUG, {
      modelId: this.modelId,
      messageCount: chatMessages.length,
    });

    const response = await engine.chat.completions.create({
      messages: chatMessages,
      response_format: { type: 'json_object' },
      max_tokens: ASSISTANT.maxTokens,
    });

    const content = response.choices[0]?.message?.content ?? '';
    return parseWebLlmTurn(content);
  }
}
