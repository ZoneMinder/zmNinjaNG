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
import type { AssistantProvider, AssistantMessage, AssistantTurn, ToolDefinition } from '../types';
import { ASSISTANT } from '../../zmninja-ng-constants';
import { log, LogLevel } from '../../logger';
import { getLoadedEngine } from '../model-download';
import { toTokenUsage } from './usage';

/** i18n-free (rule 5): AskPanel resolves this sentinel via `t()`, same as
 *  agent.ts's iteration-cap message. */
const PARSE_ERROR_TEXT = '__i18n:assistant.parse_error';

/** One compact signature line per tool instead of a raw `JSON.stringify` of
 *  its JSON Schema. A 2B on-device model does not reliably parse nested
 *  schema objects, and the full dump for all 16 registry tools costs on the
 *  order of a thousand tokens of a 4096 window on EVERY turn. The argument
 *  names, their types (or enum values, which carry real meaning for inputs
 *  like `range`), and the required/optional distinction are the only parts
 *  the model actually needs; the prose description carries the rest. */
function describeTool(tool: ToolDefinition): string {
  const schema = tool.schema as {
    properties?: Record<string, { type?: string; enum?: readonly unknown[]; items?: { type?: string } }>;
    required?: string[];
  };
  const required = new Set(schema.required ?? []);
  const args = Object.entries(schema.properties ?? {}).map(([name, spec]) => {
    const type = Array.isArray(spec?.enum)
      ? spec.enum.map(String).join('|')
      : spec?.type === 'array'
        // "array" alone leaves the model guessing what goes in it; eventIds is
        // the one that matters, and "string[]" is the whole answer.
        ? `${spec.items?.type ?? 'string'}[]`
        : (spec?.type ?? 'string');
    return `${name}${required.has(name) ? '' : '?'}: ${type}`;
  });
  return `- ${tool.name}(${args.join(', ')}): ${tool.description}`;
}

/** The output-format rule. Deliberately NOT part of the system message: small
 *  models weight recent tokens far more heavily, and after the system rules,
 *  the tool catalog, the few-shot block and the whole history, a format rule
 *  stated at the very top is thousands of tokens away from the point where
 *  generation starts. `buildWebLlmMessages` appends this to the LAST user
 *  message instead, so it is the final thing the model reads. */
const OUTPUT_CONTRACT = [
  'Respond with ONLY a single JSON object and nothing else: no markdown fences, no commentary.',
  'To call a tool: {"tool": "<tool name>", "input": { ... }}',
  'To answer the user: {"answer": "<your reply>"}',
].join('\n');

/** The tool catalog for the system message. Format rules live in
 *  `OUTPUT_CONTRACT`, appended at the generation point instead. */
function buildToolCatalog(tools: ToolDefinition[]): string {
  if (tools.length === 0) return 'You have no tools available. You must answer directly.';
  return ['You may call ONE tool per turn, or answer the user directly. Available tools:', tools.map(describeTool).join('\n')].join('\n');
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
 *  tool result is a `user` message starting with `Tool result:\n`. Keep this
 *  list short: every token here is spent on every single turn. */
function buildFewShotExamples(): ChatCompletionMessageParam[] {
  return [
    { role: 'user', content: 'How many events were recorded today?' },
    { role: 'assistant', content: '{"tool": "count_events", "input": {"interval": "1 day"}}' },
    {
      role: 'user',
      content: 'Tool result:\n[{"monitor":"Front Door","count":12},{"monitor":"Garage","count":3}]',
    },
    {
      role: 'assistant',
      content: '{"answer": "There were 15 events today: 12 on Front Door and 3 on Garage."}',
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
 *  folds in `system` plus the tool catalog above (and, for a Qwen3 model,
 *  the `/no_think` directive; see `isQwen3Model`). Past assistant turns are
 *  re-serialized into the same `{tool,input}` / `{answer}` JSON shape the
 *  model is instructed to produce, so its own history stays consistent with
 *  the contract instead of showing it free-form text it never generated.
 *  A fixed block of `buildFewShotExamples()` turns follows the system
 *  message, demonstrating that exact shape before the real conversation
 *  starts (see its doc comment for why).
 *
 *  `OUTPUT_CONTRACT` is appended to the LAST user message rather than stated
 *  once in the system message, so the format rule is the final thing the
 *  model reads before it generates (see that constant's doc comment). */
export function buildWebLlmMessages(
  system: string,
  history: AssistantMessage[],
  tools: ToolDefinition[],
  modelId: string,
  includeFewShot = true,
  disableThinking = true,
): ChatCompletionMessageParam[] {
  const systemContent = `${system}\n\n${buildToolCatalog(tools)}${disableThinking && isQwen3Model(modelId) ? '\n\n/no_think' : ''}`;
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemContent },
    ...(includeFewShot ? buildFewShotExamples() : []),
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
        messages.push({ role: 'user', content: `Tool result:\n${body}` });
      }
    }
  }

  // The format rule goes on the last user message only: repeating it on every
  // intermediate tool result spent tokens restating something the model had
  // already followed, and the copy that matters is the one nearest generation.
  const last = messages[messages.length - 1];
  if (last?.role === 'user') {
    last.content = `${String(last.content ?? '')}\n\n${OUTPUT_CONTRACT}`;
  } else {
    messages.push({ role: 'user', content: OUTPUT_CONTRACT });
  }

  return messages;
}

/** Strips a reasoning model's chain-of-thought from `content` before JSON
 *  extraction runs.
 *
 *  Keyed on the CLOSING `</think>`, not the opening tag: Qwen3.5 under MNN
 *  emits an unbalanced block, because its chat template puts the opening
 *  `<think>` into the generation prompt itself when thinking is enabled. The
 *  model therefore starts generating mid-thought and the only tag in its
 *  output is the closer. Keying on `<think>` meant nothing was stripped at
 *  all for that model, and the reasoning prose then reached the JSON
 *  extractor, which happily matched a brace pair inside it (the model likes
 *  to write out `call list_events with {"range":"today"}` while planning).
 *
 *  If `<think>` opens but never closes (generation cut short by max tokens),
 *  the tail from `<think>` onward is dropped: it is scratch-work, not a reply. */
function stripThinkBlock(content: string): string {
  const closeTag = '</think>';
  const closeIndex = content.indexOf(closeTag);
  const openIndex = content.indexOf('<think>');

  if (closeIndex !== -1) {
    const head = openIndex !== -1 && openIndex < closeIndex ? content.slice(0, openIndex) : '';
    return head + content.slice(closeIndex + closeTag.length);
  }
  return openIndex === -1 ? content : content.slice(0, openIndex);
}

function extractJsonPayload(content: string): string {
  // Some models wrap JSON in a markdown fence despite being told not to;
  // strip it before parsing rather than failing the whole turn over it.
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

/** Qwen3 MNN occasionally appends one extra quote before a final object
 *  brace (`{"answer":"...""}`). Recover that exact, otherwise complete,
 *  response without accepting arbitrary malformed JSON. */
function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch (error) {
    const repaired = content.replace(/""(\s*})$/, '"$1');
    if (repaired === content) throw error;
    return JSON.parse(repaired);
  }
}

/** Every balanced top-level `{...}` object substring in `content`, in order.
 *  Small on-device models wrap the JSON reply in prose ("Sure, here you go:
 *  {...} let me know if that helps") despite the "ONLY a single JSON object"
 *  instruction, so the embedded object has to be recovered rather than
 *  failing the whole turn over the surrounding text.
 *
 *  ALL of them, not just the first: a reasoning model writes brace-y text
 *  while planning ("call list_events with {"range":"today"}"), so the first
 *  balanced object in a reply is regularly a fragment quoted mid-thought and
 *  the real reply is further along. `parseWebLlmTurn` picks the first
 *  candidate that actually matches the contract instead of committing to
 *  whichever one came first.
 *
 *  Brace-counts rather than regex-matching to the last `}` so a `}` inside a
 *  JSON string value doesn't truncate a match early. */
function extractBalancedJsonObjects(content: string): string[] {
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      if (depth > 0) inString = true;
    } else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0) objects.push(content.slice(start, i + 1));
    }
  }

  return objects;
}

/** The parsed value as an `AssistantTurn`, or `undefined` if it matches
 *  neither contract shape. Used to sift the candidates above. */
function toTurn(parsed: unknown): AssistantTurn | undefined {
  if (parsed === null || typeof parsed !== 'object') return undefined;
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.tool === 'string') {
    const input = obj.input !== null && typeof obj.input === 'object' ? (obj.input as Record<string, unknown>) : {};
    return { toolCalls: [{ id: crypto.randomUUID(), name: obj.tool, input }] };
  }
  if (typeof obj.answer === 'string') return { text: obj.answer, toolCalls: [] };
  return undefined;
}

/**
 * Whether `text` is a plain-language reply the model meant as its answer,
 * rather than a failed attempt at the JSON envelope.
 *
 * The rule is the absence of any `{`. A model that wrote a brace was trying to
 * follow the contract and got it wrong, so that is worth re-rolling; a model
 * that wrote none decided this question needed no tool and no structure, and
 * re-rolling only pressures it into inventing one.
 *
 * That pressure was real: asked "Hello", the model correctly answered "Hello!
 * How can I help you today?", which the parser rejected for lacking the
 * envelope. The retry then "complied" by calling list_monitors, so a greeting
 * fetched every camera and filled the panel with thumbnails. Taking the first
 * answer at face value avoids the retry, the spurious tool call, and roughly
 * 20 seconds of on-device generation spent failing the same way three times.
 *
 * `openai.ts` already did exactly this with the same parser output; this makes
 * the on-device path agree with it rather than hard-failing where Ollama did not.
 */
function looksLikePlainAnswer(text: string): boolean {
  return text.length > 0 && !text.includes('{') && /\p{L}/u.test(text);
}

/** Parses one `chat.completions.create` response's message content into an
 *  `AssistantTurn`. Never throws: malformed or unrecognized JSON degrades to
 *  a fallback apology turn with no tool calls, so a single bad generation
 *  doesn't crash the agent loop (agent.ts pushes this turn as-is and stops,
 *  same as any other answer-only turn). A reasoning model's `<think>` block
 *  is stripped first (see `stripThinkBlock`) so its scratch-work never gets
 *  mistaken for the final JSON reply.
 *
 *  A reply that never attempted the JSON envelope is taken at face value as
 *  the answer; see `looksLikePlainAnswer`. */
export function parseWebLlmTurn(content: string): AssistantTurn {
  const stripped = stripThinkBlock(content);

  // The whole (fence-stripped) reply first, since a well-behaved model sends
  // exactly that; then each embedded object, for a reply wrapped in prose.
  // The first candidate that matches the contract wins, so a brace pair the
  // model wrote mid-sentence is skipped rather than accepted as the answer.
  for (const candidate of [extractJsonPayload(stripped), ...extractBalancedJsonObjects(stripped)]) {
    let parsed: unknown;
    try {
      parsed = parseJson(candidate);
    } catch {
      continue;
    }
    const turn = toTurn(parsed);
    if (turn) return turn;
  }

  const plain = extractJsonPayload(stripped).trim();
  if (looksLikePlainAnswer(plain)) return { text: plain, toolCalls: [] };

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

    // Retry a degenerate/unparseable reply rather than apologizing on the first
    // one: small models sometimes emit an empty code fence or non-JSON, and
    // because sampling is non-deterministic (temperature > 0) a fresh attempt
    // usually recovers. The last attempt's turn (with its `raw` content) is
    // what surfaces if none parse (refs #246).
    let turn: AssistantTurn = { text: PARSE_ERROR_TEXT, toolCalls: [] };
    for (let attempt = 1; attempt <= ASSISTANT.webllmMaxAttempts; attempt++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      log.assistant('Sending WebLLM chat completion request', LogLevel.DEBUG, {
        modelId: this.modelId,
        messageCount: chatMessages.length,
        attempt,
      });

      const response = await engine.chat.completions.create({
        messages: chatMessages,
        max_tokens: ASSISTANT.maxTokens,
      });

      const content = response.choices[0]?.message?.content ?? '';
      log.assistant('WebLLM raw response', LogLevel.DEBUG, { modelId: this.modelId, content, attempt });

      turn = parseWebLlmTurn(content);
      turn.usage = toTokenUsage(response.usage);
      if (turn.text !== PARSE_ERROR_TEXT) return turn;

      // WARN (not DEBUG) so a parse failure is easy to spot without cranking the
      // log level: the raw text sits right above the retry decision.
      log.assistant('WebLLM response failed to parse; retrying if attempts remain', LogLevel.WARN, {
        modelId: this.modelId,
        content,
        attempt,
        maxAttempts: ASSISTANT.webllmMaxAttempts,
      });
    }
    return turn;
  }
}
