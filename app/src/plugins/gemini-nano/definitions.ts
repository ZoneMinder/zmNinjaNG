/**
 * Gemini Nano bridge (`GeminiNano`, refs #270): the Android system model, reached
 * through AICore via the ML Kit GenAI Prompt API.
 *
 * Android counterpart of `plugins/apple-intelligence`, and deliberately the same
 * surface minus the two things ML Kit has no equivalent for. There is no
 * `resolveToolCall` (no native tool loop) and no `schemaJson` (ML Kit's structured
 * output is compile-time Kotlin codegen with no union type, so a per-tool turn
 * schema cannot be built at runtime); this backend is therefore driven with the
 * textual turn contract, exactly as `NativeLlm` is.
 *
 * It does carry a download surface Apple's does not: AICore fetches the weights on
 * request rather than shipping them with the OS.
 */
import type { PluginListenerHandle } from '@capacitor/core';

export interface GeminiNanoPlugin {
  /** `contextSize` (present when supported) is the model's usable window: the device's
   *  real token limit minus the reply reserve, which is what the provider adopts for its
   *  `contextWindow` getter. `reason` distinguishes the unsupported cases: this Android
   *  build or device has no Gemini Nano ('platform'), or the weights are not downloaded
   *  yet ('notReady'), which `download()` fixes. There is no 'disabled' case: Android has
   *  no user-facing switch equivalent to Apple Intelligence's. */
  isSupported(): Promise<{ supported: boolean; reason?: 'platform' | 'notReady'; contextSize?: number }>;
  /** Fetches the weights through AICore. Resolves when the download completes; progress
   *  arrives on the `downloadProgress` listener. */
  download(): Promise<void>;
  chat(options: {
    messagesJson: string; // JSON array of {role, content}, OpenAI-shaped
    temperature: number;
    maxTokens: number;
    /** Routes the call to the second of two independent busy slots. The window
     *  interpreter nests a one-shot completion inside a tool call, so a utility call is
     *  legitimately in flight while the tool-loop chat waits on JS; without the split
     *  the nested call would be rejected as CHAT_BUSY. Same reasoning as
     *  `NativeLlm.chat`'s `cacheSlot`, though here it gates concurrency rather than a
     *  KV cache, which ML Kit does not expose. */
    utility?: boolean;
  }): Promise<{
    content: string;
    /** Exact count from the model's tokenizer. Absent if the count failed, in which case
     *  the provider falls back to its own estimate. Completion tokens are deliberately
     *  not counted: only the prompt count is spent against the context budget, and
     *  counting the reply would cost a second round trip per turn to label a transcript. */
    promptTokens?: number;
  }>;
  cancelChat(): Promise<void>;
  /** Weight-download progress. Same shape as `NativeLlm`'s event minus `modelId`: the
   *  system model has no id to select. */
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (p: { bytesDownloaded: number; totalBytes: number }) => void,
  ): Promise<PluginListenerHandle>;
}
