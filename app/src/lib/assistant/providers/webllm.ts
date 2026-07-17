/**
 * On-device WebLLM adapter (refs #246)
 *
 * Small on-device models are unreliable at WebLLM's native function-calling
 * protocol, so this adapter never uses `ChatCompletionRequest.tools`. Instead
 * every turn is constrained with a system-prompt instruction to reply with
 * exactly one of two JSON shapes: `{"tool": "<name>", "input": {...}}` for
 * one tool call, or `{"answer": "<text>"}` to answer directly.
 *
 * `response_format: { type: 'json_object' }` is deliberately NOT sent: in
 * `@mlc-ai/web-llm@0.2.84`, `json_object` mode routes into the XGrammar
 * JSON-schema compiler (`GrammarCompiler.CompileJSONSchema`), which expects a
 * schema STRING. With no `response_format.schema` supplied it throws a WASM
 * `BindingError: Cannot pass non-string to std::string`, crashing every chat
 * turn. So the constraint here is prompt + parser only, not `response_format`.
 *
 * The default model, Qwen3-1.7B, is a reasoning model that emits a
 * `<think>...</think>` chain-of-thought block before its final answer;
 * `parseWebLlmTurn` strips that block before extracting JSON so the model's
 * scratch-work (which may itself contain brace-y text) is never mistaken for
 * the real reply.
 *
 * `buildWebLlmMessages` and `parseWebLlmTurn` are pure and exported so they
 * unit-test without WebGPU; only `WebLlmProvider.chat` touches the engine.
 */
import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm';
import type { AssistantProvider, AssistantMessage, AssistantTurn, ToolCall, ToolDefinition } from '../types';
import { ASSISTANT } from '../../zmninja-ng-constants';
import { log, LogLevel } from '../../logger';
import { getLoadedEngine } from '../model-download';
import { toTokenUsage } from './usage';

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

/** Few-shot anchors prepended to every WebLLM conversation, right after the
 *  system message and before the real `history` (see `buildWebLlmMessages`).
 *  Small on-device models were observed asking the user for a monitor name
 *  instead of calling `count_events` with no `monitorId` for an "all
 *  monitors" summary question, so example 1 demonstrates exactly that call.
 *  Example 2 covers a no-argument tool plus a direct, non-tool answer.
 *
 *  These are model-facing only (never rendered in the UI), so they are
 *  exempt from i18n (rule 5). They must use tool names that are real in the
 *  registry (`readOnlyTools` in tools-readonly.ts: `count_events`,
 *  `get_server_health`, `list_events`, `list_monitors`) and must mirror the
 *  exact serialization `buildWebLlmMessages` produces below: an assistant
 *  turn is the bare JSON string `{"tool":...}` / `{"answer":...}`, and a
 *  tool result is a `user` message starting with `Tool result:\n` followed
 *  by the same reminder sentence used for real tool results. Keep this list
 *  short (2 examples): every token here is spent on every single turn. */
function buildFewShotExamples(): ChatCompletionMessageParam[] {
  return [
    { role: 'user', content: 'How many events were recorded today?' },
    { role: 'assistant', content: '{"tool": "count_events", "input": {"interval": "1 day"}}' },
    {
      role: 'user',
      content:
        'Tool result:\n[{"monitor":"Front Door","count":12},{"monitor":"Garage","count":3}]\n\n' +
        'Respond with ONLY a single JSON object: {"tool": "<name>", "input": {...}} to call another tool, ' +
        'or {"answer": "<text>"} to answer the user.',
    },
    {
      role: 'assistant',
      content: '{"answer": "There were 15 events today: 12 on Front Door and 3 on Garage."}',
    },
    { role: 'user', content: 'Is the server healthy?' },
    { role: 'assistant', content: '{"tool": "get_server_health", "input": {}}' },
    {
      role: 'user',
      content:
        'Tool result:\n{"load":0.4,"diskPercent":45,"daemonRunning":true,"version":"1.37.0"}\n\n' +
        'Respond with ONLY a single JSON object: {"tool": "<name>", "input": {...}} to call another tool, ' +
        'or {"answer": "<text>"} to answer the user.',
    },
    {
      role: 'assistant',
      content: '{"answer": "Yes. Load is 0.4, disk is 45% used, and the capture daemon is running."}',
    },
  ];
}

/** Qwen3 is a reasoning model: by default it emits a `<think>...</think>`
 *  chain-of-thought block before its final answer. Under this adapter's fixed
 *  `ASSISTANT.maxTokens` budget, that reasoning can consume the whole budget
 *  and the generation gets cut off before the JSON reply is ever produced,
 *  which is the likely cause of `assistant.parse_error` on multi-step
 *  questions ("which monitor was most active in the last 24 hours" needs a
 *  tool call *and* a follow-up answer, both inside one budget). Qwen3's own
 *  `/no_think` directive, appended to the system message per its documented
 *  chat template, disables that reasoning mode for the turn. `stripThinkBlock`
 *  below stays as a safety net regardless, in case a Qwen3 variant still
 *  emits a `<think>` block under `/no_think`. */
function isQwen3Model(modelId: string): boolean {
  return /qwen3/i.test(modelId);
}

/** Maps the app's `AssistantMessage[]` (roles user/assistant/tool) onto the
 *  OpenAI-shaped messages web-llm expects, prefixed by a system message that
 *  folds in `system` plus the tool contract above (and, for a Qwen3 model,
 *  the `/no_think` directive; see `isQwen3Model`). Past assistant turns are
 *  re-serialized into the same `{tool,input}` / `{answer}` JSON shape the
 *  model is instructed to produce, so its own history stays consistent with
 *  the contract instead of showing it free-form text it never generated.
 *  A fixed block of `buildFewShotExamples()` turns follows the system
 *  message, demonstrating that exact shape before the real conversation
 *  starts (see its doc comment for why). */
export function buildWebLlmMessages(
  system: string,
  history: AssistantMessage[],
  tools: ToolDefinition[],
  modelId: string,
): ChatCompletionMessageParam[] {
  const systemContent = `${system}\n\n${buildToolContract(tools)}${isQwen3Model(modelId) ? '\n\n/no_think' : ''}`;
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemContent },
    ...buildFewShotExamples(),
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
      // This adapter drives tool-calling through the prompt contract, not
      // web-llm's native `tools`/`tool_calls`, so the prior assistant message
      // is plain JSON with no `tool_calls` field. Feeding the result back as a
      // `role: 'tool'` message would be an orphan tool response (no matching
      // native call) and web-llm's chat template rejects it. Fold the results
      // into a user message that restates the JSON contract instead.
      const results = msg.toolResults ?? [];
      if (results.length > 0) {
        const body = results.map((r) => r.output).join('\n');
        messages.push({
          role: 'user',
          content: `Tool result:\n${body}\n\nRespond with ONLY a single JSON object: {"tool": "<name>", "input": {...}} to call another tool, or {"answer": "<text>"} to answer the user.`,
        });
      }
    }
  }

  return messages;
}

/** Strips a reasoning model's `<think>...</think>` chain-of-thought block
 *  (e.g. Qwen3's) from the front of `content` before JSON extraction runs.
 *  If a closing `</think>` is present, everything up to and including it is
 *  removed, leaving only the final answer. If `<think>` opens but never
 *  closes (generation was cut short by `max_tokens`), the whole tail from
 *  `<think>` onward is dropped instead of being handed to the JSON
 *  extractor, since it is scratch-work, not a reply. */
function stripThinkBlock(content: string): string {
  const openIndex = content.indexOf('<think>');
  if (openIndex === -1) return content;

  const closeTag = '</think>';
  const closeIndex = content.indexOf(closeTag, openIndex);
  if (closeIndex === -1) {
    return content.slice(0, openIndex);
  }

  return content.slice(0, openIndex) + content.slice(closeIndex + closeTag.length);
}

function extractJsonPayload(content: string): string {
  // Some models wrap JSON in a markdown fence despite being told not to;
  // strip it before parsing rather than failing the whole turn over it.
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

/** Extracts the first balanced `{...}` object substring from `content`, or
 *  `undefined` if there is no `{`. Small on-device models sometimes wrap the
 *  JSON reply in prose ("Sure, here you go: {...} let me know if that
 *  helps") despite the system prompt's "ONLY a single JSON object"
 *  instruction; this recovers the embedded object instead of failing the
 *  whole turn over surrounding text. Brace-counts rather than regex-matching
 *  to the last `}` so a `}` inside a JSON string value doesn't truncate the
 *  match early. */
function extractBalancedJsonObject(content: string): string | undefined {
  const start = content.indexOf('{');
  if (start === -1) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < content.length; i++) {
    const ch = content[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return content.slice(start, i + 1);
      }
    }
  }

  return undefined;
}

/** Parses one `chat.completions.create` response's message content into an
 *  `AssistantTurn`. Never throws: malformed or unrecognized JSON degrades to
 *  a fallback apology turn with no tool calls, so a single bad generation
 *  doesn't crash the agent loop (agent.ts pushes this turn as-is and stops,
 *  same as any other answer-only turn). A reasoning model's `<think>` block
 *  is stripped first (see `stripThinkBlock`) so its scratch-work never gets
 *  mistaken for the final JSON reply. */
export function parseWebLlmTurn(content: string): AssistantTurn {
  const stripped = stripThinkBlock(content);

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonPayload(stripped));
  } catch {
    // The fence-stripped content still isn't valid JSON on its own; a small
    // model may have replied with JSON embedded in prose instead. Try to
    // recover the first balanced {...} object before giving up.
    const embedded = extractBalancedJsonObject(stripped);
    if (embedded === undefined) {
      return { text: PARSE_ERROR_TEXT, toolCalls: [], raw: content };
    }
    try {
      parsed = JSON.parse(embedded);
    } catch {
      return { text: PARSE_ERROR_TEXT, toolCalls: [], raw: content };
    }
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

  return { text: PARSE_ERROR_TEXT, toolCalls: [], raw: content };
}

/** The on-device provider: one WebLLM engine (owned by model-download.ts),
 *  driven with the constrained-JSON contract above instead of native
 *  function calling. */
export class WebLlmProvider implements AssistantProvider {
  private readonly modelId: string;
  /** Exactly the window `model-download.ts` passes to `CreateMLCEngine` for
   *  this model, so the fullness check in AskPanel measures against what the
   *  engine was actually built with rather than a guess. Undefined for a model
   *  outside `webllmModels`, which is also the case where `chatOptsFor` sends
   *  no override and the registry default (4096) applies: we don't claim to
   *  know a window we didn't set. */
  readonly contextWindow?: number;

  constructor(modelId: string) {
    this.modelId = modelId;
    this.contextWindow = ASSISTANT.webllmModels.find((m) => m.id === modelId)?.contextWindowSize;
  }

  async chat(
    messages: AssistantMessage[],
    tools: ToolDefinition[],
    system: string,
    signal: AbortSignal,
  ): Promise<AssistantTurn> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    const engine = await getLoadedEngine(this.modelId);
    const chatMessages = buildWebLlmMessages(system, messages, tools, this.modelId);

    log.assistant('Sending WebLLM chat completion request', LogLevel.DEBUG, {
      modelId: this.modelId,
      messageCount: chatMessages.length,
    });

    const response = await engine.chat.completions.create({
      messages: chatMessages,
      max_tokens: ASSISTANT.maxTokens,
    });

    const content = response.choices[0]?.message?.content ?? '';
    log.assistant('WebLLM raw response', LogLevel.DEBUG, { modelId: this.modelId, content });

    const turn = parseWebLlmTurn(content);
    turn.usage = toTokenUsage(response.usage);
    if (turn.text === PARSE_ERROR_TEXT) {
      // Visible at WARN (not DEBUG) so a parse failure is easy to spot in the
      // console without cranking the log level: see the raw text above the
      // "Sorry, I had trouble..." fallback the user sees.
      log.assistant('WebLLM response failed to parse into a tool call or answer', LogLevel.WARN, {
        modelId: this.modelId,
        content,
      });
    }
    return turn;
  }
}
