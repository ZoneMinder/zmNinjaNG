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
  }): Promise<{ content: string; promptTokens: number; completionTokens: number }>;
  cancelChat(): Promise<void>;
  unload(): Promise<void>;
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (p: { modelId: string; bytesDownloaded: number; totalBytes: number }) => void,
  ): Promise<PluginListenerHandle>;
}
