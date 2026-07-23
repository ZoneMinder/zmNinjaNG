/**
 * Apple Foundation Models adapter (via the Capacitor `AppleIntelligence`
 * bridge, refs #270)
 *
 * Structurally a trimmed `providers/native-llm.ts`: the prompt/parse stack is
 * again reused from `providers/webllm.ts` (`buildWebLlmMessages`,
 * `parseWebLlmTurn`), driving the same JSON turn shape over a different
 * transport. The format teaching is the one part NOT reused: this backend
 * constrains generation with a schema, so the few-shot block and the textual
 * output contract are switched off (see `chat`). Unlike the native bridge, the OS owns
 * the model: there is no download, no KV cache slot, no weight-load/prefill
 * status stream, and no token counts, so those concerns are simply absent here.
 */
import type { AssistantProvider, AssistantMessage, AssistantStatus, AssistantTurn, CompletionResult, ToolDefinition } from '../types';
import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm';
import { ASSISTANT } from '../../zmninja-ng-constants';
import { log, LogLevel } from '../../logger';
import { Platform } from '../../platform';
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
 *  Shapes mirror the TOP-LEVEL contract (`{"answer": "..."}` /
 *  `{"tool": "<name>", "input": {...}}`) that history re-serialization in
 *  `buildWebLlmMessages` uses, so the constrained output flows through
 *  `parseWebLlmTurn`'s primary path and stays consistent with the assistant
 *  turns already in the prompt. Disjoint required keys
 *  (`answer` vs `tool`) also make the `anyOf` trivial for the decoder to
 *  discriminate. */
function buildTurnSchema(tools: ToolDefinition[]): string {
  const answerSchema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] };
  if (tools.length === 0) return JSON.stringify(answerSchema);
  return JSON.stringify({
    anyOf: [
      answerSchema,
      ...tools.map((tool) => ({
        type: 'object',
        properties: { tool: { enum: [tool.name] }, input: tool.schema },
        required: ['tool', 'input'],
      })),
    ],
  });
}

/** The retry correction for this backend, in place of WebLLM's
 *  `SELF_REPAIR_PROMPT`. That one restates `OUTPUT_CONTRACT`, which is exactly
 *  the format teaching guided generation cannot tolerate (refs #270), and under
 *  a constrained decoder an unparseable reply is nearly impossible anyway: what
 *  is left to correct is an empty or content-free one. Kept neutral so a retry
 *  cannot reintroduce JSON-shaped text into the answer field. */
const APPLE_RETRY_PROMPT = 'Your last reply was empty or unusable. Answer the user\'s question.';

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
    return new Error('__i18n:assistant.native_engine_failed');
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

  async chat(
    messages: AssistantMessage[],
    tools: ToolDefinition[],
    system: string,
    signal: AbortSignal,
    onStatus?: (status: AssistantStatus) => void,
  ): Promise<AssistantTurn> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const { AppleIntelligence: plugin } = await this.getPlugin();
    await this.ensureDeviceContext(plugin);
    // No few-shot and no OUTPUT_CONTRACT on this backend: with guided
    // generation the reply shape is enforced at the decoder, so all format
    // teaching must leave the prompt. Observed live: the few-shot event-count
    // answer template was parroted verbatim on tool turns too, and the textual
    // contract made the model write JSON INSIDE the constrained answer string
    // ({"answer": "{"}). The per-turn schema already pins the legal tool names
    // and their input shapes, so nothing is lost (refs #270).
    const chatMessages = buildWebLlmMessages(system, messages, tools, this.modelId, false, true, false);
    const schemaJson = buildTurnSchema(tools);

    // Same retry shape as NativeLlmProvider.chat / WebLlmProvider.chat: the
    // failed reply plus a correction are appended before each retry (here the
    // contract-free `APPLE_RETRY_PROMPT`), and only the FINAL attempt raises
    // the temperature.
    let turn: AssistantTurn = { text: PARSE_ERROR_TEXT, toolCalls: [] };
    for (let attempt = 1; attempt <= ASSISTANT.maxParseAttempts; attempt++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (attempt > 1) onStatus?.({ phase: 'retry', attempt });
      log.assistant('Sending Apple Intelligence chat request', LogLevel.DEBUG, {
        modelId: this.modelId,
        messageCount: chatMessages.length,
        attempt,
      });

      const startedAt = Date.now();
      const response = await this.withCancel(plugin, signal, () =>
        plugin.chat({
          messagesJson: JSON.stringify(chatMessages),
          temperature: attempt < ASSISTANT.maxParseAttempts ? this.temperature : Math.max(this.temperature, ASSISTANT.assistantRetryTemperature),
          maxTokens: ASSISTANT.maxTokens,
          schemaJson,
        }),
      );
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      log.assistant('Apple Intelligence raw response', LogLevel.DEBUG, { modelId: this.modelId, content: response.content, attempt });

      turn = parseWebLlmTurn(response.content);
      // Foundation Models reports no token counts. This estimate exists solely so
      // AskPanel's auto-clear can act BEFORE the (small, e.g. 4096) context window
      // overflows and the engine fails; the numbers are approximate by design.
      // chars/3.5 (English ~4 chars/token) deliberately OVERestimates tokens, which
      // errs toward clearing the context early rather than crashing on overflow.
      // Same estimate on every attempt, mirroring native-llm.ts's per-attempt shape.
      const messagesJson = JSON.stringify(chatMessages);
      const promptTokens = Math.ceil(messagesJson.length / 3.5);
      const completionTokens = Math.ceil(response.content.length / 3.5);
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
