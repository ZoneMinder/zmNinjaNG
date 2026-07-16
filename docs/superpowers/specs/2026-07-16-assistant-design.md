# In-App Assistant (Ask) Design

Issue: #246. Branch: `feature/on-device-ml`.

An opt-in assistant that answers natural-language questions about the user's ZoneMinder system and performs actions on request, by calling the app's existing API layer as tools. The model backend is pluggable: a remote LLM endpoint (URL + key) or an on-device model (downloaded weights, WebGPU). Everything runs inside the webview, so one implementation covers iOS, Android, Electron/Tauri, and web.

Example interactions:

- "How many events did Front Door record today?" (count_events tool)
- "Show me person events from last night" (list_events + navigate)
- "Is the server healthy?" (get_server_health)
- "Disarm the garage camera for now" (set_monitor_enabled, requires confirmation)

## Requirements (from maintainer)

a. Optional, off by default.
b. When enabled, the user picks a backend: remote model (URL, key, model name) or on-device (starts a weights download).
c. Triggered by "?" in the shortcut interface. Free-form questions. The model knows how to use app and/or ZM APIs.
d. Anything destructive MUST get explicit confirmation before executing.

## Non-goals (v1)

- No streaming token output. CapacitorHttp cannot stream; responses render when complete. Revisit later for web/Electron.
- No image/vision tools. Tool results are text and JSON only; no frames are sent to any model.
- No semantic search index (CLIP embeddings). Separate issue if wanted; the tool registry is where such a tool would plug in.
- No voice input.
- No "always allow" for destructive tools. Every destructive call confirms, every time.

## Architecture

New domain folder `app/src/lib/assistant/` (rule 33). The library is pure: it never imports stores or React (rule 31). Everything environment-specific (navigation, confirmation UI, active profile) is injected by the caller through a host interface.

```
lib/assistant/
  types.ts        AssistantMessage, ToolDefinition, ToolCall, ToolOutcome,
                  AssistantTurn, AssistantHost, ProviderConfig
  agent.ts        runAssistantTurn(): the tool-use loop
  tools.ts        tool registry: definitions + executors over api/*
  system-prompt.ts buildSystemPrompt(context): date/time, timezone, monitor list
  providers/
    provider.ts   AssistantProvider interface + factory
    anthropic.ts  Anthropic Messages API adapter
    openai.ts     OpenAI-compatible chat-completions adapter
    webllm.ts     on-device adapter (dynamic import of @mlc-ai/web-llm)
    mock.ts       deterministic provider for unit and e2e tests
  model-download.ts on-device weight download/cache/delete manager
```

### Provider interface

```typescript
interface AssistantProvider {
  /** One model turn: full message history + tool definitions in,
      assistant text and/or tool calls out. Non-streaming. */
  chat(messages: AssistantMessage[], tools: ToolDefinition[],
       signal: AbortSignal): Promise<AssistantTurn>;
}

interface AssistantTurn {
  text?: string;
  toolCalls: ToolCall[];   // empty when the model is done
}
```

Three adapters:

1. **Anthropic** (`providers/anthropic.ts`). POST `{baseUrl}/v1/messages` via `httpPost` (rule 10). Body: `model`, `max_tokens`, `system`, `messages`, `tools` (Anthropic tool schema, `input_schema` per tool). Parses `tool_use` content blocks into `ToolCall`s; `tool_result` blocks go back in a single user message (one block per call, matched by `tool_use_id`). Headers: `x-api-key`, `anthropic-version: 2023-06-01`, and `anthropic-dangerous-direct-browser-access: true` (required for CORS when running as a web page; harmless on native where CapacitorHttp bypasses CORS). Default `baseUrl` `https://api.anthropic.com`, default model `claude-opus-4-8` (editable). Do not send `temperature` or `thinking` fields; current Anthropic models reject sampling params and default thinking behavior is correct here.
2. **OpenAI-compatible** (`providers/openai.ts`). POST `{baseUrl}/chat/completions` with `tools` (function-calling schema) and `tool_choice: "auto"`. Parses `tool_calls` from the choice message; results go back as `role: "tool"` messages. This one adapter covers Ollama (`http://host:11434/v1`), LM Studio, vLLM, OpenRouter, and OpenAI itself. `Authorization: Bearer <key>`; key optional (Ollama needs none).
3. **WebLLM** (`providers/webllm.ts`). See On-device backend below.

Anthropic has no OpenAI-compatible endpoint, which is why two remote adapters exist instead of one.

### Agent loop (`agent.ts`)

```typescript
async function runAssistantTurn(opts: {
  provider: AssistantProvider;
  history: AssistantMessage[];
  host: AssistantHost;
  signal: AbortSignal;
}): Promise<AssistantMessage[]>
```

1. Call `provider.chat()` with history + all tool definitions.
2. For each returned tool call: if the tool is marked `destructive`, await `host.confirm(summary, params)`. Declined: the tool is not executed and the tool result is the string `"User declined this action."` so the model can respond gracefully.
3. Execute approved calls through the registry executor, append results, loop.
4. Stop when the model returns no tool calls, or after `ASSISTANT.maxToolIterations` (constant, 6) iterations, or on abort.

Each loop step emits progress through `host.onActivity(toolName, status)` so the UI can show "Checking events…" chips.

`AssistantHost` (implemented by the React layer, keeps the lib store-free):

```typescript
interface AssistantHost {
  confirm(action: ConfirmRequest): Promise<boolean>;
  navigate(path: string): void;
  onActivity(activity: ToolActivity): void;
}
```

### Tool registry (`tools.ts`)

Each entry: `name`, `description` (prescriptive about when to call it), JSON schema, `destructive: boolean`, `execute(input, ctx)`. `ctx` carries the active `profileId` and the `AssistantHost`. Executors call the existing `api/*` functions; where a React Query cache entry exists, fetch through `queryClient.fetchQuery` with factory keys (rule 29) so answers reuse cached data.

Read-only tools (auto-execute):

| Tool | Backed by | Notes |
|---|---|---|
| `list_monitors` | `api/monitors.ts` getMonitors | Returns id, name, function, enabled, status. Respects hidden-monitor filtering (already dropped at the API boundary). |
| `get_monitor` | getMonitor + getAlarmStatus | Single monitor detail incl. alarm state. |
| `count_events` | `/api/events/consoleEvents/<interval>.json` (new function in `api/events.ts`; endpoint currently unused) | Per-monitor counts over "1 hour", "24 hour" etc. |
| `list_events` | getEvents | Filters: monitorId, startTime, endTime, objectType (Notes REGEXP `detected:`), tag, limit (cap 25). The executor encodes the server's filter-operator quirks (Id IN cannot mix with Tags.Id; one tag per request); the model never builds raw filter segments. |
| `get_event` | getEvent | Duration, frames, alarm frames, score, notes, tags. |
| `get_server_health` | `api/server.ts` getLoad/getDiskPercent/daemonCheck + getVersion | |
| `list_groups` | `api/groups.ts` | |
| `list_tags` | `api/tags.ts` | Empty on ZM < 1.37 (existing graceful degrade). |
| `navigate` | `host.navigate` | Route allowlist only: `/monitors`, `/monitors/:id`, `/events`, `/events/:id`, `/montage`, `/timeline`, `/dashboard`, `/server`. Anything else is rejected in the executor. |

Destructive tools (always confirm, rule d):

| Tool | Backed by |
|---|---|
| `trigger_alarm` / `cancel_alarm` | `api/monitors.ts` triggerAlarm / cancelAlarm |
| `set_monitor_enabled` | setMonitorEnabled |
| `change_monitor_function` | changeFunction (None/Monitor/Modect/Record/Mocord/Nodect) |
| `change_run_state` | `api/states.ts` changeState |
| `delete_event` | deleteEvent (single event per call; no bulk) |
| `archive_event` | archive/unarchive PUT |

`delete_event` is double-gated: the confirm card shows the event id, monitor name, and start time fetched before the dialog renders, so the user confirms a concrete event, not an id.

### System prompt (`system-prompt.ts`)

Built per conversation: current date/time and profile timezone (so "today"/"last night" resolve correctly), monitor id→name table (from cache), ZM version, and behavioral rules (answer from tool results only, never invent ids, prefer navigate after finding results, keep answers short). Kept under ~1k tokens; the monitor table is truncated at 50 monitors.

## UI

### Entry points

"?" today toggles the keyboard-shortcuts help overlay (`KeyboardShortcuts.tsx:127`) and "/" opens the command palette. Ask mode becomes a mode of the command palette:

- Typing a leading `?` in the palette input switches the palette to Ask mode (input placeholder changes, results list is replaced by the conversation view).
- The global `?` key opens the palette directly in Ask mode when the assistant is enabled. When disabled, `?` keeps its current behavior (help overlay), so nothing changes for users who never enable the feature.
- The help overlay stays reachable: a palette command "Keyboard shortcuts" is added, and the Ask panel footer links to it.
- Touch devices: an "Ask" item in the normal palette list, plus Ask mode inherits whatever entry point the palette has on that platform. No new persistent toolbar button in v1.

### Conversation view

`components/assistant/AskPanel.tsx` rendered inside the palette shell (desktop dialog, mobile full-height sheet). Message list with markdown rendering via the existing `lib/markdown.tsx`. Tool activity renders as small chips ("Counting events…"). Abort button while a turn is running. Conversation state lives in a `stores/assistant.ts` zustand store (history, running flag, per-profile) so the panel can close and reopen without losing the thread; history is session-only, not persisted.

Confirmation card (`AssistantConfirmCard.tsx`): icon, plain-language sentence ("Disable monitor Garage (id 4)?"), the raw tool parameters in a collapsible block, Cancel (default focus) and Confirm buttons. `data-testid="assistant-confirm"`, `assistant-confirm-accept`, `assistant-confirm-cancel` (rule 13; all interactive elements in the panel get testids).

All strings via i18n in en/de/es/fr/zh (rules 5, 22).

## Settings

New `AssistantSection` in Settings. Config is profile-scoped in `ProfileSettings` (rule 7): the assistant operates on one profile's server, and keys for a work server should not follow a home profile.

```typescript
assistant: {
  enabled: boolean;            // default false (requirement a)
  backend: 'anthropic' | 'openai-compatible' | 'on-device';
  remoteBaseUrl: string;
  remoteModel: string;
  onDeviceModelId: string;     // one of ASSISTANT.webllmModels
}
```

The API key is never stored in the zustand-persisted settings (that lands in plaintext localStorage). It goes through `lib/security/secureStorage.ts` (`setSecureValue`/`getSecureValue`) under `assistant-api-key-<profileId>`, same mechanism as profile passwords. The settings UI shows set/replace/clear, never the stored value. The log sanitizer must cover the key (add the header names to `lib/log-sanitizer.ts` patterns).

Section behavior:

- Master toggle. Off hides everything else and disables the "?" hook.
- Backend picker. "On-device" is disabled with an explanatory line when `navigator.gpu` is absent (WebKitGTK, older webviews).
- Remote fields: base URL, model, API key, "Test" button that sends a one-line prompt and reports ok/error via `resolveQueryError` semantics (rule 32 for error display).
- On-device: model picker from the curated list, Download button with size shown up front (~600 MB to 1.1 GB), progress + cancel via the `backgroundTasks` store, Delete button that clears the cache.
- Privacy disclosure text under the remote fields: questions and tool results (event metadata, monitor names) are sent to the configured endpoint; nothing is sent anywhere until the user asks a question.

## On-device backend

`@mlc-ai/web-llm` (MLC) via dynamic import only (never static, same reasoning as rule 14: heavy module, absent capability on some platforms). Requires WebGPU.

- Capability probe: `!!navigator.gpu` plus a `requestAdapter()` check, done once and cached. Platforms: Chromium (web, Electron, recent Android WebView) yes; Safari/WKWebView on current iOS yes (verify on device, rule 27); WebKitGTK (Tauri Linux) no, remote-only there.
- Curated model list in constants (see below): small instruct models with WebLLM prebuilt configs, e.g. Qwen3-1.7B q4 and Llama-3.2-1B q4. Exact ids fixed at implementation time from the WebLLM prebuilt registry; the list is data, adding a model is a constants change.
- Download: WebLLM fetches sharded weights into the Cache API. Wrap its progress callback in a `backgroundTasks` task (progress %, cancel). Delete = `caches.delete` of the model's cache scope.
- Tool calling: small models are unreliable at free-form tool JSON, so the WebLLM adapter constrains generation with `response_format: { type: "json_object", schema }` against a union schema of `{tool, input}` or `{answer}` and permits one tool call per turn. The loop above already tolerates single-call turns.
- Engine lifecycle: one engine instance, created on first question, kept for the session, dropped on backend change. First-token latency after load on a phone will be seconds; the UI shows a "thinking" state.

Rule 27 applies: the on-device path ships only after a real-device pass (one iOS, one Android), stated in the PR. The remote path has no native surface beyond existing http plumbing.

## Error handling

- Provider/network errors surface in the conversation as an error bubble with the sanitized message; the turn ends. 401/403 from the remote endpoint gets a specific "check your API key" string.
- Tool executor errors are returned to the model as `is_error` results so it can explain or retry differently; they never crash the loop.
- Iteration cap reached: the assistant posts a fixed "I could not finish this in the allowed number of steps" message.
- Config errors (enabled but no backend configured): the Ask panel shows a single call-to-action linking to Settings.

## Constants

`ASSISTANT` block in `lib/zmninja-ng-constants.ts` (rule 25): `maxToolIterations: 6`, `maxHistoryMessages: 40`, `requestTimeoutMs`, `maxListEventsLimit: 25`, `defaultAnthropicBaseUrl`, `defaultAnthropicModel: 'claude-opus-4-8'`, `webllmModels: [...]`, `apiKeyStoragePrefix`.

## Logging

Add `log.assistant` helper to `lib/logger.ts` (rule 9). Log tool calls at DEBUG with tool name and sanitized params; never log message content or keys at any level.

## Testing

Unit (`lib/assistant/__tests__/`):

- `tools.test.ts`: each executor against mocked api functions; schema validation of inputs; navigate allowlist rejects unknown routes; list_events never emits a Tags+IdIN combination.
- `agent.test.ts`: MockProvider scripted turns; destructive call waits on `host.confirm`; declined path returns the declined string to the model; iteration cap; abort.
- `providers/*.test.ts`: request-body builders produce correct Anthropic vs OpenAI wire shapes (pure functions, no network); response parsers handle tool calls, text, and malformed replies.
- Settings store: assistant defaults present, migration-safe for existing persisted settings.

E2E (`tests/features/assistant.feature`, steps in `tests/steps/assistant.steps.ts`, tag `@all` for panel/settings flows):

- Enable flow: settings → toggle on → backend "openai-compatible" pointed at the MockProvider (a test hook selects `providers/mock.ts` when a localStorage test flag is set, so e2e needs no external LLM and stays deterministic).
- Ask flow: press "?" → palette opens in Ask mode → ask a question whose scripted answer requires `count_events` → assert the reply text and the activity chip appeared.
- Destructive flow: scripted `trigger_alarm` call → confirm card visible → Cancel → assert no alarm fired (poll alarm status via test helper `tests/helpers/zm-api.ts`) → repeat with Confirm → assert alarm on, then cancel it via the same helper (cleanup).
- Disabled flow: with the feature off, "?" opens the help overlay, not Ask mode.

Gates per rule 3, run unwrapped per rule 40. On-device backend: manual device pass only (no WebGPU in CI).

## Documentation

- `docs/user-guide/`: new "Assistant" page (enable, backends, privacy, confirmation behavior); settings page updated.
- `docs/developer-guide/`: new call flow in `call-flows.rst` titled "Asking the assistant a question" tracing "?" → palette Ask mode → agent loop → tool executor → api/* → confirm gate → render (rules 4, 37). Chapter entries: providers and agent in `12-shared-services-and-components.rst`, AskPanel in `05-component-architecture.rst`.

## Implementation phases

Phase 1 (core, mergeable on its own): settings section + secure key storage, provider layer (Anthropic + OpenAI-compatible + mock), tool registry, agent loop, palette Ask mode + confirm cards, i18n, unit + e2e tests, docs. Requirement b's "on-device" option renders greyed out with "coming in the next update" copy if Phase 2 is not in the same release; otherwise ship together.

Phase 2: WebLLM backend: capability probe, model download manager, constrained-JSON adapter, device passes (rule 27).

Phase 3 (out of scope here, separate issue): semantic search tool over event thumbnails.

## Acceptance criteria

- a: fresh install shows no assistant UI anywhere; "?" behavior unchanged until enabled.
- b: remote backend works against a live Ollama and against api.anthropic.com with a key; on-device backend downloads, shows progress, is cancellable and deletable, and answers offline.
- c: "?" opens Ask mode; questions about monitors, events, counts, and server health answer correctly against a live ZM test server; "show me…" requests navigate.
- d: every destructive tool call shows the confirm card first; Cancel executes nothing; there is no code path that executes a destructive tool without `host.confirm` resolving true (enforced in `agent.ts`, asserted in unit tests).
