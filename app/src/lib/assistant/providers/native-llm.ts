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
import type { AssistantProvider, AssistantMessage, AssistantTurn, CompletionResult, ToolDefinition } from '../types';
import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm';
import { ASSISTANT } from '../../zmninja-ng-constants';
import { log, LogLevel } from '../../logger';
import { Platform } from '../../platform';
import { buildWebLlmMessages, parseWebLlmTurn, SELF_REPAIR_PROMPT, PARSE_ERROR_TEXT } from './webllm';
import { captureExchange } from '../exchange';

/** Thrown when this provider is constructed off a native platform (web,
 *  Electron): the llama.cpp bridge only exists in the iOS/Android build. */
export const NATIVE_LLM_NOT_AVAILABLE_MESSAGE = 'On-device native model backend is only available on iOS or Android.';

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
    const { NativeLlm } = await import('../../../plugins/native-llm');
    return NativeLlm;
  }

  /** One `plugin.chat()` call, with the abort signal wired to `cancelChat()`.
   *  Mirrors `WebLlmProvider.withInterrupt`: the listener asks the native side
   *  to stop generating, and the caller's own `signal.aborted` check (run
   *  right after this resolves, success or failure) turns that into the
   *  AbortError callers expect, regardless of whether cancellation resolved
   *  the call or made it reject. */
  private async withCancel<T>(
    plugin: Awaited<ReturnType<NativeLlmProvider['getPlugin']>>,
    signal: AbortSignal,
    work: () => Promise<T>,
  ): Promise<T> {
    const onAbort = () => void plugin.cancelChat();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      return await work();
    } catch (error) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      throw error;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  /** Bare system + user, deliberately bypassing `buildWebLlmMessages`: no tool
   *  catalog, no few-shot, no OUTPUT_CONTRACT (mirrors `WebLlmProvider.complete`).
   *  `jsonSchema` is accepted for interface parity but unenforced: the plugin
   *  has no grammar-constrained decoding, same prompt-only situation as
   *  WebLLM's own fallback when its grammar compiler is unusable. */
  async complete(system: string, text: string, signal: AbortSignal, _jsonSchema?: Record<string, unknown>): Promise<CompletionResult> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const plugin = await this.getPlugin();
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
      { role: 'user', content: text },
    ];
    const startedAt = Date.now();
    const response = await this.withCancel(plugin, signal, () =>
      plugin.chat({
        modelId: this.modelId,
        messagesJson: JSON.stringify(messages),
        temperature: this.temperature,
        maxTokens: ASSISTANT.maxTokens,
        contextSize: this.contextWindow,
      }),
    );
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return {
      text: response.content,
      exchange: captureExchange({ backend: 'native', model: this.modelId, sent: messages, received: response.content, startedAt }),
    };
  }

  async chat(messages: AssistantMessage[], tools: ToolDefinition[], system: string, signal: AbortSignal): Promise<AssistantTurn> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const plugin = await this.getPlugin();
    const chatMessages = buildWebLlmMessages(system, messages, tools, this.modelId);

    // Same self-repair retry shape as WebLlmProvider.chat / OpenAiProvider.chat:
    // the failed reply plus a correction naming the fault are appended before
    // each retry, and only the FINAL attempt raises the temperature.
    let turn: AssistantTurn = { text: PARSE_ERROR_TEXT, toolCalls: [] };
    for (let attempt = 1; attempt <= ASSISTANT.maxParseAttempts; attempt++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
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
  }
}
