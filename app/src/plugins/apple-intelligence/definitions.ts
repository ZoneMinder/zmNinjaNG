/**
 * Apple Foundation Models bridge (`AppleIntelligence`, refs #270). The system
 * model is managed entirely by the OS, so there is no download/delete surface
 * the way `NativeLlm` has: only a support probe, a chat call, and a cancel.
 */
import type { PluginListenerHandle } from '@capacitor/core';

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
    // Optional tool catalog (stringified JSON array of {name, description,
    // schemaJson}) that switches the native side to Foundation Models' OWN tool
    // loop: the framework picks the calls, each one is emitted as a `toolCall`
    // event, and the session waits for `resolveToolCall` before continuing. The
    // promise then resolves with the final PROSE answer, never a tool call.
    // Mutually exclusive with `schemaJson`, which shapes a single reply instead.
    toolsJson?: string;
  }): Promise<{
    content: string;
    // Real counts when the Foundation Models session exposes them for this OS
    // build; absent otherwise, in which case the provider falls back to its own
    // chars/3.5 estimate (refs #270).
    promptTokens?: number;
    completionTokens?: number;
  }>;
  cancelChat(): Promise<void>;
  /** Hands one tool's output back to the waiting native tool loop. The model
   *  reads whatever string is given, so a tool that failed resolves with its
   *  error text rather than rejecting: an error it can read is an error it can
   *  correct. */
  resolveToolCall(options: { callId: string; output: string }): Promise<void>;
  /** One tool call the Foundation Models session decided to make during a
   *  `chat` with `toolsJson`. `argumentsJson` is the model's arguments object,
   *  stringified. The session stays blocked on this call until
   *  `resolveToolCall` is called with the same `callId`. */
  addListener(
    eventName: 'toolCall',
    listenerFunc: (event: { callId: string; name: string; argumentsJson: string }) => void,
  ): Promise<PluginListenerHandle>;
}
