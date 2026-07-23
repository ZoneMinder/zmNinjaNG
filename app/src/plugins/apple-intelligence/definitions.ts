/**
 * Apple Foundation Models bridge (`AppleIntelligence`, refs #270). The system
 * model is managed entirely by the OS, so there is no download/delete surface
 * the way `NativeLlm` has: only a support probe, a chat call, and a cancel.
 */
export interface AppleIntelligencePlugin {
  // `contextSize` (present when supported) is the model's usable chat window, which the provider
  // adopts for its `contextWindow` getter. `reason` distinguishes the unsupported cases: the OS
  // lacks the model (`platform`), the user turned Apple Intelligence off (`disabled`), or it is
  // still provisioning/downloading (`notReady`).
  isSupported(): Promise<{ supported: boolean; reason?: 'platform' | 'disabled' | 'notReady'; contextSize?: number }>;
  chat(options: {
    messagesJson: string; // JSON array of {role, content}, OpenAI-shaped
    temperature: number;
    maxTokens: number;
  }): Promise<{ content: string }>; // no token counts: the Foundation Models API reports none
  cancelChat(): Promise<void>;
}
