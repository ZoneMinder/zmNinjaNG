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
  /** Everything that happened while producing this turn, in the order it
   *  happened: each model round trip and each tool call with the ZoneMinder
   *  requests it made. Attached to the same final assistant message `display`
   *  is, so the panel shows one transcript per answer rather than fragments
   *  scattered over hidden intermediate messages. */
  trace?: TraceEntry[];
  /** Result cards aggregated from this turn's tool calls (refs #246), de-duped
   *  by `kind`+`id`. Attached to the FINAL `role: 'assistant'` answer message
   *  of the turn (never an intermediate tool-call-only assistant message or a
   *  `role: 'tool'` message), so AskPanel renders question -> steps -> answer
   *  text -> cards, in that order; see agent.ts's `runAssistantTurn`. */
  display?: DisplayEntity[];
  /** The tool-activity steps ("Running count_events…" / "count_events done")
   *  that occurred while this turn's answer was generated (refs #246).
   *  AskPanel's `handleSend` snapshots `useAssistantStore`'s `activities` once
   *  `runAssistantTurn` resolves and attaches them here, onto the assistant
   *  message carrying the final text, so the step trace renders above that
   *  answer and stays there in history instead of only living in the
   *  transient `activities` array for the in-flight turn. */
  steps?: ToolActivity[];
  /** Token usage reported by the backend for the turn that produced this
   *  message, attached by `runAssistantTurn` to the FINAL assistant message
   *  only. AskPanel reads `promptTokens` off the last message to decide
   *  whether the next turn would overrun the context window. */
  usage?: TokenUsage;
  /** Marks this message as the start of a fresh context: `runAssistantTurn`
   *  sends only the messages AFTER the last one carrying this flag. The
   *  message itself still renders, so the transcript above it survives on
   *  screen even though the model no longer sees it (refs #246). */
  contextBoundary?: boolean;
}

/** What a backend reports it actually spent on a turn. `promptTokens` is the
 *  one that matters for the context window: it counts everything fed IN
 *  (system prompt + tool schemas + history + tool results), which is what
 *  grows without bound as a conversation goes on. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  /** The ZoneMinder requests this tool actually made ("GET /zm/api/... -> 200
   *  (45ms)"), for the panel transcript. Diagnostic only: never sent to the
   *  model, which has no use for a URL and would spend context on it. */
  apiCalls?: string[];
  callId: string;
  output: string;
  isError?: boolean;
  display?: DisplayEntity[];
}

/** One model turn. toolCalls empty means the model is done. */
/** One request/response pair with the model, captured verbatim so the panel
 *  can show what was actually sent and what actually came back.
 *
 *  Every backend fills this in, and the three do not send the same thing: the
 *  WebLLM path sends the tool catalog, few-shot block and JSON output contract
 *  as prose inside `messages`, while Ollama sends the system prompt plus
 *  native `tools` schemas. Reading a turn is the only way to see which one a
 *  given answer came from. */
export interface ModelExchange {
  /** The backend that served this exchange ('webllm' | 'ollama'). */
  backend: string;
  model: string;
  /** The request body as sent, pretty-printed. Truncated to
   *  `ASSISTANT.maxExchangeCharacters`; see `captureExchange`. */
  sent: string;
  /** The model's reply before any parsing, so a turn that failed to parse
   *  shows the text that failed rather than the fallback apology. */
  received: string;
  /** Wall-clock milliseconds for this single round trip. */
  ms: number;
}

/** One step of a turn, for the panel's transcript. A single ordered list
 *  rather than separate exchange/tool collections: the useful reading is
 *  chronological (model asked for this, the tool ran that query, the model
 *  then said this), and two lists have to be re-interleaved to get there. */
export type TraceEntry =
  /** The question the whole turn is answering. First entry, so a pasted
   *  transcript opens with what was asked instead of a wall of system prompt. */
  | { kind: 'question'; text: string }
  | { kind: 'exchange'; exchange: ModelExchange }
  | {
      kind: 'tool';
      name: string;
      input: Record<string, unknown>;
      output: string;
      isError?: boolean;
      /** The ZoneMinder requests this call actually made. */
      apiCalls?: string[];
    };

/** What `AssistantProvider.complete` returns: the reply as text, plus the
 *  round trip for the panel transcript. */
export interface CompletionResult {
  text: string;
  exchange?: ModelExchange;
}

export interface AssistantTurn {
  text?: string;
  toolCalls: ToolCall[];
  /** This turn's raw request/response pair. Collected across every iteration
   *  of `runAssistantTurn` and attached to the turn's final assistant
   *  message, so a multi-tool turn shows each round trip in order. */
  exchange?: ModelExchange;
  /** See `AssistantMessage.raw`: carried onto the pushed assistant message by
   *  `runAssistantTurn` (agent.ts) when a turn is the parse-error fallback. */
  raw?: string;
  /** Undefined when the backend did not report usage: absent counts, not zero
   *  counts, so a backend that stays quiet can't read as "0 tokens used" and
   *  suppress the context-window warning forever. */
  usage?: TokenUsage;
  /** The model's own reasoning for this turn, stripped out of the answer but
   *  kept so the panel can show what it was working on across a multi-step
   *  turn. Undefined for a model that emits none. */
  reasoning?: string;
}

export interface ToolContext {
  profileId: ProfileId;
  /** The question this turn is answering, so a tool can check that a
   *  model-supplied phrase came from the user rather than from an example in
   *  the prompt (see `list_events`' `when`). */
  question?: string;
  /** The active UI locale (BCP 47, e.g. `de` or `en-US`). */
  locale?: string;
  /** Interprets a human time phrase into structured window fields using the
   *  session's model under a constrained schema (window-interpreter.ts,
   *  refs #265). Injected by AskPanel so the tool layer stays provider-free;
   *  a context without it cannot resolve `when` phrases and says so. */
  interpretWhen?: (phrase: string) => Promise<import('./event-range').WindowFields | { error: string }>;
  /** Detected-object labels this install writes (object-labels.ts). A tool
   *  rejects an objectType outside this list rather than querying a label the
   *  detector never emits. */
  objectLabels?: string[];
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
  /**
   * IANA timezone the profile is configured for (falls back to the browser's
   * own zone in AskPanel.tsx, mirroring `buildSystemPrompt`'s `timezone`).
   * `list_events`' `range` input resolves relative dates ("today",
   * "yesterday") against this instead of asking the model to compute an ISO
   * timestamp itself (refs #246; see `event-range.ts`'s `resolveEventRange`).
   * Optional so existing tests that build a minimal `ToolContext` for tools
   * that never touch `range` keep compiling; `list_events`'s executor falls
   * back to `Intl.DateTimeFormat().resolvedOptions().timeZone` when unset.
   */
  timezone?: string;
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

/**
 * A tool the assistant can run. There is no `destructive` flag and no
 * `buildConfirm`: the assistant is read-only, and the type deliberately cannot
 * express an action that changes anything, so "is this safe to run" is not a
 * question the agent loop has to answer at runtime (see TOOLS in tools.ts).
 */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON schema for the tool input, passed to the model. */
  schema: Record<string, unknown>;
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolExecuteResult>;
}

export interface ToolActivity {
  /** A model-side step (its reasoning, or the decision to call a tool) rather
   *  than a tool execution. The panel shows `detail` for these, so a turn that
   *  makes several round trips reports what the model is doing instead of
   *  sitting on "Thinking" (refs #246). */
  kind?: 'model';
  /** Model-side text for `kind: 'model'`; ignored for tool steps. */
  detail?: string;
  toolName: string;
  status: 'running' | 'done' | 'error';
  /** The tool call's input, so the UI can show what it was called with (e.g.
   *  `count_events {"interval":"24 hour"}`) instead of just the tool name. */
  input: Record<string, unknown>;
}

export interface AssistantHost {
  navigate(path: string): void;
  onActivity(activity: ToolActivity): void;
  /** Optional: receives each trace step as it happens, so the panel can show
   *  the transcript DURING a turn instead of only once the answer lands. A
   *  host that does not care simply omits it. */
  onTrace?(entry: TraceEntry): void;
}

export interface AssistantProvider {
  /**
   * A plain completion: this system prompt, this one user message, nothing
   * else. No tool catalog, no few-shot block, no JSON output contract.
   *
   * Triage and answer verification are not assistant turns, and running them
   * through `chat` handed them the whole agent scaffolding. On the WebLLM path
   * that meant the verifier was asked for a verdict while also being
   * told "respond with {\"answer\": ...}" and shown the few-shot example: it
   * replied `{"answer": "There were 10 vehicles detected yesterday."}` instead
   * of OK or PROBLEM, so the check could only ever pass. It was a no-op on two
   * of three backends.
   *
   * `jsonSchema`, when given, asks the backend to CONSTRAIN generation to that
   * JSON Schema (Ollama `response_format: json_schema`, WebLLM XGrammar). A
   * backend that cannot constrain ignores it, so the caller must still parse
   * defensively; the schema turns a usually-right reply into an always-shaped
   * one where the backend supports it.
   */
  complete(system: string, text: string, signal: AbortSignal, jsonSchema?: Record<string, unknown>): Promise<CompletionResult>;
  chat(
    messages: AssistantMessage[],
    tools: ToolDefinition[],
    system: string,
    signal: AbortSignal,
  ): Promise<AssistantTurn>;
  /** The context window this backend is running with, when it is knowable.
   *  Set for on-device models (we pass the window to CreateMLCEngine, so we
   *  know it exactly); for Ollama it is learned from the native `/api/ps`
   *  endpoint after the first chat of the session (the OpenAI-compatible API
   *  never reports `num_ctx`). Undefined means AskPanel cannot judge "close
   *  to full" and so never auto-clears. */
  readonly contextWindow?: number;
}

/** Which chat backend drives the assistant (refs #246): the on-device WebLLM
 *  model (providers/webllm.ts) or a remote OpenAI-compatible server such as
 *  Ollama (providers/openai.ts). */
export type AssistantBackend = 'on-device' | 'ollama';

/** Assembled by the caller (AskPanel) from profile settings plus the
 *  optional secure-stored API key, and handed to `getAssistantProvider`
 *  (providers/provider.ts) to pick and construct the right adapter. The
 *  fields for the backend NOT selected are simply unused by the resulting
 *  provider, so callers can always populate all of them from settings. */
export interface ProviderConfig {
  backend: AssistantBackend;
  /** On-device model id (providers/webllm.ts), e.g. `Qwen2.5-3B-Instruct-q4f16_1-MLC`. */
  modelId: string;
  /** OpenAI-compatible base URL, e.g. `http://localhost:11434/v1`. */
  ollamaBaseUrl: string;
  /** Model name as known to the Ollama server, e.g. `qwen2.5:3b`. */
  ollamaModel: string;
  /** Optional Bearer key for the remote server. Ollama itself needs none. */
  apiKey?: string;
  /** Sampling temperature. Omitted falls back to `ASSISTANT.assistantTemperature`. */
  temperature?: number;
  /** Timeout for one model reply, in ms. Omitted falls back to
   *  `ASSISTANT.requestTimeoutMs`. */
  timeoutMs?: number;
}

export interface SystemPromptContext {
  /** Detected-object labels this install writes, sampled from recent events.
   *  Empty or omitted simply drops the line (see `buildObjectLabelLine`). */
  objectLabels?: string[];
  now: Date;
  timezone: string;
  locale: string;
  zmVersion: string;
}
