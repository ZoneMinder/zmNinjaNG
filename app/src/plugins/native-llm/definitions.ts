import type { PluginListenerHandle } from '@capacitor/core';

export interface NativeLlmPlugin {
  isSupported(): Promise<{ supported: boolean; reason?: 'platform' | 'memory' }>;
  isModelDownloaded(options: { modelId: string }): Promise<{ downloaded: boolean; sizeBytes?: number; path?: string }>;
  downloadModel(options: { modelId: string; url: string }): Promise<void>; // resolves when download completes; progress via listener
  cancelDownload(): Promise<void>;
  deleteModel(options: { modelId: string }): Promise<void>;
  chat(options: {
    modelId: string;
    messagesJson: string; // JSON array of {role, content}, OpenAI-shaped
    temperature: number;
    maxTokens: number;
    contextSize: number;
    cacheSlot?: number; // KV sequence: 0 = chat (default), 1 = triage. Separate slots so triage
    // never evicts the conversation cache (additive; omitting it keeps slot 0).
  }): Promise<{ content: string; promptTokens: number; completionTokens: number }>;
  cancelChat(): Promise<void>;
  unload(): Promise<void>;
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (p: { modelId: string; bytesDownloaded: number; totalBytes: number }) => void,
  ): Promise<PluginListenerHandle>;
  // In-turn phase status during chat(): weight load and prefill progress. Additive; JS
  // decides presentation/threshold. `progress` is 0..1; `tokens` is the prefill suffix count.
  addListener(
    eventName: 'chatStatus',
    listenerFunc: (p: { phase: 'loading_model' | 'prefill'; progress: number; tokens: number; cached: number }) => void,
  ): Promise<PluginListenerHandle>;
}
