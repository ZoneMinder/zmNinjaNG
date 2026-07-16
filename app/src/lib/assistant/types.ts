import type { QueryClient } from '@tanstack/react-query';
import type { ProfileId } from '../../api/types';
import type { ThumbnailFallbackEntry } from '../../stores/settings';
import type { FormatSettings } from '../format-date-time';

export type AssistantRole = 'user' | 'assistant' | 'tool';

/** A monitor or event a tool found, rendered as a result card in AskPanel
 *  instead of (or alongside) the text answer (refs #246). This is UI-only:
 *  it rides next to a `ToolResult`'s `output` string but is never sent to the
 *  model (the vision non-goal stands: images are for the user, not the LLM). */
export interface DisplayEntity {
  kind: 'event' | 'monitor';
  id: string;
  title: string;
  subtitle?: string;
  /** In-app path for the card's "Open" action, e.g. `/events/123`. */
  navigatePath: string;
  /** Candidate thumbnail URLs, most-preferred first, for `EventThumbnail`.
   *  Omitted (or empty) for monitors, which have no snapshot card image. */
  imageUrls?: string[];
  /** `EventThumbnail`'s `cacheKey`; defaults to `id` when omitted. */
  cacheKey?: string;
}

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
  /** Result cards aggregated from this turn's tool calls (refs #246). Only
   *  ever set on a `role: 'tool'` message; see agent.ts's `runAssistantTurn`. */
  display?: DisplayEntity[];
  /** The tool-activity steps ("Running count_events…" / "count_events done")
   *  that occurred while this turn's answer was generated (refs #246).
   *  AskPanel's `handleSend` snapshots `useAssistantStore`'s `activities` once
   *  `runAssistantTurn` resolves and attaches them here, onto the assistant
   *  message carrying the final text, so the step trace renders above that
   *  answer and stays there in history instead of only living in the
   *  transient `activities` array for the in-flight turn. */
  steps?: ToolActivity[];
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
  display?: DisplayEntity[];
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
  /**
   * Non-React inputs for building authenticated event thumbnail URLs and
   * user-formatted titles on result cards (refs #246). AskPanel populates
   * these from `useCurrentProfile`/`useFreshAccessToken` (mirroring how
   * `MonitorRecentEvents` builds the same URLs) so tools never import stores
   * directly (rule 31). All optional: a test `ctx` that omits them simply
   * gets an empty `imageUrls` from `buildEventDisplayEntity`.
   */
  portalUrl?: string;
  accessToken?: string | null;
  minStreamingPort?: number;
  thumbnailFallbackChain?: ThumbnailFallbackEntry[];
  dateTimeFormat?: FormatSettings;
}

export interface ToolExecuteResult {
  output: string;
  isError?: boolean;
  /** navigate sets this so the agent closes the palette after the call. */
  closePanel?: boolean;
  /** UI-only result cards for list_events/get_event/list_monitors/get_monitor
   *  (refs #246). Never folded into `output`, which is the only thing the
   *  model sees. */
  display?: DisplayEntity[];
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
