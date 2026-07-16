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
