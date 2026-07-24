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
    // Optional JSON Schema (stringified) the native side constrains generation to,
    // so the reply EXACTLY matches it. Supported subset: object/properties/required,
    // string/number/integer/boolean, enum (strings), array/items, and a top-level
    // anyOf. Omitted for an unconstrained call.
    schemaJson?: string;
  }): Promise<{
    content: string;
    // Real counts when the Foundation Models session exposes them for this OS
    // build; absent otherwise, in which case the provider falls back to its own
    // chars/3.5 estimate (refs #270).
    promptTokens?: number;
    completionTokens?: number;
  }>;
  cancelChat(): Promise<void>;
}
