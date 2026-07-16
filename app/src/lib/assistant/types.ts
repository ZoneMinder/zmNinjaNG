import type { QueryClient } from '@tanstack/react-query';
import type { ProfileId } from '../../api/types';

export type AssistantRole = 'user' | 'assistant' | 'tool';

/** One entry in the conversation. Assistant turns carry text and/or toolCalls;
 *  tool turns carry the results of the immediately preceding assistant turn. */
export interface AssistantMessage {
  role: AssistantRole;
  text?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  /** The raw, unparsed model output for a turn that fell back to
   *  `assistant.parse_error` (see providers/webllm.ts's `parseWebLlmTurn`).
   *  Only ever set on that fallback so the UI can offer "show model output"
   *  for diagnosing why a turn failed; never set on a normal answer or tool
   *  call. */
  raw?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  output: string;
  isError?: boolean;
}

/** One model turn. toolCalls empty means the model is done. */
export interface AssistantTurn {
  text?: string;
  toolCalls: ToolCall[];
  /** See `AssistantMessage.raw`: carried onto the pushed assistant message by
   *  `runAssistantTurn` (agent.ts) when a turn is the parse-error fallback. */
  raw?: string;
}

export interface ToolContext {
  profileId: ProfileId;
  queryClient: QueryClient;
  host: AssistantHost;
}

export interface ToolExecuteResult {
  output: string;
  isError?: boolean;
  /** navigate sets this so the agent closes the palette after the call. */
  closePanel?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON schema for the tool input, passed to the model. */
  schema: Record<string, unknown>;
  destructive: boolean;
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolExecuteResult>;
  /** Destructive tools may fetch detail and build a concrete confirm request. */
  buildConfirm?: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ConfirmRequest>;
}

/** i18n-free: the host localizes messageKey + messageParams (rule 5). */
export interface ConfirmRequest {
  toolName: string;
  messageKey: string;
  messageParams: Record<string, unknown>;
  params: Record<string, unknown>;
}

export interface ToolActivity {
  toolName: string;
  status: 'running' | 'done' | 'error';
  /** The tool call's input, so the UI can show what it was called with (e.g.
   *  `count_events {"interval":"24 hour"}`) instead of just the tool name. */
  input: Record<string, unknown>;
}

export interface AssistantHost {
  confirm(request: ConfirmRequest): Promise<boolean>;
  navigate(path: string): void;
  onActivity(activity: ToolActivity): void;
}

export interface AssistantProvider {
  chat(
    messages: AssistantMessage[],
    tools: ToolDefinition[],
    system: string,
    signal: AbortSignal,
  ): Promise<AssistantTurn>;
}

export interface SystemPromptContext {
  now: Date;
  timezone: string;
  locale: string;
  zmVersion: string;
  monitors: Array<{ id: string; name: string; func: string; enabled: boolean }>;
}
