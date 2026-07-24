/**
 * Apple Foundation Models adapter (via the Capacitor `AppleIntelligence`
 * bridge, refs #270)
 *
 * Structurally a trimmed `providers/native-llm.ts`: the message assembly and
 * parsing are reused from `providers/webllm.ts` (`buildWebLlmMessages`,
 * `parseWebLlmTurn`), driving the same JSON turn shape over a different
 * transport. The INSTRUCTIONS are the part not reused: this backend constrains
 * generation with a schema, so the few-shot block and the textual output
 * contract are switched off, and the prompt itself is rebuilt to Apple's
 * Foundation Models guidance (see `buildAppleInstructions`). Unlike the native
 * bridge, the OS owns the model: there is no download, no KV cache slot and no
 * weight-load/prefill status stream, so those concerns are simply absent here.
 */
import type {
  AssistantProvider,
  AssistantMessage,
  AssistantStatus,
  AssistantTurn,
  CompletionResult,
  ExecutedToolCall,
  ToolDefinition,
} from '../types';
import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm';
import { ASSISTANT } from '../../zmninja-ng-constants';
import { log, LogLevel } from '../../logger';
import { Platform } from '../../platform';
import { NO_TOOL_INSTRUCTIONS } from '../triage';
import { buildWebLlmMessages, parseWebLlmTurn, PARSE_ERROR_TEXT } from './webllm';
import { captureExchange } from '../exchange';
import { MODEL_NOT_AVAILABLE_MESSAGE } from '../model-download';

/** Thrown when this provider is constructed off a supporting platform (web,
 *  Electron, Android): the `AppleIntelligence` bridge only exists in the iOS
 *  build. Deliberately the SAME message the native/WebLLM missing-model cases
 *  throw so AskPanel's existing `PROVIDER_NOT_AVAILABLE_MESSAGE` check
 *  ("not configured, go to Settings") covers this case too, with no separate UI
 *  path (refs #270, same reasoning as native-llm.ts's own constant). */
export const APPLE_INTELLIGENCE_NOT_AVAILABLE_MESSAGE = MODEL_NOT_AVAILABLE_MESSAGE;

/** The turn contract expressed as a JSON Schema for the plugin's constrained
 *  decoder, so the reply EXACTLY matches one of the shapes `parseWebLlmTurn`
 *  accepts. Unlike WebLLM's fixed `ENVELOPE_SCHEMA`, the tool branch is
 *  specialized per registered tool: the name is pinned with `enum` and the
 *  real `input` schema is inlined, so the model cannot invent a tool name or
 *  malformed arguments.
 *
 *  Constrained decoding is what kills the observed Foundation Models failures:
 *  an answer emitted as a bare number, malformed JSON, and invented tool args
 *  all become structurally impossible. A tool-less turn gets the answer-only
 *  schema, so a tool call cannot be produced where there is no tool to call.
 *
 *  `hasToolResult` is the mirror image of that, and the reason it exists: a
 *  chat-trained model offered an answer branch prefers it, and Foundation
 *  Models was observed answering a data question straight out of that branch
 *  with fabricated counts ("15 events today, 10 yesterday") while no tool ran.
 *  Prose nudges do not move this model, so the branch is simply removed until
 *  real data exists in the turn: with tools registered and no tool result yet,
 *  the schema offers ONLY the tool branches, which makes an ungrounded answer
 *  structurally impossible instead of merely discouraged. Once a tool result is
 *  present the answer branch comes back, so the model can report what it read.
 *
 *
 *  Shapes mirror the TOP-LEVEL contract (`{"answer": "..."}` /
 *  `{"tool": "<name>", "input": {...}}`) that history re-serialization in
 *  `buildWebLlmMessages` uses, so the constrained output flows through
 *  `parseWebLlmTurn`'s primary path and stays consistent with the assistant
 *  turns already in the prompt. Disjoint required keys
 *  (`answer` vs `tool`) also make the `anyOf` trivial for the decoder to
 *  discriminate.
 *
 *  This path is the FALLBACK now that the tool loop runs natively (see
 *  `chat`), and it carries no `reasoning` property any more: a leading
 *  free-text field was implicated in the intermittent "Failed to deserialize a
 *  Generable type" rejections (it is the one field whose length the decoder
 *  cannot bound), and it only ever conditioned the model, since the parser
 *  ignored it (refs #270). */
function buildTurnSchema(tools: ToolDefinition[], hasToolResult: boolean): string {
  const answerSchema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] };
  if (tools.length === 0) return JSON.stringify(answerSchema);
  const toolSchemas = tools.map((tool) => ({
    type: 'object',
    properties: { tool: { enum: [tool.name] }, input: tool.schema },
    required: ['tool', 'input'],
  }));
  // Tools registered but nothing fetched yet: tool branches only. A single tool
  // needs no `anyOf` wrapper (the Swift converter takes a bare object schema).
  if (!hasToolResult) return JSON.stringify(toolSchemas.length === 1 ? toolSchemas[0] : { anyOf: toolSchemas });
  return JSON.stringify({ anyOf: [answerSchema, ...toolSchemas] });
}

/** The lines of `buildSystemPrompt` that carry INSTALL-SPECIFIC facts: today's
 *  date and timezone, the ZoneMinder version, the answer locale, and the
 *  detected-object vocabulary. Everything else in that prompt is model-neutral
 *  prose tuned against the qwen evals, which `buildAppleInstructions` restates
 *  in a form Foundation Models can actually follow; these four cannot be
 *  restated, because only the caller knows them.
 *
 *  Matched on a stable phrase of each line rather than by position, and the
 *  test suite asserts every one of them survives a real `buildSystemPrompt`
 *  output, so a reworded prompt fails a test instead of silently dropping a
 *  fact the tools depend on. */
const DYNAMIC_FACT_MARKERS = ["Today's date is", 'ZoneMinder version:', 'locale code:', 'Detected object labels'];

/** The first sentence of a tool description. Apple's guidance is few tools with
 *  SHORT descriptions; the registry's are three to six sentences long, written
 *  for models that reward exhaustive prose, and pasting all nine of them costs
 *  more of this small window than the whole rest of the instructions. The lead
 *  sentence is the one that says what the tool does; the rest is guard rails the
 *  turn schema now enforces structurally. Full descriptions stay in use on every
 *  other backend.
 *
 *  An abbreviation is not a sentence end: `navigate`'s description says "(e.g.
 *  /events/42)" and splitting there left the model the fragment "Navigate the
 *  app to a specific in-app path (e.g.". A "x.y." abbreviation is recognized by
 *  the period two characters back. */
function firstSentence(description: string): string {
  for (let end = description.indexOf('. '); end !== -1; end = description.indexOf('. ', end + 1)) {
    if (description[end - 2] !== '.') return description.slice(0, end + 1);
  }
  return description;
}

/** The arguments of a native tool call, read defensively off the event: the
 *  framework hands them over as a JSON string, and anything that is not an
 *  object becomes an empty input. That is deliberately not an exception: the
 *  agent's own validation then rejects the call with a message the model can
 *  correct from, whereas a throwing listener would leave the native session
 *  waiting for a result that never comes (refs #270). */
function parseToolArguments(argumentsJson: string, toolName: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson || '{}');
  } catch {
    parsed = undefined;
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  log.assistant('Apple Intelligence tool call arguments were not a JSON object', LogLevel.WARN, { toolName, argumentsJson });
  return {};
}

/** Handed back in place of a tool result once a native turn has spent its call
 *  budget (`ASSISTANT.appleNativeToolCallBudget`). Terminal on purpose: it does
 *  not describe a fixable fault, because the model that reaches it is retrying
 *  variants of a call that already worked, so the only useful instruction is to
 *  stop and answer from what it has. */
const TOOL_BUDGET_EXHAUSTED_TEXT = 'Tool budget for this turn is exhausted. Answer now from the results you already have.';

/** The behavioural rules a tool-carrying turn gets, each one a measured failure
 *  of this backend restated as a short imperative. Shared by both tool paths:
 *  the framework's native tool loop enforces the CALL shape, never what the
 *  model may say about a result. */
const TOOL_TURN_RULES = [
  'You must only read data and navigate. Say plainly that you cannot arm, disarm, change run state, or delete anything, and name the screen that can: Monitors, Server, or the event itself.',
  'Copy the person\'s own time words into list_events\' `when`, verbatim and in their language ("yesterday", "letzte Woche"). Never compute a date or a timestamp yourself.',
  'A summary, recap, or comparison names no thing, so it must carry NO objectType. Only a question naming people, cars, animals, or packages takes objectType, and it must use list_events.',
  'Quote the result\'s summary line, matchCount, and countsByMonitor exactly. Never tally rows yourself.',
  'Greetings and thanks get one short, warm sentence.',
  'When your answer is about particular rows rather than all of them, end it with one line: SHOW: events=<ids> monitors=<ids>',
];

/** The instruction block for this backend, in place of the shared system prompt
 *  plus WebLLM's tool catalog (refs #270).
 *
 *  Apple documents what Foundation Models responds to: a "You are ..." persona
 *  that also says who the user is, a few short paragraphs in the imperative,
 *  emphasis words, short examples INSIDE the instructions, and the single most
 *  important rule repeated at the end. It also documents what it does badly:
 *  long prompts. The shared prompt is neither, by design (it is tuned for the
 *  Ollama and WebLLM models against the eval harness), so this composes an
 *  FM-native block instead of forwarding it: the caller's dynamic facts are
 *  carried verbatim (see `DYNAMIC_FACT_MARKERS`), and its measured behavioural
 *  rules are restated as short imperatives. Measured on the standard fixture:
 *  well under half the characters of the prompt it replaces.
 *
 *  The examples are tool calls only, never an answer with data in it: an
 *  example answer carrying plausible counts was repeated verbatim as this
 *  installation's data on the WebLLM path (see `buildFewShotExamples`), and the
 *  EXAMPLE_ prefix keeps the one placeholder id unmistakable. */
function buildAppleInstructions(system: string, tools: ToolDefinition[], nativeTools = false): string {
  const facts = system.split('\n').filter((line) => DYNAMIC_FACT_MARKERS.some((marker) => line.includes(marker)));
  // The tool-less turn's whole routing decision (triage said chat or action),
  // carried over verbatim rather than restated: without it a CHAT turn lost the
  // scope refusal and an ACTION turn lost the "name the screen that can do it"
  // instruction, which are the only guidance those turns get (refs #270).
  const policy = Object.values(NO_TOOL_INSTRUCTIONS).find((text) => system.includes(text)) ?? '';
  const toolBlock =
    tools.length === 0
      ? 'You have no tools this turn. Answer the person directly.'
      : [
          // Native tool calling: the framework picks the calls from the schemas
          // it was handed, so a catalog here would be a second, drifting copy of
          // them, and the JSON turn examples would teach a shape this path never
          // produces. The behavioural rules are what remains ours to state.
          nativeTools
            ? 'Call a tool whenever the answer needs data from this system, then answer in plain sentences.'
            : [
                'Call ONE tool per turn until you have the data, then answer. Tools:',
                tools.map((tool) => `- ${tool.name}: ${firstSentence(tool.description)}`).join('\n'),
              ].join('\n'),
          '',
          ...TOOL_TURN_RULES,
          ...(nativeTools
            ? []
            : [
                '',
                'Examples of one turn:',
                '{"tool": "count_events", "input": {"lastCount": 24, "lastUnit": "hour"}}',
                '{"tool": "list_events", "input": {"when": "yesterday"}}',
                '{"tool": "get_monitor", "input": {"monitorId": "EXAMPLE_MONITOR_ID"}}',
              ]),
        ].join('\n');
  return [
    'You are Ninjii, an expert assistant for the person\'s ZoneMinder security camera system. The person owns these cameras and asks about their own recordings. Your name is spelled exactly "Ninjii" and never changes.',
    facts.join('\n'),
    policy,
    toolBlock,
    // Apple's closing rule, and the failure this backend actually shows: it
    // answered data questions with invented counts (refs #270).
    'Every fact you state must come from a tool result in this turn. Never invent a count, a name, an id, or a time.',
  ]
    .filter((block) => block !== '')
    .join('\n\n');
}

/** The retry correction for this backend, in place of WebLLM's
 *  `SELF_REPAIR_PROMPT`. That one restates `OUTPUT_CONTRACT`, which is exactly
 *  the format teaching guided generation cannot tolerate (refs #270), and under
 *  a constrained decoder an unparseable reply is nearly impossible anyway: what
 *  is left to correct is an empty or content-free one. Kept neutral so a retry
 *  cannot reintroduce JSON-shaped text into the answer field. */
const APPLE_RETRY_PROMPT = 'Your last reply was empty or unusable. Answer the user\'s question.';

/** True when a rejected `plugin.chat()` is guided generation running out of
 *  window rather than a broken engine: Foundation Models rejects with
 *  ENGINE_FAILED and "Failed to deserialize a Generable type from model output"
 *  when the decode truncates at the context edge mid-JSON. Observed live to be
 *  intermittent and prompt-size dependent, with every schema shape proven valid
 *  by an on-device probe (refs #270), so it is retryable, not fatal. Read off
 *  the mapped error's `cause`, which carries the native rejection verbatim. */
function isTruncatedGeneration(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  const message = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
  return message.toLowerCase().includes('deserialize');
}

/** True when the native side rejected because the prompt no longer fits the
 *  model's context window (`CONTEXT_FULL`). Distinct from
 *  `isTruncatedGeneration`: re-sending the same prompt cannot help, only a
 *  shorter one can. Read off the mapped error's `cause`, which carries the
 *  native rejection with its `code`. */
function isContextFull(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  const code = cause && typeof cause === 'object' && 'code' in cause ? (cause as { code?: unknown }).code : undefined;
  return code === 'CONTEXT_FULL';
}

/** The on-device Apple Foundation Models provider: the OS-managed system model,
 *  driven with the same constrained-JSON contract WebLLM uses (see module
 *  header) instead of reimplementing prompt building or parsing. */
export class AppleIntelligenceProvider implements AssistantProvider {
  private readonly modelId = ASSISTANT.appleIntelligenceModelId;
  private readonly temperature: number;
  /** The model's usable chat window, learned from `isSupported().contextSize` on the first native
   *  call this turn. Undefined until then; `isContextNearlyFull` no-ops on undefined, and it is read
   *  only AFTER a turn's chat has run (AskPanel), by which point it is populated. Instance-scoped: a
   *  fresh provider per turn re-learns it cheaply rather than caching a stale value. */
  private deviceContextWindow?: number;
  get contextWindow(): number | undefined {
    return this.deviceContextWindow;
  }

  constructor(temperature?: number) {
    this.temperature = temperature ?? ASSISTANT.assistantTemperature;
  }

  /** Dynamic import behind a platform check (rule 13): the plugin package is
   *  native-only, so importing it eagerly would pull native bridge code into
   *  the web/Electron bundle for a backend those platforms can never run. */
  private async getPlugin() {
    if (!Platform.isNative) throw new Error(APPLE_INTELLIGENCE_NOT_AVAILABLE_MESSAGE);
    // Namespace, not the plugin object: resolving a promise with Capacitor's
    // registerPlugin proxy makes the runtime probe `.then` as a native method,
    // which rejects as unimplemented while the awaiter hangs forever (refs
    // #270). Callers destructure `AppleIntelligence` AFTER the await.
    return import('../../../plugins/apple-intelligence');
  }

  /** One `plugin.chat()` call, with the abort signal wired to `cancelChat()`.
   *  Mirrors `NativeLlmProvider.withCancel`: the listener asks the native side
   *  to stop generating, and the caller's own `signal.aborted` check (run right
   *  after this resolves, success or failure) turns that into the AbortError
   *  callers expect, regardless of whether cancellation resolved the call or
   *  made it reject. */
  private async withCancel<T>(
    plugin: Awaited<ReturnType<AppleIntelligenceProvider['getPlugin']>>['AppleIntelligence'],
    signal: AbortSignal,
    work: () => Promise<T>,
  ): Promise<T> {
    const onAbort = () =>
      void plugin.cancelChat().catch((error) => log.assistant('Apple Intelligence cancelChat failed', LogLevel.WARN, { error }));
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      return await work();
    } catch (error) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      throw this.mapPluginError(error);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  /** Translates a rejected `plugin.chat()` call into the Error this provider
   *  should throw, keyed on the stable `code` the native side rejects with
   *  (Capacitor copies every key of the native error object, `code` included,
   *  onto the JS exception). CHAT_BUSY gets its own localized `__i18n:` copy
   *  (AskPanel renders any thrown `__i18n:`-prefixed message via `t()`);
   *  everything else falls back to a generic localized message, with the real
   *  reason only in the log - not shown to the user, since it is the native
   *  side's untranslated `localizedDescription`. The `__i18n:` keys are shared
   *  with the native backend (no new strings, both are on-device engines). */
  private mapPluginError(error: unknown): Error {
    const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : undefined;
    if (code === 'CHAT_BUSY') return new Error('__i18n:assistant.native_busy');
    log.assistant('Apple Intelligence chat failed', LogLevel.ERROR, {
      code,
      message: error instanceof Error ? error.message : String(error),
    });
    // `cause` keeps the native rejection reachable without putting it in front of
    // the user: `chat` reads it to tell a retryable truncation apart from a real
    // engine failure (see isTruncatedGeneration).
    return new Error('__i18n:assistant.native_engine_failed', { cause: error });
  }

  /** Learn the usable chat window from `isSupported()` once per provider instance.
   *  Best-effort: on failure `deviceContextWindow` stays undefined (auto-clear simply no-ops). */
  private async ensureDeviceContext(
    plugin: Awaited<ReturnType<AppleIntelligenceProvider['getPlugin']>>['AppleIntelligence'],
  ): Promise<void> {
    if (this.deviceContextWindow !== undefined) return;
    try {
      const r = await plugin.isSupported();
      if (typeof r.contextSize === 'number') this.deviceContextWindow = r.contextSize;
    } catch (error) {
      log.assistant('Apple Intelligence isSupported (contextSize) probe failed', LogLevel.WARN, { error });
    }
  }

  /** Bare system + user, deliberately bypassing `buildWebLlmMessages`: no tool
   *  catalog, no few-shot, no OUTPUT_CONTRACT (mirrors `NativeLlmProvider.complete`).
   *  `jsonSchema`, when given, is forwarded as `schemaJson` so the plugin's
   *  constrained decoder shapes the reply: triage and the window interpreter
   *  finally get always-shaped output on this backend instead of a
   *  usually-right one the caller has to parse defensively. */
  async complete(
    system: string,
    text: string,
    signal: AbortSignal,
    jsonSchema?: Record<string, unknown>,
    _onStatus?: (status: AssistantStatus) => void,
  ): Promise<CompletionResult> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const { AppleIntelligence: plugin } = await this.getPlugin();
    await this.ensureDeviceContext(plugin);
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
      { role: 'user', content: text },
    ];
    const startedAt = Date.now();
    const response = await this.withCancel(plugin, signal, () =>
      plugin.chat({
        messagesJson: JSON.stringify(messages),
        temperature: this.temperature,
        maxTokens: ASSISTANT.maxTokens,
        ...(jsonSchema ? { schemaJson: JSON.stringify(jsonSchema) } : {}),
      }),
    );
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return {
      text: response.content,
      exchange: captureExchange({ backend: 'apple', model: this.modelId, sent: messages, received: response.content, startedAt }),
    };
  }

  /** The native tool loop: Foundation Models owns the iteration (refs #270).
   *
   *  The tool schemas go to the framework, which decides the calls, emits each
   *  one as a `toolCall` event, waits for `resolveToolCall`, and resolves the
   *  chat with PROSE once it has what it needs. So there is no per-call round
   *  trip through the agent loop, no turn schema, and no JSON turn shape to
   *  parse: the model calls tools the way it was trained to, and the guided
   *  path below stays as the fallback for a turn with no tools.
   *
   *  Each call still runs through the agent's own machinery via `runTool`
   *  (duplicate guard, argument repair, schema validation, activity and trace),
   *  so a native turn and a loop turn execute tools identically; the executed
   *  calls ride back on `nativeToolResults` for the transcript and history. */
  private async chatWithNativeTools(
    plugin: Awaited<ReturnType<AppleIntelligenceProvider['getPlugin']>>['AppleIntelligence'],
    messages: AssistantMessage[],
    tools: ToolDefinition[],
    system: string,
    signal: AbortSignal,
    runTool: (name: string, input: Record<string, unknown>) => Promise<ExecutedToolCall>,
  ): Promise<AssistantTurn> {
    const chatMessages = buildWebLlmMessages(buildAppleInstructions(system, tools, true), messages, tools, this.modelId, false, true, false, false);
    const toolsJson = JSON.stringify(
      // Short descriptions, the same first-sentence trim the catalog used
      // (see `firstSentence`): the framework injects these into the window
      // itself, so the registry's full prose would cost what removing the
      // catalog just saved.
      tools.map((tool) => ({ name: tool.name, description: firstSentence(tool.description), schemaJson: JSON.stringify(tool.schema) })),
    );
    const executed: ExecutedToolCall[] = [];
    /** Every call the framework emitted this turn, budgeted or not. */
    let bridgedCalls = 0;
    /** Whether the budget already asked the native session to stop, so the ask
     *  happens once however many calls were already queued behind it. */
    let budgetCancelled = false;

    const onToolCall = async (event: { callId: string; name: string; argumentsJson: string }) => {
      let output: string;
      // Past the budget the call is refused without running: the framework
      // owns this loop, so nothing else here can end a retry storm, and each
      // extra result it fed back was window the answer needed (refs #270).
      const overBudget = ++bridgedCalls > ASSISTANT.appleNativeToolCallBudget;
      if (overBudget) {
        output = TOOL_BUDGET_EXHAUSTED_TEXT;
        log.assistant('Apple Intelligence native tool budget exhausted; refusing the call', LogLevel.WARN, {
          toolName: event.name,
          bridgedCalls,
          budget: ASSISTANT.appleNativeToolCallBudget,
        });
      } else {
        try {
          const result = await runTool(event.name, parseToolArguments(event.argumentsJson, event.name));
          executed.push(result);
          output = result.output;
        } catch (error) {
          // The model reads whatever comes back, so a thrown tool is reported to
          // it as text rather than left to hang the native session.
          output = error instanceof Error ? error.message : String(error);
          log.assistant('Apple Intelligence native tool call threw', LogLevel.ERROR, { toolName: event.name, error: output });
        }
      }
      await plugin
        .resolveToolCall({ callId: event.callId, output })
        .catch((error) => log.assistant('Apple Intelligence resolveToolCall failed', LogLevel.WARN, { error }));
      // Resolved first, so the native session is never left waiting on a call
      // it will be told to abandon a moment later.
      if (overBudget && !budgetCancelled) {
        budgetCancelled = true;
        await plugin.cancelChat().catch((error) => log.assistant('Apple Intelligence cancelChat failed', LogLevel.WARN, { error }));
      }
    };

    const startedAt = Date.now();
    const handle = await plugin.addListener('toolCall', (event) => void onToolCall(event));
    let response: { content: string; promptTokens?: number; completionTokens?: number };
    try {
      response = await this.withCancel(plugin, signal, () =>
        plugin.chat({
          messagesJson: JSON.stringify(chatMessages),
          temperature: this.temperature,
          maxTokens: ASSISTANT.maxTokens,
          toolsJson,
        }),
      );
    } catch (error) {
      // The budget's own cancellation coming back, as CANCELLED or (if the
      // window went over before the stop landed) CONTEXT_FULL. Either way the
      // turn holds real data, so it returns with an empty answer and the agent
      // writes one from the results rather than showing an engine failure for
      // a turn that succeeded. Nothing usable collected still propagates.
      if (!budgetCancelled || !executed.some((r) => r.isError !== true)) throw error;
      log.assistant('Apple Intelligence native turn ended at the tool budget; answering from the collected results', LogLevel.WARN, {
        modelId: this.modelId,
        toolCalls: executed.length,
      });
      response = { content: '' };
    } finally {
      await handle.remove();
    }
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    log.assistant('Apple Intelligence native tool turn finished', LogLevel.DEBUG, {
      modelId: this.modelId,
      toolCalls: executed.length,
    });

    const promptTokens = response.promptTokens ?? Math.ceil((JSON.stringify(chatMessages).length + toolsJson.length) / 3.5);
    const completionTokens = response.completionTokens ?? Math.ceil(response.content.length / 3.5);
    return {
      text: response.content,
      toolCalls: [],
      nativeToolResults: executed,
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
      exchange: captureExchange({ backend: 'apple', model: this.modelId, sent: chatMessages, received: response.content, startedAt }),
    };
  }

  async chat(
    messages: AssistantMessage[],
    tools: ToolDefinition[],
    system: string,
    signal: AbortSignal,
    onStatus?: (status: AssistantStatus) => void,
    runTool?: (name: string, input: Record<string, unknown>) => Promise<ExecutedToolCall>,
  ): Promise<AssistantTurn> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const { AppleIntelligence: plugin } = await this.getPlugin();
    await this.ensureDeviceContext(plugin);
    // Tools plus a caller that can execute them: hand the framework its own
    // tool loop. Everything below is the fallback path for a tool-less turn.
    if (runTool && tools.length > 0) return this.chatWithNativeTools(plugin, messages, tools, system, signal, runTool);
    // No few-shot and no OUTPUT_CONTRACT on this backend: with guided
    // generation the reply shape is enforced at the decoder, so all format
    // teaching must leave the prompt. Observed live: the few-shot event-count
    // answer template was parroted verbatim on tool turns too, and the textual
    // contract made the model write JSON INSIDE the constrained answer string
    // ({"answer": "{"}). The per-turn schema already pins the legal tool names
    // and their input shapes, so nothing is lost (refs #270).
    // The prompt itself is rebuilt for this backend (see buildAppleInstructions):
    // persona, the caller's dynamic facts, short tool lines, short examples, and
    // the one rule that matters repeated last. The shared catalog is switched
    // off with it, since those instructions carry their own.
    const chatMessages = buildWebLlmMessages(buildAppleInstructions(system, tools), messages, tools, this.modelId, false, true, false, false);
    // Whether any data has been fetched, which decides if the answer branch is
    // offered at all (see buildTurnSchema). `messages` is the caller's whole
    // trimmed thread, not just this turn, so a conversation whose EARLIER turns
    // ran tools reports true on the first call of a new turn. That looseness is
    // deliberate: it only restores the previous union schema, never wrongly
    // tightens one. A per-turn check ("a tool result after the last user
    // message") would be wrong here, because the agent loop pushes its own
    // mid-turn corrections as `role: 'user'` AFTER tool results have landed.
    // Only a SUCCESSFUL result counts. A failed call's error feedback is also a
    // `role: 'tool'` message, but it is a correction, not data: observed live,
    // it unlocked the answer branch and the model fabricated event counts
    // instead of fixing the call. The branch stays locked until a tool actually
    // returned something (refs #270).
    // Built once, so every retry attempt below re-sends the same schema.
    const hasToolResult = messages.some((m) => m.role === 'tool' && (m.toolResults ?? []).some((r) => !r.isError));
    const schemaJson = buildTurnSchema(tools, hasToolResult);

    // Same retry shape as NativeLlmProvider.chat / WebLlmProvider.chat: the
    // failed reply plus a correction are appended before each retry (here the
    // contract-free `APPLE_RETRY_PROMPT`), and only the FINAL attempt raises
    // the temperature.
    let turn: AssistantTurn = { text: PARSE_ERROR_TEXT, toolCalls: [] };
    // The context-full recovery below is allowed once per turn: a second
    // overflow after the history was already halved is a prompt that cannot fit.
    let historyDropped = false;
    for (let attempt = 1; attempt <= ASSISTANT.maxParseAttempts; attempt++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (attempt > 1) onStatus?.({ phase: 'retry', attempt });
      log.assistant('Sending Apple Intelligence chat request', LogLevel.DEBUG, {
        modelId: this.modelId,
        messageCount: chatMessages.length,
        attempt,
      });

      const startedAt = Date.now();
      let response: { content: string; promptTokens?: number; completionTokens?: number };
      try {
        response = await this.withCancel(plugin, signal, () =>
          plugin.chat({
            messagesJson: JSON.stringify(chatMessages),
            temperature: attempt < ASSISTANT.maxParseAttempts ? this.temperature : Math.max(this.temperature, ASSISTANT.assistantRetryTemperature),
            maxTokens: ASSISTANT.maxTokens,
            schemaJson,
          }),
        );
      } catch (error) {
        // Out of window, not broken: re-sending the same prompt cannot help, so
        // drop the oldest half of the conversation (never the instructions) and
        // send the same turn again. Mirrors Apple's condensed-transcript
        // recovery, which rebuilds a session from a shortened transcript when
        // one overflows. Once per turn; a second overflow propagates.
        if (isContextFull(error) && !historyDropped) {
          historyDropped = true;
          log.assistant('Apple Intelligence context full; retrying with the oldest half of the history dropped', LogLevel.WARN, {
            modelId: this.modelId,
            messageCount: chatMessages.length,
            attempt,
          });
          chatMessages.splice(1, Math.floor((chatMessages.length - 1) / 2));
          continue;
        }
        // A truncated constrained decode is a failed ATTEMPT, not a failed turn:
        // spend the remaining attempts on it (the last one also raises the
        // temperature) instead of surfacing a dead end for something the very
        // next call usually gets right. Every other rejection still propagates
        // exactly as before, and so does this one once attempts run out.
        if (!isTruncatedGeneration(error) || attempt === ASSISTANT.maxParseAttempts) throw error;
        log.assistant('Apple Intelligence generation truncated at the context edge; retrying', LogLevel.WARN, {
          modelId: this.modelId,
          attempt,
          maxAttempts: ASSISTANT.maxParseAttempts,
        });
        continue;
      }
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      log.assistant('Apple Intelligence raw response', LogLevel.DEBUG, { modelId: this.modelId, content: response.content, attempt });

      turn = parseWebLlmTurn(response.content);
      // Real counts when the plugin reports them, so AskPanel's fullness check
      // measures the window the way the model does. The fallback is for an OS
      // build that reports none: an estimate exists at all only so auto-clear can
      // act BEFORE the (small, e.g. 4096) window overflows and the engine fails.
      // chars/3.5 (English ~4 chars/token) deliberately OVERestimates tokens, which
      // errs toward clearing the context early rather than crashing on overflow.
      // The schema counts too: guided generation feeds it to the decoder, so it
      // occupies the same window the messages do (refs #270).
      const messagesJson = JSON.stringify(chatMessages);
      const promptTokens = response.promptTokens ?? Math.ceil((messagesJson.length + schemaJson.length) / 3.5);
      const completionTokens = response.completionTokens ?? Math.ceil(response.content.length / 3.5);
      turn.usage = {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      };
      // Captured on every attempt, so a retried turn shows what it retried from;
      // the last attempt's capture is the one that survives on `turn`.
      turn.exchange = captureExchange({
        backend: 'apple',
        model: this.modelId,
        sent: chatMessages,
        received: response.content,
        startedAt,
      });
      if (turn.text !== PARSE_ERROR_TEXT) return turn;

      log.assistant('Apple Intelligence response failed to parse; retrying if attempts remain', LogLevel.WARN, {
        modelId: this.modelId,
        content: response.content,
        attempt,
        maxAttempts: ASSISTANT.maxParseAttempts,
      });
      chatMessages.push({ role: 'assistant', content: response.content });
      chatMessages.push({ role: 'user', content: APPLE_RETRY_PROMPT });
    }
    return turn;
  }
}
