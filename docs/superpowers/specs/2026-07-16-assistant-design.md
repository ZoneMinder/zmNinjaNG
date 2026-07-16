# In-App Assistant (Ask) Design

Issue: #246. Branch: `feature/on-device-ml`.

An opt-in assistant that answers natural-language questions about the user's ZoneMinder system and performs actions on request, by calling the app's existing API layer as tools. The model runs on-device: downloaded weights executed in the webview through WebGPU (`@mlc-ai/web-llm`). No question, tool result, or key ever leaves the device. One webview implementation covers iOS, Android, Electron, and web wherever WebGPU is present.

Example interactions:

- "How many events did Front Door record today?" (count_events tool)
- "Show me person events from last night" (list_events + navigate)
- "Is the server healthy?" (get_server_health)
- "Disarm the garage camera for now" (set_monitor_enabled, requires confirmation)

## Requirements (from maintainer)

a. Optional, off by default.
b. When enabled, the model runs on-device only: the user picks a curated model and downloads its weights. No remote LLM endpoint, no API key.
c. Triggered by "?" in the shortcut interface. Free-form questions. The model knows how to use app and/or ZM APIs.
d. Anything destructive MUST get explicit confirmation before executing.

## Non-goals (v1)

- No remote LLM backend. On-device only. A pluggable provider interface is kept so a remote adapter can be added later without touching the agent or tools, but no remote adapter ships in v1.
- No streaming token output. Responses render when the turn completes. First-token latency on a phone after model load is seconds; the UI shows a "thinking" state.
- No image/vision tools. Tool results are text and JSON only; no frames are sent to the model.
- No semantic search index (CLIP embeddings). Separate issue if wanted; the tool registry is where such a tool would plug in.
- No voice input.
- No "always allow" for destructive tools. Every destructive call confirms, every time.

## Platform reach

The model runs through WebGPU. Where WebGPU is absent the feature does not exist, and the settings toggle is disabled with an explanation.

- Chromium (web, Electron, recent Android WebView): WebGPU present.
- Tauri Linux (WebKitGTK): no WebGPU. Assistant unavailable.
- iOS/WKWebView: WebGPU support is recent and must be verified on a real device (rule 27). If it is unavailable, the assistant is unavailable on iPhone. This is the load-bearing unknown for the primary platform and is settled in Phase 2.

## Architecture

New domain folder `app/src/lib/assistant/` (rule 33). The library is pure: it never imports stores or React (rule 31). Everything environment-specific (navigation, confirmation UI, active profile, query cache) is injected by the caller through a host interface.

```
lib/assistant/
  types.ts         AssistantMessage, ToolDefinition, ToolCall, ToolOutcome,
                   AssistantTurn, AssistantHost, ProviderConfig
  agent.ts         runAssistantTurn(): the tool-use loop
  tools.ts         tool registry: definitions + executors over api/*
  system-prompt.ts buildSystemPrompt(context): date/time, timezone, locale, monitor list
  providers/
    provider.ts    AssistantProvider interface + factory
    webllm.ts      on-device adapter (dynamic import of @mlc-ai/web-llm)
    mock.ts        deterministic provider for unit and e2e tests
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

Two adapters:

1. **WebLLM** (`providers/webllm.ts`). The only real backend. See On-device backend below.
2. **Mock** (`providers/mock.ts`). Deterministic scripted turns for unit and e2e tests. Selected in place of WebLLM when a namespaced test flag is set (see Testing); the flag is read only in non-production builds so it cannot be flipped in a shipped release.

The `provider.ts` factory returns the mock when the test flag is active, otherwise WebLLM. The interface is kept deliberately backend-neutral so a remote adapter is a later drop-in, not a rewrite.

### Agent loop (`agent.ts`)

```typescript
async function runAssistantTurn(opts: {
  provider: AssistantProvider;
  history: AssistantMessage[];
  host: AssistantHost;
  signal: AbortSignal;
}): Promise<AssistantMessage[]>
```

1. Truncate history to `ASSISTANT.maxHistoryMessages`, dropping whole turns only. A tool-call assistant turn and its matching tool-result user turn are kept or dropped together, and the retained history never begins with an orphan tool result. This is a correctness requirement, not an optimization: a provider that pairs tool calls with results rejects a split or orphaned history.
2. Call `provider.chat()` with the truncated history + all tool definitions.
3. For each returned tool call: if the tool is marked `destructive`, await `host.confirm(request)`. Declined: the tool is not executed and the tool result is the string `"User declined this action."` so the model can respond gracefully.
4. Execute approved calls through the registry executor, append results, loop.
5. `navigate` is terminal for the panel: on a `navigate` call the executor closes the palette, the tool returns success, and any final assistant text surfaces as a toast rather than in the now-closed panel.
6. Stop when the model returns no tool calls, or after `ASSISTANT.maxToolIterations` (6) iterations, or on abort.

Each loop step emits progress through `host.onActivity(toolName, status)` so the UI can show "Checking events…" chips.

`AssistantHost` (implemented by the React layer, keeps the lib store-free):

```typescript
interface AssistantHost {
  confirm(action: ConfirmRequest): Promise<boolean>;
  navigate(path: string): void;
  onActivity(activity: ToolActivity): void;
}
```

Abort semantics: aborting the turn (Abort button, or closing the panel while a turn runs) resolves any pending `host.confirm` as `false` and rejects the in-flight `provider.chat` via the shared `AbortSignal`, so the loop unwinds without executing a half-confirmed action.

### Tool registry (`tools.ts`)

Each entry: `name`, `description` (prescriptive about when to call it), JSON schema, `destructive: boolean`, `execute(input, ctx)`. `ctx` carries the active `profileId`, a `queryClient` for cache reuse, and the `AssistantHost`, all injected by the React layer so the lib stays store-free. Executors call the existing `api/*` functions; where a React Query cache entry exists, fetch through `queryClient.fetchQuery` with factory keys (rule 29) so answers reuse cached data.

Read-only tools (auto-execute):

| Tool | Backed by | Notes |
|---|---|---|
| `list_monitors` | `api/monitors.ts` getMonitors | Returns id, name, function, enabled, status. Respects hidden-monitor filtering (already dropped at the API boundary). |
| `get_monitor` | getMonitor + getAlarmStatus | Single monitor detail incl. alarm state. |
| `count_events` | `/api/events/consoleEvents/<interval>.json` (new function in `api/events.ts`; endpoint currently unused). Verify the interval contract against the ZM API at implementation time; filter out hidden monitors. | Per-monitor counts over "1 hour", "24 hour" etc. |
| `list_events` | getEvents | Filters: monitorId, startTime, endTime, objectType (Notes REGEXP `detected:`), tag, limit (cap 25). The executor encodes the server's filter-operator quirks (Id IN cannot mix with Tags.Id; one tag per request); the model never builds raw filter segments. |
| `get_event` | getEvent | Duration, frames, alarm frames, score, notes, tags. |
| `get_server_health` | `api/server.ts` getLoad/getDiskPercent/daemonCheck + getVersion | |
| `list_groups` | `api/groups.ts` | |
| `list_tags` | `api/tags.ts` | Empty on ZM < 1.37 (existing graceful degrade). |
| `navigate` | `host.navigate` | Route allowlist only: `/monitors`, `/monitors/:id`, `/events`, `/events/:id`, `/montage`, `/timeline`, `/dashboard`, `/server`. Anything else is rejected in the executor. Closes the palette on success (loop step 5). |

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

Built per conversation: current date/time and profile timezone (so "today"/"last night" resolve correctly), the active UI locale with an instruction to answer in that language (rule 5 spirit; a de/es/fr/zh user gets answers in their language), a monitor id→name table (from cache), ZM version, and behavioral rules (answer from tool results only, never invent ids, prefer navigate after finding results, keep answers short). Kept under ~1k tokens; the monitor table is truncated at 50 monitors.

## UI

### Entry points

"?" today toggles the keyboard-shortcuts help overlay (`KeyboardShortcuts.tsx:127`) and "/" opens the command palette. Ask mode becomes a mode of the command palette. The palette store (`stores/commandPalette.ts`) gains a `mode: 'command' | 'ask'` field; today it holds only `open`.

- Typing a leading `?` in the palette input switches the palette to Ask mode (input placeholder changes, results list is replaced by the conversation view).
- The global `?` key opens the palette directly in Ask mode when the assistant is enabled. When disabled, `?` keeps its current behavior (help overlay), so nothing changes for users who never enable the feature.
- The help overlay stays reachable: a palette command "Keyboard shortcuts" is added, and the Ask panel footer links to it.
- Touch devices: an "Ask" item in the normal palette list. The palette already has sidebar-button and mobile-header triggers (per `stores/commandPalette.ts`), so touch users reach Ask without a keyboard. No new persistent toolbar button in v1.

### Conversation view

`components/assistant/AskPanel.tsx` rendered inside the palette shell (desktop dialog, mobile full-height sheet). Message list with markdown rendering via the existing `lib/markdown.tsx`; confirm the renderer sanitizes model output (no raw HTML, no `javascript:` links) since the text is model-generated. Tool activity renders as small chips ("Counting events…"). Abort button while a turn is running. Conversation state lives in a `stores/assistant.ts` zustand store (history, running flag, per-profile) so the panel can close and reopen without losing the thread; history is session-only, not persisted.

Confirmation card (`AssistantConfirmCard.tsx`): icon, plain-language sentence ("Disable monitor Garage (id 4)?"), the raw tool parameters in a collapsible block, Cancel (default focus) and Confirm buttons. `data-testid="assistant-confirm"`, `assistant-confirm-accept`, `assistant-confirm-cancel` (rule 13; all interactive elements in the panel get testids).

All strings via i18n in en/de/es/fr/zh (rules 5, 22).

## Settings

New `AssistantSection` in Settings. Config is profile-scoped in `ProfileSettings` (rule 7): the assistant operates on one profile's server.

```typescript
assistant: {
  enabled: boolean;            // default false (requirement a)
  onDeviceModelId: string;     // one of ASSISTANT.webllmModels
}
```

No API key, no remote fields: nothing to store outside the persisted settings, and nothing sensitive in them.

Section behavior:

- Master toggle. Off hides everything else and disables the "?" hook. The toggle is disabled with an explanatory line when WebGPU is absent (WebKitGTK, older webviews).
- Model picker from the curated list, Download button with size shown up front (~600 MB to 1.1 GB), progress + cancel via the `backgroundTasks` store, Delete button that clears the cache.
- Before download, request `navigator.storage.persist()` to reduce the chance the browser evicts a multi-hundred-MB model under storage pressure (notably iOS Cache API eviction). Handle "model evicted, re-download" gracefully: a missing cache on next use prompts a re-download rather than erroring.
- Privacy disclosure text: everything runs on-device. Questions, tool results, monitor names, and event metadata never leave the phone or desktop. Nothing is sent to any server other than the user's own ZoneMinder (which the app already talks to).

## On-device backend

`@mlc-ai/web-llm` (MLC) via dynamic import only (never static, same reasoning as rule 14: heavy module, absent capability on some platforms). Requires WebGPU.

- Capability probe: `!!navigator.gpu` plus a `requestAdapter()` check, done once and cached. Result gates the settings toggle and the "?" hook.
- Curated model list in constants (see below): small instruct models with WebLLM prebuilt configs. Default `onDeviceModelId` is Qwen3-1.7B q4 (chosen over Llama-3.2-1B q4 for better tool-call reliability); both are offered. Exact ids fixed at implementation time from the WebLLM prebuilt registry; the list is data, adding a model is a constants change.
- Download: WebLLM fetches sharded weights into the Cache API. Wrap its progress callback in a `backgroundTasks` task (progress %, cancel). Delete = `caches.delete` of the model's cache scope.
- Tool calling: small models are unreliable at free-form tool JSON, so the WebLLM adapter constrains generation with `response_format: { type: "json_object", schema }` against a union schema of `{tool, input}` or `{answer}` and permits one tool call per turn. The loop above already tolerates single-call turns.
- Engine lifecycle: one engine instance, created on first question, kept for the session, dropped on model change or when the webview reclaims it. First-token latency after load on a phone is seconds; the UI shows a "thinking" state.

Rule 27 applies: the on-device path ships only after a real-device pass (one iOS, one Android), stated in the PR. This pass is also where the iOS WebGPU question is answered.

## Error handling

- Model load or inference errors surface in the conversation as an error bubble with a sanitized message; the turn ends.
- Tool executor errors are returned to the model as error results so it can explain or retry differently; they never crash the loop.
- Iteration cap reached: the assistant posts a fixed "I could not finish this in the allowed number of steps" message.
- Config errors (enabled but no model downloaded): the Ask panel shows a single call-to-action linking to Settings to download a model.
- WebGPU absent at question time (should be prevented by the toggle gate, but defensive): a fixed message explaining the device does not support on-device models.

## Constants

`ASSISTANT` block in `lib/zmninja-ng-constants.ts` (rule 25): `maxToolIterations: 6`, `maxHistoryMessages: 40`, `maxTokens`, `requestTimeoutMs`, `maxListEventsLimit: 25`, `webllmModels: [...]`, `defaultModelId`, `modelCacheScopePrefix`.

## Logging

Add `log.assistant` helper to `lib/logger.ts` (rule 9). Log tool calls at DEBUG with tool name and sanitized params; never log message content at any level. No keys exist to sanitize.

## Testing

Unit (`lib/assistant/__tests__/`):

- `tools.test.ts`: each executor against mocked api functions; schema validation of inputs; navigate allowlist rejects unknown routes; list_events never emits a Tags+IdIN combination.
- `agent.test.ts`: MockProvider scripted turns; destructive call waits on `host.confirm`; declined path returns the declined string to the model; history truncation drops whole turns and never leaves an orphan tool result; iteration cap; abort resolves a pending confirm as false.
- `providers/webllm.test.ts`: the request builder and response parser as pure functions (union-schema prompt assembly, parsing `{tool, input}` vs `{answer}`, malformed JSON handling). No WebGPU or network in the test.
- Settings store: assistant defaults present, migration-safe for existing persisted settings.

E2E (`tests/features/assistant.feature`, steps in `tests/steps/assistant.steps.ts`, tag `@all` for panel/settings flows). CI has no WebGPU, so every e2e run uses the MockProvider via the namespaced test flag; the real WebLLM path is never exercised in CI.

- Enable flow: settings → toggle on → (mock stands in for the model, no download) → assert the assistant is usable.
- Ask flow: press "?" → palette opens in Ask mode → ask a question whose scripted answer requires `count_events` → assert the reply text and the activity chip appeared.
- Destructive flow: scripted `trigger_alarm` call → confirm card visible → Cancel → assert no alarm fired (poll alarm status via test helper `tests/helpers/zm-api.ts`) → repeat with Confirm → assert alarm on, then cancel it via the same helper (cleanup).
- Disabled flow: with the feature off, "?" opens the help overlay, not Ask mode.

Gates per rule 3, run unwrapped per rule 40. On-device backend: manual device pass only (no WebGPU in CI).

## Documentation

- `docs/user-guide/`: new "Assistant" page (enable, model download, on-device privacy, confirmation behavior); settings page updated.
- `docs/developer-guide/`: new call flow in `call-flows.rst` titled "Asking the assistant a question" tracing "?" → palette Ask mode → agent loop → tool executor → api/* → confirm gate → render (rules 4, 37). Chapter entries: provider layer and agent in `12-shared-services-and-components.rst`, AskPanel in `05-component-architecture.rst`.

## Implementation phases

Phase 1 (CI-testable end to end with the mock provider): settings section, provider interface + mock, tool registry, agent loop, palette Ask mode + confirm cards, conversation store, i18n, unit + e2e tests, docs. Everything here runs against the mock, so it needs no WebGPU and is fully verified in CI. The model picker and Download button render but are wired to Phase 2's download manager; if Phase 2 is not in the same release they show "coming in the next update" copy.

Phase 2 (device-gated): the real WebLLM adapter, capability probe, model download/cache/delete manager, constrained-JSON generation, persistent-storage request and re-download handling, and the iOS + Android device passes (rule 27). The iOS WebGPU availability question is answered here.

Phase 3 (out of scope here, separate issue): semantic search tool over event thumbnails.

## Acceptance criteria

- a: fresh install shows no assistant UI anywhere; "?" behavior unchanged until enabled.
- b: on-device backend downloads a curated model, shows progress, is cancellable and deletable, survives an app restart (persistent storage), and answers with no network to any LLM. Where WebGPU is absent the toggle is disabled with an explanation.
- c: "?" opens Ask mode; questions about monitors, events, counts, and server health answer correctly against a live ZM test server; "show me…" requests navigate and close the panel.
- d: every destructive tool call shows the confirm card first; Cancel executes nothing; there is no code path that executes a destructive tool without `host.confirm` resolving true (enforced in `agent.ts`, asserted in unit tests).
</content>
</invoke>
