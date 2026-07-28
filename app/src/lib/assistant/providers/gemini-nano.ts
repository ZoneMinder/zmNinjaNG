/**
 * Gemini Nano adapter (Android's system model, via the Capacitor `GeminiNano`
 * bridge over AICore, refs #270)
 *
 * Structurally a trimmed `providers/native-llm.ts`, NOT a port of
 * `providers/apple-intelligence.ts`, even though both back a system model the OS
 * owns. The difference is what the decoder can be told: Apple Foundation Models
 * takes a `GenerationSchema` built per turn, so that provider constrains the reply
 * to the turn contract and removes the answer branch until a tool result exists.
 * ML Kit's structured output is compile-time Kotlin codegen with no union type, so
 * no per-tool schema can be built at runtime and no branch can be removed. This
 * backend is therefore driven exactly as llama.cpp is: the shared WebLLM prompt and
 * parse stack (`buildWebLlmMessages`, `parseWebLlmTurn`, `SELF_REPAIR_PROMPT`), a
 * self-repair retry when the envelope does not parse, and the code-level grounding
 * checks in `agent.ts` rather than a decoder constraint.
 */
import type { AssistantProvider, AssistantMessage, AssistantStatus, AssistantTurn, CompletionResult, ToolDefinition } from '../types';
import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm';
import { ASSISTANT } from '../../zmninja-ng-constants';
import { log, LogLevel } from '../../logger';
import { Platform } from '../../platform';
import { buildWebLlmMessages, parseWebLlmTurn, SELF_REPAIR_PROMPT, PARSE_ERROR_TEXT } from './webllm';
import { captureExchange } from '../exchange';
import { MODEL_NOT_AVAILABLE_MESSAGE } from '../model-download';

/** Thrown when this provider is constructed off Android, or before the weights are
 *  downloaded. Deliberately the SAME message the other on-device backends throw, so
 *  AskPanel's existing `PROVIDER_NOT_AVAILABLE_MESSAGE` check ("not configured, go to
 *  Settings") covers this case with no separate UI path (same reasoning as
 *  `native-llm.ts`'s own constant). */
export const GEMINI_NANO_NOT_AVAILABLE_MESSAGE = MODEL_NOT_AVAILABLE_MESSAGE;

export class GeminiNanoProvider implements AssistantProvider {
  private readonly modelId = ASSISTANT.geminiNanoModelId;
  private readonly temperature: number;
  /** The device's usable window, learned from `isSupported().contextSize` on the first call
   *  this turn. Undefined until then; `isContextNearlyFull` no-ops on undefined, and it is
   *  read only AFTER a turn's chat has run. Instance-scoped, like `NativeLlmProvider`'s: the
   *  limit is a property of the installed model and a fresh provider per turn re-learns it
   *  cheaply rather than caching a value a system update has changed. */
  private deviceContextWindow?: number;
  get contextWindow(): number | undefined {
    return this.deviceContextWindow;
  }

  constructor(temperature?: number) {
    this.temperature = temperature ?? ASSISTANT.assistantTemperature;
  }

  /** Dynamic import behind a platform check (Native contract): the plugin package is
   *  native-only, so importing it eagerly would pull bridge code into the web/Electron
   *  bundle for a backend those platforms can never run. Resolves the NAMESPACE, not the
   *  plugin object, for the reason `native-llm.ts` documents: resolving a promise with
   *  Capacitor's proxy makes the runtime probe `.then` as a native method. */
  private async getPlugin() {
    if (!Platform.isNative) throw new Error(GEMINI_NANO_NOT_AVAILABLE_MESSAGE);
    return import('../../../plugins/gemini-nano');
  }

  /** One `plugin.chat()` call with the abort signal wired to `cancelChat()`. Mirrors
   *  `NativeLlmProvider.withCancel`: the caller's own `signal.aborted` check turns
   *  cancellation into the AbortError callers expect, whether it resolved or rejected. */
  private async withCancel<T>(
    plugin: Awaited<ReturnType<GeminiNanoProvider['getPlugin']>>['GeminiNano'],
    signal: AbortSignal,
    work: () => Promise<T>,
  ): Promise<T> {
    const onAbort = () =>
      void plugin.cancelChat().catch((error) => log.assistant('Gemini Nano cancelChat failed', LogLevel.WARN, { error }));
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

  /** Translates a rejected `plugin.chat()` into the Error this provider throws, keyed on the
   *  stable `code` GeminiNanoPlugin.java rejects with. The first three codes are the same
   *  names LlamaPlugin and AppleIntelligencePlugin use, so they get the same treatment here.
   *  The last two are AICore-specific and both user-recoverable, which is why they are not
   *  folded into the generic engine failure: a user told "try again" will retry forever
   *  against a background block or a spent daily quota. */
  private mapPluginError(error: unknown): Error {
    const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : undefined;
    if (code === 'MODEL_NOT_AVAILABLE') return new Error(GEMINI_NANO_NOT_AVAILABLE_MESSAGE);
    if (code === 'CHAT_BUSY') return new Error('__i18n:assistant.native_busy');
    // AICore's own short-window rate limit, distinct from the plugin's busy guard.
    // Tagged with the code so a batch caller (the eval) can back off and retry rather
    // than recording a zero; a chat turn just shows the message.
    if (code === 'RATE_LIMITED') return Object.assign(new Error('__i18n:assistant.gemini_rate_limited'), { code });
    if (code === 'BACKGROUND_BLOCKED') return new Error('__i18n:assistant.gemini_background_blocked');
    if (code === 'QUOTA_EXCEEDED') return new Error('__i18n:assistant.gemini_quota_exceeded');
    log.assistant('Gemini Nano chat failed', LogLevel.ERROR, {
      code,
      message: error instanceof Error ? error.message : String(error),
    });
    return new Error('__i18n:assistant.native_engine_failed');
  }

  /** Learn the device's usable window once per provider instance. Best-effort: on failure
   *  `deviceContextWindow` stays undefined and auto-clear simply no-ops. */
  private async ensureDeviceContext(
    plugin: Awaited<ReturnType<GeminiNanoProvider['getPlugin']>>['GeminiNano'],
  ): Promise<void> {
    if (this.deviceContextWindow !== undefined) return;
    try {
      const r = await plugin.isSupported();
      if (typeof r.contextSize === 'number') this.deviceContextWindow = r.contextSize;
    } catch (error) {
      log.assistant('Gemini Nano isSupported (contextSize) probe failed', LogLevel.WARN, { error });
    }
  }

  /** The plugin counts the prompt exactly and leaves the completion to this estimate.
   *  chars/3.5 (English runs ~4 chars per token) deliberately OVERestimates, which is the
   *  safe direction for a budget that decides when to clear context. */
  private static estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
  }

  /** Bare system + user, deliberately bypassing `buildWebLlmMessages`: no tool catalog, no
   *  few-shot, no OUTPUT_CONTRACT (mirrors `WebLlmProvider.complete`). `jsonSchema` is
   *  accepted for interface parity but unenforced: ML Kit cannot build an output schema at
   *  runtime, the same prompt-only situation the llama.cpp bridge is in. */
  async complete(
    system: string,
    text: string,
    signal: AbortSignal,
    _jsonSchema?: Record<string, unknown>,
    _onStatus?: (status: AssistantStatus) => void,
  ): Promise<CompletionResult> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const { GeminiNano: plugin } = await this.getPlugin();
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
        utility: true, // its own busy slot, so a nested interpreter call is never CHAT_BUSY
      }),
    );
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return {
      text: response.content,
      exchange: captureExchange({ backend: 'gemini-nano', model: this.modelId, sent: messages, received: response.content, startedAt }),
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
    const { GeminiNano: plugin } = await this.getPlugin();
    await this.ensureDeviceContext(plugin);
    const chatMessages = buildWebLlmMessages(system, messages, tools, this.modelId);

    // Same self-repair retry shape as the other providers: the failed reply plus a
    // correction naming the fault are appended before each retry, and only the FINAL
    // attempt raises the temperature.
    let turn: AssistantTurn = { text: PARSE_ERROR_TEXT, toolCalls: [] };
    for (let attempt = 1; attempt <= ASSISTANT.maxParseAttempts; attempt++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (attempt > 1) onStatus?.({ phase: 'retry', attempt });
      log.assistant('Sending Gemini Nano chat request', LogLevel.DEBUG, {
        modelId: this.modelId,
        messageCount: chatMessages.length,
        attempt,
      });

      const startedAt = Date.now();
      const response = await this.withCancel(plugin, signal, () =>
        plugin.chat({
          messagesJson: JSON.stringify(chatMessages),
          temperature:
            attempt < ASSISTANT.maxParseAttempts ? this.temperature : Math.max(this.temperature, ASSISTANT.assistantRetryTemperature),
          maxTokens: ASSISTANT.maxTokens,
        }),
      );
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      log.assistant('Gemini Nano raw response', LogLevel.DEBUG, { modelId: this.modelId, content: response.content, attempt });

      turn = parseWebLlmTurn(response.content);
      const promptTokens = response.promptTokens ?? GeminiNanoProvider.estimateTokens(JSON.stringify(chatMessages));
      const completionTokens = GeminiNanoProvider.estimateTokens(response.content);
      turn.usage = { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
      // Captured on every attempt, so a retried turn shows what it retried from; the last
      // attempt's capture is the one that survives on `turn`.
      turn.exchange = captureExchange({
        backend: 'gemini-nano',
        model: this.modelId,
        sent: chatMessages,
        received: response.content,
        startedAt,
      });
      if (turn.text !== PARSE_ERROR_TEXT) return turn;

      log.assistant('Gemini Nano response failed to parse; retrying if attempts remain', LogLevel.WARN, {
        modelId: this.modelId,
        content: response.content,
        attempt,
        maxAttempts: ASSISTANT.maxParseAttempts,
      });
      chatMessages.push({ role: 'assistant', content: response.content });
      chatMessages.push({ role: 'user', content: SELF_REPAIR_PROMPT });
    }
    return turn;
  }
}
