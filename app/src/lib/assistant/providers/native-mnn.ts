import { ASSISTANT } from '../../zmninja-ng-constants';
import { log, LogLevel } from '../../logger';
import { nativeMnnChat, supportsNativeMnnModel, NATIVE_MNN_MODELS, type NativeMnnMessage } from '../native-mnn';
import type { AssistantMessage, AssistantProvider, AssistantTurn, ToolDefinition } from '../types';
import { buildWebLlmMessages, parseWebLlmTurn } from './webllm';

const PARSE_ERROR_TEXT = '__i18n:assistant.parse_error';

/** Native MNN provider. It uses the same constrained JSON contract as WebLLM
 * so model output reaches the agent loop identically on every backend
 * (refs #246). */
export class NativeMnnProvider implements AssistantProvider {
  readonly contextWindow: number | undefined;
  private readonly modelId: string;
  private readonly useGpu: boolean;

  constructor(modelId: string, useGpu = false) {
    this.modelId = modelId;
    this.useGpu = useGpu;
    this.contextWindow = NATIVE_MNN_MODELS.find((m) => m.id === modelId)?.contextWindowSize;
  }

  async chat(
    messages: AssistantMessage[],
    tools: ToolDefinition[],
    system: string,
    signal: AbortSignal,
  ): Promise<AssistantTurn> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!supportsNativeMnnModel(this.modelId)) {
      // `__i18n:` sentinel, same contract agent.ts uses: AskPanel localizes it
      // at render, so this reaches the user in their own language (rule 5).
      throw new Error('__i18n:assistant.model_unavailable_native');
    }

    // Few-shot ON: it was previously disabled because the model copied the
    // examples instead of answering, which was a symptom of flattening every
    // turn into one string (the examples arrived as user text, not as prior
    // assistant turns). With the ChatMessages path below applying real role
    // markers, the examples read as examples again.
    //
    // Thinking stays ON (`disableThinking: false`): this is a reasoning-distilled
    // model and the chain of thought is what it is good at. `stripThinkBlock`
    // in parseWebLlmTurn discards the block before JSON extraction, and
    // `nativeMnnMaxTokens` budgets for it (see zmninja-ng-constants.ts).
    const chatMessages: NativeMnnMessage[] = buildWebLlmMessages(system, messages, tools, this.modelId, true, false)
      .map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user',
        content: String(message.content ?? ''),
      }));

    // Same retry policy as WebLlmProvider: a small model occasionally emits a
    // degenerate reply, sampling is non-deterministic, and a fresh attempt
    // usually recovers. Previously this path was single-shot, so one bad
    // generation surfaced the parse-error apology directly to the user.
    let turn: AssistantTurn = { text: PARSE_ERROR_TEXT, toolCalls: [] };
    for (let attempt = 1; attempt <= ASSISTANT.webllmMaxAttempts; attempt++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const { content, promptTokens, completionTokens } = await nativeMnnChat(
        this.modelId,
        chatMessages,
        ASSISTANT.nativeMnnMaxTokens,
        this.useGpu,
      );
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      log.assistant('Native MNN raw response', LogLevel.DEBUG, { modelId: this.modelId, content, attempt });

      turn = parseWebLlmTurn(content);
      // MNN's own counts, so AskPanel's auto-clear can measure how full the
      // window actually is. Without this the check silently never fired.
      turn.usage = { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
      if (turn.text !== PARSE_ERROR_TEXT) return turn;

      log.assistant('Native MNN response failed to parse; retrying if attempts remain', LogLevel.WARN, {
        modelId: this.modelId,
        content,
        attempt,
        maxAttempts: ASSISTANT.webllmMaxAttempts,
      });
    }
    return turn;
  }
}
