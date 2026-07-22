/**
 * Native on-device adapter (llama.cpp via the Capacitor `NativeLlm` bridge,
 * refs #270)
 *
 * The prompt/parse stack is entirely reused from `providers/webllm.ts`
 * (`buildWebLlmMessages`, `parseWebLlmTurn`, `SELF_REPAIR_PROMPT`): this
 * adapter drives the same small-model prompt contract WebLLM does, over a
 * different transport: a Capacitor plugin call instead of a WebGPU engine,
 * so only the transport is implemented here.
 */
import type { AssistantProvider, AssistantMessage, AssistantStatus, AssistantTurn, CompletionResult, ToolDefinition } from '../types';
import type { PluginListenerHandle } from '@capacitor/core';
import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm';
import { ASSISTANT } from '../../zmninja-ng-constants';
import { log, LogLevel } from '../../logger';
import { Platform } from '../../platform';
import { buildWebLlmMessages, parseWebLlmTurn, SELF_REPAIR_PROMPT, PARSE_ERROR_TEXT } from './webllm';
import { captureExchange } from '../exchange';
import { MODEL_NOT_AVAILABLE_MESSAGE } from '../model-download';

/** Thrown when this provider is constructed off a native platform (web,
 *  Electron): the llama.cpp bridge only exists in the iOS/Android build.
 *  Deliberately the SAME message WebLLM's missing-cache case throws (owned by
 *  `model-download.ts`, imported here rather than from `providers/provider.ts`
 *  to avoid a cycle, same reasoning as that module's own `MODEL_NOT_AVAILABLE_MESSAGE`
 *  comment): AskPanel's existing `PROVIDER_NOT_AVAILABLE_MESSAGE` check
 *  ("not configured, go to Settings") then covers this case too, with no
 *  separate UI path for it (refs #270). */
export const NATIVE_LLM_NOT_AVAILABLE_MESSAGE = MODEL_NOT_AVAILABLE_MESSAGE;

/** The on-device native provider: one llama.cpp model (loaded/managed by the
 *  plugin itself), driven with the same constrained-JSON contract WebLLM uses
 *  (see module header) instead of reimplementing prompt building or parsing. */
export class NativeLlmProvider implements AssistantProvider {
  private readonly modelId = ASSISTANT.nativeLlmModel.id;
  private readonly temperature: number;
  /** The window this model is loaded with; known exactly, same as WebLLM's
   *  per-model `contextWindowSize` (see `WebLlmProvider.contextWindow`). */
  readonly contextWindow = ASSISTANT.nativeLlmModel.contextSize;

  constructor(temperature?: number) {
    this.temperature = temperature ?? ASSISTANT.assistantTemperature;
  }

  /** Dynamic import behind a platform check (rule 13): the plugin package is
   *  native-only, so importing it eagerly would pull native bridge code into
   *  the web/Electron bundle for a backend those platforms can never run. */
  private async getPlugin() {
    if (!Platform.isNative) throw new Error(NATIVE_LLM_NOT_AVAILABLE_MESSAGE);
    // Namespace, not the plugin object: resolving a promise with Capacitor's
    // registerPlugin proxy makes the runtime probe `.then` as a native method,
    // which rejects as unimplemented while the awaiter hangs forever (refs
    // #270). Callers destructure `NativeLlm` AFTER the await.
    return import('../../../plugins/native-llm');
  }

  /** One `plugin.chat()` call, with the abort signal wired to `cancelChat()`.
   *  Mirrors `WebLlmProvider.withInterrupt`: the listener asks the native side
   *  to stop generating, and the caller's own `signal.aborted` check (run
   *  right after this resolves, success or failure) turns that into the
   *  AbortError callers expect, regardless of whether cancellation resolved
   *  the call or made it reject. */
  private async withCancel<T>(
    plugin: Awaited<ReturnType<NativeLlmProvider['getPlugin']>>['NativeLlm'],
    signal: AbortSignal,
    work: () => Promise<T>,
  ): Promise<T> {
    const onAbort = () =>
      void plugin.cancelChat().catch((error) => log.assistant('Native LLM cancelChat failed', LogLevel.WARN, { error }));
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
   *  should throw, keyed on the stable `code` LlamaPlugin.swift's `chat`
   *  rejects with (Capacitor copies every key of the native side's error
   *  object, `code` included, onto the JS exception it rejects with - see
   *  native-bridge.js's `returnResult`). MODEL_NOT_DOWNLOADED reuses
   *  `NATIVE_LLM_NOT_AVAILABLE_MESSAGE` so it gets the same "not configured"
   *  treatment as the off-platform case above; CHAT_BUSY gets its own
   *  localized `__i18n:` copy (AskPanel already renders any thrown
   *  `__i18n:`-prefixed message via `t()`, see its `I18N_SENTINEL` handling);
   *  everything else (ENGINE_FAILED, or no code at all) falls back to a
   *  generic localized message, with the real reason only in the log - not
   *  shown to the user, since it is Swift's untranslated `localizedDescription`. */
  private mapPluginError(error: unknown): Error {
    const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : undefined;
    if (code === 'MODEL_NOT_DOWNLOADED') return new Error(NATIVE_LLM_NOT_AVAILABLE_MESSAGE);
    if (code === 'CHAT_BUSY') return new Error('__i18n:assistant.native_busy');
    log.assistant('Native LLM chat failed', LogLevel.ERROR, {
      code,
      message: error instanceof Error ? error.message : String(error),
    });
    return new Error('__i18n:assistant.native_engine_failed');
  }

  /** Bare system + user, deliberately bypassing `buildWebLlmMessages`: no tool
   *  catalog, no few-shot, no OUTPUT_CONTRACT (mirrors `WebLlmProvider.complete`).
   *  `jsonSchema` is accepted for interface parity but unenforced: the plugin
   *  has no grammar-constrained decoding, same prompt-only situation as
   *  WebLLM's own fallback when its grammar compiler is unusable. */
  /** Adds the native `chatStatus` listener (weight load / prefill phases) for one call,
   *  forwarding to `onStatus`. Always removed by the caller's finally, mirroring the
   *  download listener discipline. */
  private async subscribeStatus(
    plugin: Awaited<ReturnType<NativeLlmProvider['getPlugin']>>['NativeLlm'],
    onStatus?: (status: AssistantStatus) => void,
  ): Promise<PluginListenerHandle | null> {
    if (!onStatus) return null;
    return plugin.addListener('chatStatus', (p) =>
      onStatus({ phase: p.phase, progress: p.progress, tokens: p.tokens, chunk: p.chunk, chunks: p.chunks, slot: p.slot }),
    );
  }

  async complete(
    system: string,
    text: string,
    signal: AbortSignal,
    _jsonSchema?: Record<string, unknown>,
    onStatus?: (status: AssistantStatus) => void,
  ): Promise<CompletionResult> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const { NativeLlm: plugin } = await this.getPlugin();
    const statusHandle = await this.subscribeStatus(plugin, onStatus);
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
      { role: 'user', content: text },
    ];
    const startedAt = Date.now();
    try {
      const response = await this.withCancel(plugin, signal, () =>
        plugin.chat({
          modelId: this.modelId,
          messagesJson: JSON.stringify(messages),
          temperature: this.temperature,
          maxTokens: ASSISTANT.maxTokens,
          contextSize: this.contextWindow,
          cacheSlot: 1, // triage/complete: its own KV sequence so it never evicts the chat cache
        }),
      );
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return {
        text: response.content,
        exchange: captureExchange({ backend: 'native', model: this.modelId, sent: messages, received: response.content, startedAt }),
      };
    } finally {
      await statusHandle?.remove();
    }
  }

  async chat(
    messages: AssistantMessage[],
    tools: ToolDefinition[],
    system: string,
    signal: AbortSignal,
    onStatus?: (status: AssistantStatus) => void,
  ): Promise<AssistantTurn> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const { NativeLlm: plugin } = await this.getPlugin();
    const chatMessages = buildWebLlmMessages(system, messages, tools, this.modelId);
    const statusHandle = await this.subscribeStatus(plugin, onStatus);

    // Same self-repair retry shape as WebLlmProvider.chat / OpenAiProvider.chat:
    // the failed reply plus a correction naming the fault are appended before
    // each retry, and only the FINAL attempt raises the temperature.
    let turn: AssistantTurn = { text: PARSE_ERROR_TEXT, toolCalls: [] };
    try {
    for (let attempt = 1; attempt <= ASSISTANT.maxParseAttempts; attempt++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (attempt > 1) onStatus?.({ phase: 'retry', attempt });
      log.assistant('Sending native LLM chat request', LogLevel.DEBUG, {
        modelId: this.modelId,
        messageCount: chatMessages.length,
        attempt,
      });

      const startedAt = Date.now();
      const response = await this.withCancel(plugin, signal, () =>
        plugin.chat({
          modelId: this.modelId,
          messagesJson: JSON.stringify(chatMessages),
          temperature: attempt < ASSISTANT.maxParseAttempts ? this.temperature : Math.max(this.temperature, ASSISTANT.assistantRetryTemperature),
          maxTokens: ASSISTANT.maxTokens,
          contextSize: this.contextWindow,
          cacheSlot: 0, // main chat: the conversation KV sequence
        }),
      );
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      log.assistant('Native LLM raw response', LogLevel.DEBUG, { modelId: this.modelId, content: response.content, attempt });

      turn = parseWebLlmTurn(response.content);
      turn.usage = {
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
        totalTokens: response.promptTokens + response.completionTokens,
      };
      // Captured on every attempt, so a retried turn shows what it retried
      // from; the last attempt's capture is the one that survives on `turn`.
      turn.exchange = captureExchange({
        backend: 'native',
        model: this.modelId,
        sent: chatMessages,
        received: response.content,
        startedAt,
      });
      if (turn.text !== PARSE_ERROR_TEXT) return turn;

      log.assistant('Native LLM response failed to parse; retrying if attempts remain', LogLevel.WARN, {
        modelId: this.modelId,
        content: response.content,
        attempt,
        maxAttempts: ASSISTANT.maxParseAttempts,
      });
      chatMessages.push({ role: 'assistant', content: response.content });
      chatMessages.push({ role: 'user', content: SELF_REPAIR_PROMPT });
    }
    return turn;
    } finally {
      await statusHandle?.remove();
    }
  }
}
