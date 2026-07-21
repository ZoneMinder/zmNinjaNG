/**
 * On-device WebLLM adapter (refs #246)
 *
 * Small on-device models are unreliable at WebLLM's native function-calling
 * protocol, so this adapter never uses `ChatCompletionRequest.tools`. Instead
 * every turn is constrained with a system-prompt instruction to reply with
 * exactly one of two JSON shapes: `{"tool": "<name>", "input": {...}}` for
 * one tool call, or `{"answer": "<text>"}` to answer directly.
 *
 * Generation is additionally CONSTRAINED to the envelope schema via
 * `response_format: { type: 'json_object', schema }`. The schema string is
 * mandatory: in `@mlc-ai/web-llm@0.2.84`, `json_object` mode routes into the
 * XGrammar JSON-schema compiler (`GrammarCompiler.CompileJSONSchema`), which
 * expects a schema STRING and throws a WASM `BindingError: Cannot pass
 * non-string to std::string` without one, crashing every chat turn. Because
 * that compiler has crashed before, the constraint is belt-and-braces: if the
 * engine rejects it at runtime the adapter falls back to prompt + parser for
 * the rest of the session (see `grammarUsable`) instead of failing turns.
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
import type { AssistantProvider, AssistantMessage, AssistantTurn, CompletionResult, ToolDefinition } from '../types';
import { ASSISTANT } from '../../zmninja-ng-constants';
import { log, LogLevel } from '../../logger';
import { getLoadedEngine } from '../model-download';
import { toTokenUsage } from './usage';
import { captureExchange } from '../exchange';

/** i18n-free (rule 5): AskPanel resolves this sentinel via `t()`, same as
 *  agent.ts's iteration-cap message. */
const PARSE_ERROR_TEXT = '__i18n:assistant.parse_error';

/** One compact signature line per tool instead of a raw `JSON.stringify` of
 *  its JSON Schema. A 2B on-device model does not reliably parse nested
 *  schema objects, and the full dump for every registry tool costs hundreds
 *  of tokens of a 4096 window on EVERY turn. The argument
 *  names, their types (or enum values, which carry real meaning for inputs
 *  like `range`), and the required/optional distinction are the only parts
 *  the model actually needs; the prose description carries the rest. */
function describeTool(tool: ToolDefinition): string {
  const schema = tool.schema as {
    properties?: Record<string, { type?: string | string[]; enum?: readonly unknown[]; items?: { type?: string } }>;
    required?: string[];
  };
  const required = new Set(schema.required ?? []);
  const describeType = (spec: { type?: string | string[]; enum?: readonly unknown[]; items?: { type?: string } }): string => {
    if (Array.isArray(spec?.enum)) return spec.enum.map(String).join('|');
    // "array" alone leaves the model guessing what goes in it; eventIds is the
    // one that matters, and "string[]" is the whole answer. A property
    // accepting several types (objectType) shows all of them, or the envelope
    // paths are told "string" while the prompt asks for a list.
    const one = (t: string) => (t === 'array' ? `${spec.items?.type ?? 'string'}[]` : t);
    if (Array.isArray(spec?.type)) return spec.type.map(one).join('|');
    return one(spec?.type ?? 'string');
  };
  const args = Object.entries(schema.properties ?? {}).map(
    ([name, spec]) => `${name}${required.has(name) ? '' : '?'}: ${describeType(spec)}`,
  );
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

/** Appended (with the failed reply) before a parse retry, so the retry knows
 *  what it did wrong instead of being re-rolled blind. At temperature 0 a
 *  blind retry returns the identical broken text; naming the fault changes
 *  the prompt, which is what actually moves a greedy sampler. */
const SELF_REPAIR_PROMPT = `Your last reply was not one valid JSON object, so it could not be used. Send it again, corrected.\n${OUTPUT_CONTRACT}`;

/** The two contract shapes as one JSON Schema, handed to XGrammar so the
 *  sampler literally cannot produce prose around the JSON, a markdown fence,
 *  or a third shape. The parser cascade stays: it is the fallback for a
 *  runtime where the grammar compiler is unusable (see `grammarUsable`). */
const ENVELOPE_SCHEMA = JSON.stringify({
  anyOf: [
    {
      type: 'object',
      properties: { tool: { type: 'string' }, input: { type: 'object' } },
      required: ['tool', 'input'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false,
    },
  ],
});

/** Whether this session's engine accepts schema-constrained generation. Flips
 *  false on the first rejection and stays false: the failure mode is a WASM
 *  throw on EVERY constrained call (see the module header), so retrying the
 *  constraint each turn would pay the crash once per turn for nothing. */
let grammarUsable = true;

/** Test-only: the flag above is module state and vitest re-imports modules per
 *  file, not per test. */
export function resetGrammarUsableForTests(): void {
  grammarUsable = true;
}

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
 *  The example's DATA must never look like it could be real. This block used
 *  plausible monitor names ("Front Door", "Garage") with plausible counts, and
 *  llama3.2 answered "summarize today" with "There were 12 events on Front
 *  Door, and 3 events on Garage today": the example's own numbers, presented
 *  as this installation's data, without calling a tool at all. Hence the
 *  shouty placeholder names, counts too small to look like a real day, and the
 *  disclaimer turn that follows: a name the user could actually own must never
 *  appear here, both because the model repeats it and because seeing an
 *  invented camera named like one of theirs is indistinguishable from a bug.
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
      content: 'Tool result:\n[{"monitor":"EXAMPLE_MONITOR_A","count":2},{"monitor":"EXAMPLE_MONITOR_B","count":1}]',
    },
    {
      role: 'assistant',
      content: '{"answer": "There were 3 events today: 2 on EXAMPLE_MONITOR_A and 1 on EXAMPLE_MONITOR_B."}',
    },
    {
      role: 'user',
      content:
        'The exchange above is a FORMAT EXAMPLE. EXAMPLE_MONITOR_A and EXAMPLE_MONITOR_B are not real ' +
        'monitors and those counts are not real data. Never repeat any name or number from it. This ' +
        'installation\'s real monitors come only from list_monitors, and real counts only from a tool result ' +
        'in this conversation.',
    },
    { role: 'assistant', content: '{"answer": "Understood. I will use only real tool results."}' },
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
 *  Keyed on the CLOSING `</think>`, not the opening tag: some reasoning models
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

/** The reasoning a model emitted before its reply, or undefined if it emitted
 *  none. Discarded from the answer by `stripThinkBlock`, but kept so the panel
 *  can show what the model was doing during a turn that makes several round
 *  trips: without it the UI has nothing to say but "Thinking" while the logs
 *  are full of the model's actual working. */
function extractReasoning(content: string): string | undefined {
  const closeIndex = content.indexOf('</think>');
  const openIndex = content.indexOf('<think>');
  // Some reasoning models emit only the closing tag: the template opens it in
  // the prompt, so reasoning runs from the start of the reply to `</think>`.
  const start = openIndex !== -1 && (closeIndex === -1 || openIndex < closeIndex) ? openIndex + '<think>'.length : 0;
  const end = closeIndex === -1 ? content.length : closeIndex;
  if (closeIndex === -1 && openIndex === -1) return undefined;
  const reasoning = content.slice(start, end).trim();
  return reasoning.length > 0 ? reasoning : undefined;
}

function extractJsonPayload(content: string): string {
  // Some models wrap JSON in a markdown fence despite being told not to;
  // strip it before parsing rather than failing the whole turn over it.
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

/** A small model occasionally appends one extra quote before a final object
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

/** Every `{"tool": ...}` object embedded anywhere in `content`, balanced from
 *  its own opening brace instead of from the top level.
 *
 *  Once a tool result lands in the history, gemma-2-2b re-emits the call it
 *  already made wrapped in the answer shape:
 *  `{"answer": "{"tool": "list_events", "input": {...}}"}`, sometimes with the
 *  inner object inside a code fence as well. Those inner quotes are not
 *  escaped, so the reply is invalid JSON at every level: neither
 *  `extractJsonPayload` nor `extractBalancedJsonObjects` yields anything
 *  parseable and all three attempts burn on the same shape before the turn
 *  dies with a parse error. The inner object alone IS valid JSON, so
 *  recovering it turns a dead turn into the call the model meant, which the
 *  duplicate-call guard in `agent.ts` then answers out of the results already
 *  in hand.
 *
 *  Searched only after the well-formed candidates, so a genuine answer that
 *  quotes an envelope (`{"answer": "call {\"tool\": ...} to list them"}`)
 *  parses as the answer it is and never reaches here. */
function extractToolEnvelopes(content: string): string[] {
  const envelopes: string[] = [];
  for (const match of content.matchAll(/\{\s*"tool"\s*:/g)) {
    const object = balancedObjectAt(content, match.index);
    if (object) envelopes.push(object);
  }
  return envelopes;
}

/** The balanced `{...}` substring starting at `start`, or `undefined` if the
 *  braces never close. String-aware for the same reason
 *  `extractBalancedJsonObjects` is: a `}` inside a value must not end it. */
function balancedObjectAt(content: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < content.length; i++) {
    const ch = content[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return content.slice(start, i + 1);
    }
  }

  return undefined;
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
  if (typeof obj.answer === 'string') {
    // The same confusion as `extractToolEnvelopes` describes, but with the
    // inner quotes escaped, so the reply parses and the tool call would
    // otherwise be shown to the user as raw JSON prose.
    const nested = tryParseTurn(obj.answer);
    if (nested?.toolCalls.length) return nested;
    return { text: obj.answer, toolCalls: [] };
  }
  // Qwen's own tool-call template: `{"name": ..., "arguments": {...}}`,
  // usually wrapped in <tool_call> tags. Observed live through Ollama when
  // the server-side template failed to parse it into native tool_calls: the
  // shape then arrived as CONTENT, and printing it as an answer showed the
  // user raw XML (refs #264). It names a call as unambiguously as the
  // contract shape does, so honor it.
  if (typeof obj.name === 'string' && (obj.arguments === undefined || (obj.arguments !== null && typeof obj.arguments === 'object'))) {
    return { toolCalls: [{ id: crypto.randomUUID(), name: obj.name, input: (obj.arguments ?? {}) as Record<string, unknown> }] };
  }
  return undefined;
}

/** `toTurn(JSON.parse(text))` without the throw, for the nested case above. */
function tryParseTurn(text: string): AssistantTurn | undefined {
  try {
    return toTurn(parseJson(extractJsonPayload(text)));
  } catch {
    return undefined;
  }
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
  const reasoning = extractReasoning(content);

  // The whole (fence-stripped) reply first, since a well-behaved model sends
  // exactly that; then each embedded object, for a reply wrapped in prose.
  // The first candidate that matches the contract wins, so a brace pair the
  // model wrote mid-sentence is skipped rather than accepted as the answer.
  for (const candidate of [
    extractJsonPayload(stripped),
    ...extractBalancedJsonObjects(stripped),
    ...extractToolEnvelopes(stripped),
  ]) {
    let parsed: unknown;
    try {
      parsed = parseJson(candidate);
    } catch {
      continue;
    }
    const turn = toTurn(parsed);
    if (turn) return { ...turn, reasoning };
  }

  const plain = extractJsonPayload(stripped).trim();
  if (looksLikePlainAnswer(plain)) return { text: plain, toolCalls: [], reasoning };

  return { text: PARSE_ERROR_TEXT, toolCalls: [], raw: content, reasoning };
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

  private readonly temperature: number;

  constructor(modelId: string, temperature?: number) {
    this.modelId = modelId;
    this.temperature = temperature ?? ASSISTANT.assistantTemperature;
    this.contextWindow = ASSISTANT.webllmModels.find((m) => m.id === modelId)?.contextWindowSize;
  }

  /** One completion, schema-constrained when a schema is given and the engine
   *  accepts it. Falls back to unconstrained generation the first time the
   *  grammar compiler rejects a request, and remembers that for the session:
   *  the parser cascade then carries the contract alone, as it always did. */
  private async createCompletion(
    engine: Awaited<ReturnType<typeof getLoadedEngine>>,
    messages: ChatCompletionMessageParam[],
    temperature: number,
    schema?: string,
  ) {
    // The REAL Qwen3 no-think switch: web-llm pre-closes an empty <think/>
    // block in the reply, so the model cannot reason at all. The /no_think
    // directive in the system message (buildWebLlmMessages) is only the soft
    // form; measured on Ollama it hides the tag without skipping the
    // reasoning. Ignored by non-Qwen3 models.
    const extraBody = isQwen3Model(this.modelId) ? { extra_body: { enable_thinking: false } } : {};
    if (schema && grammarUsable) {
      try {
        return await engine.chat.completions.create({
          messages,
          max_tokens: ASSISTANT.maxTokens,
          temperature,
          response_format: { type: 'json_object', schema },
          ...extraBody,
        });
      } catch (error) {
        grammarUsable = false;
        log.assistant('WebLLM rejected schema-constrained generation; prompt-only for this session', LogLevel.WARN, {
          modelId: this.modelId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return engine.chat.completions.create({ messages, max_tokens: ASSISTANT.maxTokens, temperature, ...extraBody });
  }

  /** Runs `work` with the abort signal wired to `engine.interruptGenerate()`.
   *  Without this an in-flight generation ran to completion regardless of the
   *  Abort button: the loop only ever checked the signal BETWEEN attempts, so
   *  a slow on-device turn could not actually be stopped. Interrupting makes
   *  the pending `create` resolve early (with partial text); the caller's own
   *  `signal.aborted` check then turns that into an AbortError. */
  private async withInterrupt<T>(
    engine: Awaited<ReturnType<typeof getLoadedEngine>>,
    signal: AbortSignal,
    work: () => Promise<T>,
  ): Promise<T> {
    const onAbort = () => {
      try {
        engine.interruptGenerate();
      } catch {
        // Nothing generating right now; the aborted-signal checks still stop the turn.
      }
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      return await work();
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  /** Bare system + user, deliberately bypassing `buildWebLlmMessages`: no tool
   *  catalog, no few-shot, no OUTPUT_CONTRACT. See `AssistantProvider`. */
  async complete(system: string, text: string, signal: AbortSignal, jsonSchema?: Record<string, unknown>): Promise<CompletionResult> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const engine = await getLoadedEngine(this.modelId);
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
      { role: 'user', content: text },
    ];
    const startedAt = Date.now();
    const response = await this.withInterrupt(engine, signal, () =>
      this.createCompletion(engine, messages, this.temperature, jsonSchema ? JSON.stringify(jsonSchema) : undefined),
    );
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    // `stripThinkBlock` via parseWebLlmTurn is not used here: the caller wants
    // the raw words, and a reasoning model's block is handled by the caller's
    // own keyword matching.
    const content = response.choices[0]?.message?.content ?? '';
    return {
      text: content,
      exchange: captureExchange({ backend: 'webllm', model: this.modelId, sent: messages, received: content, startedAt }),
    };
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
    // one: small models sometimes emit an empty code fence or non-JSON. The
    // retry is a SELF-REPAIR, not a blind re-roll: the failed reply plus a
    // correction naming the fault are appended, so even the greedy first
    // temperature (0, measured best for accuracy) produces a different
    // generation. The final attempt also raises the temperature, in case the
    // model is stuck on the same broken shape regardless of the correction.
    // The last attempt's turn (with its `raw` content) is what surfaces if
    // none parse (refs #246).
    let turn: AssistantTurn = { text: PARSE_ERROR_TEXT, toolCalls: [] };
    for (let attempt = 1; attempt <= ASSISTANT.maxParseAttempts; attempt++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      log.assistant('Sending WebLLM chat completion request', LogLevel.DEBUG, {
        modelId: this.modelId,
        messageCount: chatMessages.length,
        attempt,
      });

      const startedAt = Date.now();
      const response = await this.withInterrupt(engine, signal, () =>
        this.createCompletion(
          engine,
          chatMessages,
          // Raises whatever was configured rather than replacing it, so a user
          // who chose a higher temperature does not get a LOWER one on retry.
          attempt < ASSISTANT.maxParseAttempts
            ? this.temperature
            : Math.max(this.temperature, ASSISTANT.assistantRetryTemperature),
          ENVELOPE_SCHEMA,
        ),
      );
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      const content = response.choices[0]?.message?.content ?? '';
      log.assistant('WebLLM raw response', LogLevel.DEBUG, { modelId: this.modelId, content, attempt });

      // Named here or it is invisible: nothing downstream can tell a complete
      // reply from one that stopped mid-sentence, and a cut-off JSON envelope
      // simply fails to parse, which reads as the model being incapable rather
      // than out of budget. The Ollama path already reported this.
      if (response.choices[0]?.finish_reason === 'length') {
        log.assistant('WebLLM reply hit the token cap and was truncated', LogLevel.WARN, {
          modelId: this.modelId,
          maxTokens: ASSISTANT.maxTokens,
          attempt,
        });
      }

      turn = parseWebLlmTurn(content);
      turn.usage = toTokenUsage(response.usage);
      // Captured on every attempt, including the ones that fail to parse: a
      // retried turn is exactly when the transcript matters, and the last
      // attempt's capture is the one that survives on `turn`.
      turn.exchange = captureExchange({
        backend: 'webllm',
        model: this.modelId,
        sent: chatMessages,
        received: content,
        startedAt,
      });
      if (turn.text !== PARSE_ERROR_TEXT) return turn;

      // WARN (not DEBUG) so a parse failure is easy to spot without cranking the
      // log level: the raw text sits right above the retry decision.
      log.assistant('WebLLM response failed to parse; retrying if attempts remain', LogLevel.WARN, {
        modelId: this.modelId,
        content,
        attempt,
        maxAttempts: ASSISTANT.maxParseAttempts,
      });
      // The self-repair context the next attempt sees: what came back, and why
      // it was unusable. Accumulates across attempts on purpose, so the model
      // never loses sight of a shape it already tried and failed with.
      chatMessages.push({ role: 'assistant', content });
      chatMessages.push({ role: 'user', content: SELF_REPAIR_PROMPT });
    }
    return turn;
  }
}
