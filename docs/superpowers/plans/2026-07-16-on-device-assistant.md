# On-Device Assistant (Ask) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An opt-in, on-device LLM assistant that answers questions about the user's ZoneMinder system and performs confirmed actions by calling the app's existing API layer as tools.

**Architecture:** A store-free, React-free library in `app/src/lib/assistant/` holds the provider interface, tool registry, agent loop, and system prompt. Environment concerns (navigation, confirmation UI, active profile, query cache) are injected through an `AssistantHost` interface implemented by the React layer. Phase 1 builds everything against a deterministic `MockProvider` so the whole feature is CI-testable without WebGPU. Phase 2 adds the real WebLLM adapter, model download manager, and capability probe, verified on real devices.

**Tech Stack:** React 18, TypeScript, Zustand, TanStack Query v5, `@mlc-ai/web-llm` (Phase 2, dynamic import), Vitest, Playwright + playwright-bdd.

Spec: `docs/superpowers/specs/2026-07-16-assistant-design.md`. Issue: #246. Branch: `feature/on-device-ml`.

## Global Constraints

- Every commit for this work references the issue: `refs #246` (rule 19). Never leave a commit unreferenced (rule 36).
- Before every commit run `npm test`, `npx tsc -b`, `npm run build`, and the relevant e2e; run them unwrapped, not through `rtk` (rules 3, 40). All npm commands run from `app/`.
- No hardcoded user-facing strings. Every new string lands in all five locales: `en`, `de`, `es`, `fr`, `zh` (rules 5, 22). Labels stay short enough for a 320px screen.
- The `lib/assistant/` library never imports a Zustand store or React (rules 31, 33). All environment access is injected via `AssistantHost` / `ToolContext`.
- Every named constant lives in the `ASSISTANT` block (or `STORAGE_KEYS`) in `lib/zmninja-ng-constants.ts` (rule 25). No inline magic numbers.
- Query keys and invalidations come only from `lib/query/query-keys.ts` (rule 29); profile-scoped keys take a `ProfileId` from `asProfileId()`.
- Profile-scoped settings read/write through the settings store's `getProfileSettings` / `updateProfileSettings` (rule 7). No global singletons.
- Logging uses `log.assistant` with an explicit `LogLevel` (rule 9). Never `console.*`. Never log message content.
- HTTP goes through `lib/http.ts` (rule 10). `@mlc-ai/web-llm` is dynamically imported only, with a platform/capability check (rule 14).
- All interactive elements get `data-testid="kebab-case"` (rule 13).
- Files stay ~400 LOC max; extract when a module grows (rule 12).
- Every destructive tool call must pass through `host.confirm` resolving `true` before executing; this is enforced in `agent.ts` and asserted in tests (rule d / acceptance d).
- Phase 2 native/WebGPU work ships only after an iOS + Android device pass, stated in the PR (rule 27).

---

# Phase 1: CI-testable core (mock provider)

Phase 1 is a mergeable, fully CI-verified deliverable. It contains no WebGPU or network-to-LLM code. The model picker and Download button render but show "coming in the next update" copy until Phase 2.

## File structure (Phase 1)

Create:
- `app/src/lib/assistant/types.ts`: all shared types/interfaces.
- `app/src/lib/assistant/providers/provider.ts`: `AssistantProvider` interface + `getAssistantProvider()` factory.
- `app/src/lib/assistant/providers/mock.ts`: deterministic scripted provider.
- `app/src/lib/assistant/tools.ts`: tool registry (definitions + executors).
- `app/src/lib/assistant/system-prompt.ts`: `buildSystemPrompt(ctx)`.
- `app/src/lib/assistant/agent.ts`: `runAssistantTurn()`.
- `app/src/lib/assistant/__tests__/{tools,agent,system-prompt,mock}.test.ts`.
- `app/src/stores/assistant.ts`: conversation store (per-profile, session-only).
- `app/src/components/assistant/AskPanel.tsx`: conversation view.
- `app/src/components/assistant/AssistantConfirmCard.tsx`: destructive confirm card.
- `app/src/components/assistant/useAssistantHost.ts`: hook building the `AssistantHost`.
- `app/src/components/settings/AssistantSection.tsx`: settings section.
- `app/tests/features/assistant.feature` + `app/tests/steps/assistant.steps.ts`.

Modify:
- `app/src/lib/zmninja-ng-constants.ts`: add `ASSISTANT` block; add assistant keys to `STORAGE_KEYS`.
- `app/src/lib/logger.ts`: add `log.assistant`.
- `app/src/lib/query/query-keys.ts`: add assistant tool query keys.
- `app/src/api/events.ts`: add `getConsoleEvents()`.
- `app/src/stores/settings.ts`: add `assistantEnabled`, `assistantModelId` to `ProfileSettings` + `DEFAULT_SETTINGS`.
- `app/src/stores/commandPalette.ts`: add `mode` + `openAsk()`.
- `app/src/components/CommandPalette.tsx`: render `AskPanel` in ask mode; leading `?` switches mode.
- `app/src/components/KeyboardShortcuts.tsx`: `?` opens ask mode when enabled.
- `app/src/pages/Settings.tsx`: render `AssistantSection`.
- `app/src/locales/{en,de,es,fr,zh}/translation.json`: `assistant.*` + `settings.assistant.*` keys.
- `app/src/tests/setup.ts`: mock `@mlc-ai/web-llm`.

---

### Task 1: Constants, logger helper, shared types

**Files:**
- Modify: `app/src/lib/zmninja-ng-constants.ts`
- Modify: `app/src/lib/logger.ts` (three edits per the logger factory pattern)
- Create: `app/src/lib/assistant/types.ts`
- Test: `app/src/lib/assistant/__tests__/types.test.ts`

**Interfaces:**
- Produces: the full type surface every later task imports, and the `ASSISTANT` constants object.

- [ ] **Step 1: Write the failing test**

`app/src/lib/assistant/__tests__/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ASSISTANT } from '../../zmninja-ng-constants';
import { log } from '../../logger';
import type { AssistantMessage, ToolDefinition, AssistantHost } from '../types';

describe('assistant constants and types', () => {
  it('exposes tuned defaults', () => {
    expect(ASSISTANT.maxToolIterations).toBe(6);
    expect(ASSISTANT.maxHistoryMessages).toBe(40);
    expect(ASSISTANT.maxListEventsLimit).toBe(25);
    expect(ASSISTANT.maxTokens).toBeGreaterThan(0);
    expect(ASSISTANT.webllmModels.length).toBeGreaterThan(0);
    expect(ASSISTANT.webllmModels.map((m) => m.id)).toContain(ASSISTANT.defaultModelId);
  });

  it('registers the assistant log helper', () => {
    expect(typeof log.assistant).toBe('function');
  });

  it('type surface is importable', () => {
    const msg: AssistantMessage = { role: 'user', text: 'hi' };
    expect(msg.role).toBe('user');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/lib/assistant/__tests__/types.test.ts`
Expected: FAIL (`ASSISTANT` undefined, `log.assistant` not a function, module `../types` missing).

- [ ] **Step 3: Add the `ASSISTANT` constants block**

In `app/src/lib/zmninja-ng-constants.ts`, mirror the existing `KEYBOARD_SHORTCUTS` block style. Add near the other feature blocks:

```typescript
/**
 * In-app assistant (Ask). Model runs on-device via WebGPU. Issue #246.
 * webllmModels ids are the exact WebLLM prebuilt registry ids, fixed in Phase 2.
 */
export const ASSISTANT = {
  maxToolIterations: 6,
  maxHistoryMessages: 40,
  maxTokens: 1024,
  maxListEventsLimit: 25,
  requestTimeoutMs: 120000,
  systemPromptMonitorCap: 50,
  defaultModelId: 'Qwen3-1.7B-q4f16_1-MLC',
  webllmModels: [
    { id: 'Qwen3-1.7B-q4f16_1-MLC', label: 'Qwen3 1.7B', approxSizeMb: 1100 },
    { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B', approxSizeMb: 700 },
  ],
  modelCacheScopePrefix: 'webllm/',
} as const;
```

Add to the existing `STORAGE_KEYS` object:

```typescript
  assistantTestMode: 'zmng-assistant-test-mode',
```

- [ ] **Step 4: Add `log.assistant`**

In `app/src/lib/logger.ts`, three edits per the factory pattern:
1. Class field alongside the others: `assistant = this.makeComponentLogger('Assistant');`
2. Add `'assistant'` to the `componentLoggers` string array.
3. No third edit needed if the array drives `...generatedComponentLoggers`; verify `log.assistant` resolves.

- [ ] **Step 5: Create `types.ts`**

`app/src/lib/assistant/types.ts`:

```typescript
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd app && npx vitest run src/lib/assistant/__tests__/types.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/assistant/types.ts app/src/lib/assistant/__tests__/types.test.ts app/src/lib/zmninja-ng-constants.ts app/src/lib/logger.ts
git commit -m "feat(assistant): add types, constants, and log helper (refs #246)"
```

---

### Task 2: Provider interface + mock provider + factory

**Files:**
- Create: `app/src/lib/assistant/providers/provider.ts`
- Create: `app/src/lib/assistant/providers/mock.ts`
- Test: `app/src/lib/assistant/__tests__/mock.test.ts`

**Interfaces:**
- Consumes: `AssistantProvider`, `AssistantTurn`, `AssistantMessage`, `ToolDefinition` from `types.ts`.
- Produces: `getAssistantProvider(): AssistantProvider`; `MockProvider` with `setScript(turns: AssistantTurn[])`; `isAssistantTestMode(): boolean`.

The mock is scripted: each call to `chat()` returns the next turn from an injected script. E2e drives it through a module-level singleton the test-mode host seeds. Selection is by the `STORAGE_KEYS.assistantTestMode` localStorage flag, read only in non-production (`import.meta.env.PROD === false` or a Vite test flag) so it cannot flip in a shipped build.

- [ ] **Step 1: Write the failing test**

`app/src/lib/assistant/__tests__/mock.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { MockProvider } from '../providers/mock';

describe('MockProvider', () => {
  it('returns scripted turns in order then stops', async () => {
    const p = new MockProvider();
    p.setScript([
      { text: undefined, toolCalls: [{ id: 'c1', name: 'count_events', input: {} }] },
      { text: 'You have 3 events.', toolCalls: [] },
    ]);
    const signal = new AbortController().signal;
    const first = await p.chat([{ role: 'user', text: 'how many?' }], [], 'sys', signal);
    expect(first.toolCalls[0].name).toBe('count_events');
    const second = await p.chat([], [], 'sys', signal);
    expect(second.text).toBe('You have 3 events.');
    expect(second.toolCalls).toEqual([]);
  });

  it('rejects when the signal is already aborted', async () => {
    const p = new MockProvider();
    p.setScript([{ text: 'hi', toolCalls: [] }]);
    const ctl = new AbortController();
    ctl.abort();
    await expect(p.chat([], [], 'sys', ctl.signal)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/lib/assistant/__tests__/mock.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `mock.ts`**

```typescript
import type { AssistantProvider, AssistantTurn, AssistantMessage, ToolDefinition } from '../types';

/** Deterministic provider for unit + e2e tests. Ignores message content and
 *  replays a preset script of turns. */
export class MockProvider implements AssistantProvider {
  private script: AssistantTurn[] = [];
  private cursor = 0;

  setScript(turns: AssistantTurn[]): void {
    this.script = turns;
    this.cursor = 0;
  }

  async chat(
    _messages: AssistantMessage[],
    _tools: ToolDefinition[],
    _system: string,
    signal: AbortSignal,
  ): Promise<AssistantTurn> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const turn = this.script[this.cursor] ?? { text: '', toolCalls: [] };
    this.cursor += 1;
    return turn;
  }
}

/** Singleton the e2e test-mode host seeds via window for determinism. */
export const sharedMockProvider = new MockProvider();
```

- [ ] **Step 4: Implement `provider.ts`**

```typescript
import type { AssistantProvider } from '../types';
import { STORAGE_KEYS } from '../../zmninja-ng-constants';
import { sharedMockProvider } from './mock';

/** True only in non-production builds when the test flag is set. Keeps the
 *  mock backend unreachable in a shipped release. */
export function isAssistantTestMode(): boolean {
  if (import.meta.env.PROD) return false;
  try {
    return localStorage.getItem(STORAGE_KEYS.assistantTestMode) === '1';
  } catch {
    return false;
  }
}

/** Returns the mock in test mode, otherwise the on-device WebLLM provider.
 *  Phase 1 throws for the real path; Phase 2 wires WebLLM here. */
export function getAssistantProvider(): AssistantProvider {
  if (isAssistantTestMode()) return sharedMockProvider;
  throw new Error('On-device model backend is not available yet.');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app && npx vitest run src/lib/assistant/__tests__/mock.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/assistant/providers app/src/lib/assistant/__tests__/mock.test.ts
git commit -m "feat(assistant): add provider interface and mock provider (refs #246)"
```

---

### Task 3: `getConsoleEvents` API function + read-only tools

**Files:**
- Modify: `app/src/api/events.ts`
- Modify: `app/src/lib/query/query-keys.ts`
- Create: `app/src/lib/assistant/tools.ts` (read-only tools this task; destructive in Task 4)
- Test: `app/src/lib/assistant/__tests__/tools.test.ts`

**Interfaces:**
- Consumes: `ToolDefinition`, `ToolContext` from `types.ts`; existing api functions.
- Produces: `getConsoleEvents(interval: string): Promise<ConsoleEventCount[]>`; `readOnlyTools: ToolDefinition[]`; `TOOLS: ToolDefinition[]` (extended in Task 4); `getToolByName(name: string): ToolDefinition | undefined`.

Existing api names to wire (verified): `getMonitors`, `getMonitor`, `getAlarmStatus`, `getEvents(filters: EventFilters)`, `getEvent`, `getLoad`, `getDiskPercent`, `getDaemonCheck`, `getGroups`, `getTags` (from `api/tags.ts`), `getVersion` (from `api/auth.ts`). `EventFilters` fields: `monitorId`, `startDateTime`, `endDateTime`, `notesRegexp`, `eventIds`, `tagIds`, `limit`, `sort`, `direction`. A monitor is `m.Monitor.Id`/`.Name`/`.Function`/`.Enabled` (Enabled is a coerced "0"/"1" string).

- [ ] **Step 1: Write the failing test**

`app/src/lib/assistant/__tests__/tools.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getToolByName } from '../tools';
import type { ToolContext } from '../types';
import { asProfileId } from '../../../api/types';

vi.mock('../../../api/monitors', () => ({
  getMonitors: vi.fn().mockResolvedValue({
    monitors: [{ Monitor: { Id: '1', Name: 'Front Door', Function: 'Modect', Enabled: '1' } }],
  }),
}));

function ctx(): ToolContext {
  return {
    profileId: asProfileId('p1'),
    queryClient: { fetchQuery: (o: { queryFn: () => unknown }) => o.queryFn() } as never,
    host: { confirm: vi.fn(), navigate: vi.fn(), onActivity: vi.fn() },
  };
}

describe('read-only tools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list_monitors returns id/name/function/enabled', async () => {
    const tool = getToolByName('list_monitors')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.output).toContain('Front Door');
  });

  it('navigate rejects a route outside the allowlist', async () => {
    const c = ctx();
    const tool = getToolByName('navigate')!;
    const r = await tool.execute({ path: '/admin/delete-all' }, c);
    expect(r.isError).toBe(true);
    expect(c.host.navigate).not.toHaveBeenCalled();
  });

  it('navigate accepts an allowlisted route and asks the panel to close', async () => {
    const c = ctx();
    const tool = getToolByName('navigate')!;
    const r = await tool.execute({ path: '/events/42' }, c);
    expect(r.isError).toBeFalsy();
    expect(r.closePanel).toBe(true);
    expect(c.host.navigate).toHaveBeenCalledWith('/events/42');
  });

  it('list_events never combines tag and event-id filters', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute({ tag: '5', eventIds: ['1', '2'] }, ctx());
    expect(r.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/lib/assistant/__tests__/tools.test.ts`
Expected: FAIL (`../tools` missing).

- [ ] **Step 3: Add `getConsoleEvents` to `api/events.ts`**

Endpoint `/api/events/consoleEvents/<interval>.json` is unused today. Verify the interval token format against the ZM server at implementation (`"1 hour"`, `"1 day"`); it returns a `results` object keyed by monitor id. Add:

```typescript
export interface ConsoleEventCount {
  monitorId: string;
  count: number;
}

/** Per-monitor event counts over an interval (e.g. "1 hour", "1 day"). Hidden
 *  monitors are dropped by the caller against the monitor list. */
export async function getConsoleEvents(interval: string): Promise<ConsoleEventCount[]> {
  const encoded = encodeURIComponent(interval);
  const res = await httpGet<{ results?: Record<string, number> }>(
    `${getApiBaseUrl()}/events/consoleEvents/${encoded}.json`,
  );
  const results = res.data.results ?? {};
  return Object.entries(results).map(([monitorId, count]) => ({ monitorId, count: Number(count) }));
}
```

(Use the same `getApiBaseUrl()`/`httpGet` helpers the other functions in this file use; match their import style.)

- [ ] **Step 4: Add assistant query keys**

In `app/src/lib/query/query-keys.ts` add under the profile-scoped group:

```typescript
  consoleEvents: (profileId: MaybeProfileId, interval: string) =>
    ['console-events', profileId, interval] as const,
```

- [ ] **Step 5: Implement read-only tools in `tools.ts`**

Build one `ToolDefinition` per read-only tool. Show the shared pattern and the navigate allowlist; each executor calls the named api function, shapes a compact JSON/text string, and returns `{ output }`, catching errors into `{ output: message, isError: true }`. The navigate allowlist:

```typescript
const NAVIGATE_ALLOWLIST = [
  /^\/monitors$/, /^\/monitors\/[^/]+$/, /^\/events$/, /^\/events\/[^/]+$/,
  /^\/montage$/, /^\/timeline$/, /^\/dashboard$/, /^\/server$/,
];
```

Read-only tool executors (each a `ToolDefinition` with `destructive: false`), backed by:

| name | executor calls | output shape | notes |
|---|---|---|---|
| `list_monitors` | `getMonitors()` | `[{id,name,func,enabled}]` | map `m.Monitor.*`; `enabled: m.Monitor.Enabled === '1'` |
| `get_monitor` | `getMonitor(id)` + `getAlarmStatus(id)` | monitor detail + `alarm` | input `{ monitorId: string }` |
| `count_events` | `getConsoleEvents(interval)` then map ids→names via `getMonitors()` | `[{monitor,count}]` | input `{ interval: string }`; drop hidden monitors |
| `list_events` | `getEvents(filters)` | `[{id,monitor,cause,start,score}]`, capped `ASSISTANT.maxListEventsLimit` | see filter rules below |
| `get_event` | `getEvent(id)` | duration/frames/score/notes/tags | input `{ eventId: string }` |
| `get_server_health` | `getLoad()`, `getDiskPercent()`, `getDaemonCheck()`, `getVersion()` | `{load,diskPercent,daemonRunning,version}` | |
| `list_groups` | `getGroups()` | `[{id,name}]` | |
| `list_tags` | `getTags()` | `[{id,name}]` or `[]` | null result → `[]` (ZM < 1.37) |
| `navigate` | validates path against allowlist, then `ctx.host.navigate(path)` | `"navigated"` | returns `{ output, closePanel: true }` on success; `{ isError:true }` on reject |

`list_events` executor rules (encode the server quirks; the model never builds raw filters):

```typescript
async execute(input, ctx) {
  const limit = Math.min(Number(input.limit ?? ASSISTANT.maxListEventsLimit), ASSISTANT.maxListEventsLimit);
  const tag = input.tag as string | undefined;
  const eventIds = input.eventIds as string[] | undefined;
  if (tag && eventIds) {
    return { output: 'Cannot filter by tag and event ids together.', isError: true };
  }
  const filters: EventFilters = {
    monitorId: input.monitorId as string | undefined,
    startDateTime: input.startTime as string | undefined,
    endDateTime: input.endTime as string | undefined,
    notesRegexp: input.objectType ? `detected:.*${input.objectType}` : undefined,
    tagIds: tag ? [tag] : undefined,
    eventIds,
    limit,
    sort: 'StartDateTime',
    direction: 'desc',
  };
  const res = await getEvents(filters);
  const rows = res.events.map((e) => ({
    id: e.Event.Id, monitor: e.Event.MonitorId, cause: e.Event.Cause,
    start: e.Event.StartDateTime, score: e.Event.MaxScore,
  }));
  return { output: JSON.stringify(rows) };
}
```

Export at the bottom:

```typescript
export const readOnlyTools: ToolDefinition[] = [ /* the nine above */ ];
export const TOOLS: ToolDefinition[] = [...readOnlyTools]; // Task 4 spreads in destructiveTools
export function getToolByName(name: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.name === name);
}
```

Each tool's `description` is prescriptive about when to call it and its `schema` is a minimal JSON schema for the input.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd app && npx vitest run src/lib/assistant/__tests__/tools.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/api/events.ts app/src/lib/query/query-keys.ts app/src/lib/assistant/tools.ts app/src/lib/assistant/__tests__/tools.test.ts
git commit -m "feat(assistant): add console-events api and read-only tools (refs #246)"
```

---

### Task 4: Destructive tools with confirm builders

**Files:**
- Modify: `app/src/lib/assistant/tools.ts`
- Modify: `app/src/lib/assistant/__tests__/tools.test.ts`

**Interfaces:**
- Consumes: `ToolDefinition`, `ConfirmRequest`, `ToolContext`.
- Produces: `destructiveTools: ToolDefinition[]`; `TOOLS` now includes them.

Existing api names (verified): `triggerAlarm(id)`, `cancelAlarm(id)`, `setMonitorEnabled(id, enabled)`, `changeMonitorFunction(id, func)`, `changeState(name)` (from `api/states.ts`), `deleteEvent(id)`, `setEventArchived(id, archived)`. Each destructive tool sets `destructive: true` and provides `buildConfirm` producing an i18n key + params. `delete_event.buildConfirm` fetches the event first so the card shows monitor + start time.

- [ ] **Step 1: Write the failing test (append)**

```typescript
import { getToolByName } from '../tools';

it('set_monitor_enabled is destructive and builds a concrete confirm', async () => {
  const tool = getToolByName('set_monitor_enabled')!;
  expect(tool.destructive).toBe(true);
  const req = await tool.buildConfirm!({ monitorId: '4', enabled: false }, ctx());
  expect(req.toolName).toBe('set_monitor_enabled');
  expect(req.messageParams).toMatchObject({ id: '4', enabled: false });
});

it('delete_event confirm fetches event detail for the card', async () => {
  const tool = getToolByName('delete_event')!;
  expect(tool.destructive).toBe(true);
  const req = await tool.buildConfirm!({ eventId: '99' }, ctx());
  expect(req.messageKey).toBe('assistant.confirm.delete_event');
  expect(req.params).toMatchObject({ eventId: '99' });
});
```

Add a `vi.mock('../../../api/events', ...)` returning a `getEvent` stub with `{ Event: { Id: '99', MonitorId: '1', StartDateTime: '2026-07-16 10:00:00' } }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/lib/assistant/__tests__/tools.test.ts`
Expected: FAIL (tools not found / not destructive).

- [ ] **Step 3: Implement destructive tools**

Per-tool spec (all `destructive: true`):

| name | execute | buildConfirm messageKey / params |
|---|---|---|
| `trigger_alarm` | `triggerAlarm(monitorId)` | `assistant.confirm.trigger_alarm` / `{ monitorId }` |
| `cancel_alarm` | `cancelAlarm(monitorId)` | `assistant.confirm.cancel_alarm` / `{ monitorId }` |
| `set_monitor_enabled` | `setMonitorEnabled(monitorId, enabled)` | `assistant.confirm.set_monitor_enabled` / `{ id: monitorId, enabled }` |
| `change_monitor_function` | `changeMonitorFunction(monitorId, func)` | `assistant.confirm.change_monitor_function` / `{ id: monitorId, func }` |
| `change_run_state` | `changeState(state)` | `assistant.confirm.change_run_state` / `{ state }` |
| `delete_event` | `deleteEvent(eventId)` | fetch `getEvent(eventId)`; `assistant.confirm.delete_event` / `{ eventId, monitorId, start }` |
| `archive_event` | `setEventArchived(eventId, archived)` | `assistant.confirm.archive_event` / `{ eventId, archived }` |

Shared executor pattern:

```typescript
{
  name: 'set_monitor_enabled',
  description: 'Enable or disable (arm/disarm) a monitor. Requires confirmation.',
  schema: { type: 'object', properties: { monitorId: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['monitorId', 'enabled'] },
  destructive: true,
  async buildConfirm(input) {
    return {
      toolName: 'set_monitor_enabled',
      messageKey: 'assistant.confirm.set_monitor_enabled',
      messageParams: { id: input.monitorId, enabled: input.enabled },
      params: input,
    };
  },
  async execute(input) {
    await setMonitorEnabled(String(input.monitorId), Boolean(input.enabled));
    return { output: 'done' };
  },
}
```

Then:

```typescript
export const destructiveTools: ToolDefinition[] = [ /* the seven above */ ];
```

Change the `TOOLS` export to `export const TOOLS: ToolDefinition[] = [...readOnlyTools, ...destructiveTools];`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/lib/assistant/__tests__/tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/assistant/tools.ts app/src/lib/assistant/__tests__/tools.test.ts
git commit -m "feat(assistant): add destructive tools with confirm builders (refs #246)"
```

---

### Task 5: System prompt builder

**Files:**
- Create: `app/src/lib/assistant/system-prompt.ts`
- Test: `app/src/lib/assistant/__tests__/system-prompt.test.ts`

**Interfaces:**
- Consumes: `SystemPromptContext`, `ASSISTANT`.
- Produces: `buildSystemPrompt(ctx: SystemPromptContext): string`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../system-prompt';

const base = {
  now: new Date('2026-07-16T22:00:00Z'),
  timezone: 'America/New_York', locale: 'de', zmVersion: '1.37.0',
  monitors: [{ id: '1', name: 'Front Door', func: 'Modect', enabled: true }],
};

describe('buildSystemPrompt', () => {
  it('includes date, timezone, locale instruction, and the monitor table', () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain('America/New_York');
    expect(p).toContain('Front Door');
    expect(p.toLowerCase()).toContain('de');
  });

  it('caps the monitor table at the configured limit', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: String(i), name: `M${i}`, func: 'Monitor', enabled: true }));
    const p = buildSystemPrompt({ ...base, monitors: many });
    expect(p).not.toContain('M60');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/lib/assistant/__tests__/system-prompt.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `system-prompt.ts`**

```typescript
import type { SystemPromptContext } from './types';
import { ASSISTANT } from '../zmninja-ng-constants';

export function buildSystemPrompt(ctx: SystemPromptContext): string {
  const monitorLines = ctx.monitors
    .slice(0, ASSISTANT.systemPromptMonitorCap)
    .map((m) => `${m.id}: ${m.name} (${m.func}, ${m.enabled ? 'enabled' : 'disabled'})`)
    .join('\n');
  return [
    'You are the in-app assistant for a ZoneMinder security app.',
    `Current time: ${ctx.now.toISOString()} in timezone ${ctx.timezone}.`,
    `Answer in the user's language, locale code: ${ctx.locale}.`,
    `ZoneMinder version: ${ctx.zmVersion}.`,
    'Rules: answer only from tool results, never invent ids, prefer the navigate tool after finding results, keep answers short.',
    'Monitors (id: name):',
    monitorLines,
  ].join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/lib/assistant/__tests__/system-prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/assistant/system-prompt.ts app/src/lib/assistant/__tests__/system-prompt.test.ts
git commit -m "feat(assistant): add system prompt builder (refs #246)"
```

---

### Task 6: Agent loop

**Files:**
- Create: `app/src/lib/assistant/agent.ts`
- Test: `app/src/lib/assistant/__tests__/agent.test.ts`

**Interfaces:**
- Consumes: `AssistantProvider`, `AssistantHost`, `AssistantMessage`, `getToolByName`, `ASSISTANT`.
- Produces: `runAssistantTurn(opts): Promise<AssistantMessage[]>`; `truncateHistory(history, max): AssistantMessage[]`.

Loop behavior (spec agent loop + acceptance d): truncate whole turns only; call provider; for each tool call, look up the definition, confirm if destructive (decline → `"User declined this action."`), execute approved calls, append results; `navigate`'s `closePanel` bubbles up; stop on empty toolCalls, iteration cap, or abort; a pending confirm resolves `false` on abort.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runAssistantTurn, truncateHistory } from '../agent';
import { MockProvider } from '../providers/mock';
import type { AssistantHost, AssistantMessage } from '../types';
import { asProfileId } from '../../../api/types';

function host(confirmResult = true): AssistantHost {
  return { confirm: vi.fn().mockResolvedValue(confirmResult), navigate: vi.fn(), onActivity: vi.fn() };
}
const baseOpts = (provider: MockProvider, h: AssistantHost, history: AssistantMessage[]) => ({
  provider, host: h, history,
  ctx: { profileId: asProfileId('p1'), queryClient: {} as never, host: h },
  system: 'sys', signal: new AbortController().signal,
});

describe('truncateHistory', () => {
  it('drops whole tool turns, never leaving an orphan tool result', () => {
    const h: AssistantMessage[] = [
      { role: 'assistant', toolCalls: [{ id: 'c1', name: 't', input: {} }] },
      { role: 'tool', toolResults: [{ callId: 'c1', output: 'x' }] },
      { role: 'user', text: 'again' },
    ];
    const out = truncateHistory(h, 2);
    expect(out[0].role).not.toBe('tool');
  });
});

describe('runAssistantTurn', () => {
  it('does not execute a destructive tool when confirm resolves false', async () => {
    const p = new MockProvider();
    p.setScript([
      { toolCalls: [{ id: 'c1', name: 'set_monitor_enabled', input: { monitorId: '4', enabled: false } }] },
      { text: 'Okay, left it as is.', toolCalls: [] },
    ]);
    const h = host(false);
    const out = await runAssistantTurn(baseOpts(p, h, [{ role: 'user', text: 'disarm 4' }]));
    const toolMsg = out.find((m) => m.role === 'tool');
    expect(toolMsg?.toolResults?.[0].output).toBe('User declined this action.');
    expect(h.confirm).toHaveBeenCalledOnce();
  });

  it('stops at the iteration cap', async () => {
    const p = new MockProvider();
    p.setScript(Array.from({ length: 10 }, () => ({ toolCalls: [{ id: 'c', name: 'list_monitors', input: {} }] })));
    const h = host();
    vi.spyOn(await import('../tools'), 'getToolByName').mockReturnValue({
      name: 'list_monitors', description: '', schema: {}, destructive: false,
      execute: async () => ({ output: '[]' }),
    } as never);
    const out = await runAssistantTurn(baseOpts(p, h, [{ role: 'user', text: 'go' }]));
    expect(out[out.length - 1].text).toContain('allowed number of steps');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/lib/assistant/__tests__/agent.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `agent.ts`**

```typescript
import type { AssistantMessage, AssistantProvider, AssistantHost, ToolContext, ToolResult } from './types';
import { getToolByName, TOOLS } from './tools';
import { ASSISTANT } from '../zmninja-ng-constants';

const ITERATION_CAP_KEY = 'assistant.iteration_cap_reached';

/** Keep whole turns only. Walk from the end; if the first kept message is a
 *  tool result, drop it so history never opens on an orphan. */
export function truncateHistory(history: AssistantMessage[], max: number): AssistantMessage[] {
  const tail = history.slice(-max);
  while (tail.length && tail[0].role === 'tool') tail.shift();
  return tail;
}

export interface RunOpts {
  provider: AssistantProvider;
  host: AssistantHost;
  ctx: ToolContext;
  history: AssistantMessage[];
  system: string;
  signal: AbortSignal;
}

export async function runAssistantTurn(opts: RunOpts): Promise<AssistantMessage[]> {
  const { provider, host, ctx, system, signal } = opts;
  const history = truncateHistory(opts.history, ASSISTANT.maxHistoryMessages);

  for (let i = 0; i < ASSISTANT.maxToolIterations; i++) {
    if (signal.aborted) return history;
    const turn = await provider.chat(history, TOOLS, system, signal);
    const assistantMsg: AssistantMessage = { role: 'assistant', text: turn.text, toolCalls: turn.toolCalls };
    history.push(assistantMsg);

    if (turn.toolCalls.length === 0) return history;

    const results: ToolResult[] = [];
    for (const call of turn.toolCalls) {
      if (signal.aborted) return history;
      const def = getToolByName(call.name);
      if (!def) { results.push({ callId: call.id, output: `Unknown tool: ${call.name}`, isError: true }); continue; }

      if (def.destructive) {
        const req = def.buildConfirm
          ? await def.buildConfirm(call.input, ctx)
          : { toolName: def.name, messageKey: 'assistant.confirm.generic', messageParams: {}, params: call.input };
        const ok = await host.confirm(req).catch(() => false);
        if (!ok) { results.push({ callId: call.id, output: 'User declined this action.' }); continue; }
      }

      host.onActivity({ toolName: call.name, status: 'running' });
      try {
        const r = await def.execute(call.input, ctx);
        results.push({ callId: call.id, output: r.output, isError: r.isError });
        host.onActivity({ toolName: call.name, status: r.isError ? 'error' : 'done' });
      } catch (e) {
        results.push({ callId: call.id, output: e instanceof Error ? e.message : 'Tool failed', isError: true });
        host.onActivity({ toolName: call.name, status: 'error' });
      }
    }
    history.push({ role: 'tool', toolResults: results });
  }

  history.push({ role: 'assistant', text: `__i18n:${ITERATION_CAP_KEY}` });
  return history;
}
```

(The `__i18n:` sentinel is localized by the panel at render; see Task 8.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/lib/assistant/__tests__/agent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/assistant/agent.ts app/src/lib/assistant/__tests__/agent.test.ts
git commit -m "feat(assistant): add agent tool-use loop (refs #246)"
```

---

### Task 7: Conversation store + settings fields

**Files:**
- Create: `app/src/stores/assistant.ts`
- Modify: `app/src/stores/settings.ts` (add `assistantEnabled`, `assistantModelId`)
- Test: `app/src/stores/__tests__/assistant.test.ts`
- Test: extend `app/src/stores/__tests__/settings.test.ts` (or create if absent) for the new defaults

**Interfaces:**
- Produces: `useAssistantStore` with `{ getThread(profileId), append(profileId, msg), reset(profileId), running, setRunning, activities, pushActivity, clearActivities }`. History is session-only (no persist). Settings gain `assistantEnabled: boolean` (default false) and `assistantModelId: string` (default `ASSISTANT.defaultModelId`).

- [ ] **Step 1: Write the failing tests**

`app/src/stores/__tests__/assistant.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useAssistantStore } from '../assistant';

describe('assistant store', () => {
  beforeEach(() => useAssistantStore.getState().reset('p1'));
  it('keeps history per profile', () => {
    useAssistantStore.getState().append('p1', { role: 'user', text: 'hi' });
    expect(useAssistantStore.getState().getThread('p1')).toHaveLength(1);
    expect(useAssistantStore.getState().getThread('p2')).toHaveLength(0);
  });
  it('reset clears one profile only', () => {
    useAssistantStore.getState().append('p1', { role: 'user', text: 'hi' });
    useAssistantStore.getState().reset('p1');
    expect(useAssistantStore.getState().getThread('p1')).toHaveLength(0);
  });
});
```

Settings default test (add to the settings store test):

```typescript
it('defaults the assistant off with the default model', () => {
  const s = useSettingsStore.getState().getProfileSettings('new-profile');
  expect(s.assistantEnabled).toBe(false);
  expect(s.assistantModelId).toBe(ASSISTANT.defaultModelId);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/stores/__tests__/assistant.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `stores/assistant.ts`**

```typescript
import { create } from 'zustand';
import type { AssistantMessage, ToolActivity } from '../lib/assistant/types';

interface AssistantState {
  threads: Record<string, AssistantMessage[]>;
  running: boolean;
  activities: ToolActivity[];
  getThread: (profileId: string) => AssistantMessage[];
  append: (profileId: string, msg: AssistantMessage) => void;
  reset: (profileId: string) => void;
  setRunning: (running: boolean) => void;
  pushActivity: (a: ToolActivity) => void;
  clearActivities: () => void;
}

export const useAssistantStore = create<AssistantState>()((set, get) => ({
  threads: {},
  running: false,
  activities: [],
  getThread: (profileId) => get().threads[profileId] ?? [],
  append: (profileId, msg) =>
    set((s) => ({ threads: { ...s.threads, [profileId]: [...(s.threads[profileId] ?? []), msg] } })),
  reset: (profileId) => set((s) => ({ threads: { ...s.threads, [profileId]: [] } })),
  setRunning: (running) => set({ running }),
  pushActivity: (a) => set((s) => ({ activities: [...s.activities, a] })),
  clearActivities: () => set({ activities: [] }),
}));
```

- [ ] **Step 4: Add settings fields**

In `app/src/stores/settings.ts`: add `assistantEnabled: boolean;` and `assistantModelId: string;` to the `ProfileSettings` interface, and to `DEFAULT_SETTINGS`: `assistantEnabled: false,` and `assistantModelId: ASSISTANT.defaultModelId,` (import `ASSISTANT`). New optional-style fields fall through the `{ ...DEFAULT_SETTINGS, ...stored }` merge, so no version bump is needed.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app && npx vitest run src/stores/__tests__/assistant.test.ts src/stores/__tests__/settings.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/stores/assistant.ts app/src/stores/settings.ts app/src/stores/__tests__/assistant.test.ts app/src/stores/__tests__/settings.test.ts
git commit -m "feat(assistant): add conversation store and settings fields (refs #246)"
```

---

### Task 8: AskPanel, confirm card, and host hook

**Files:**
- Create: `app/src/components/assistant/AssistantConfirmCard.tsx`
- Create: `app/src/components/assistant/useAssistantHost.ts`
- Create: `app/src/components/assistant/AskPanel.tsx`
- Modify: `app/src/locales/{en,de,es,fr,zh}/translation.json` (add `assistant.*`)

**Interfaces:**
- Consumes: `useAssistantStore`, `runAssistantTurn`, `getAssistantProvider`, `buildSystemPrompt`, `getToolByName`, `Markdown`, `ErrorBanner`, `resolveQueryError`, `useCurrentProfile`, `useNavigate`, `useCommandPaletteStore`, `useQueryClient`.
- Produces: `<AskPanel />`; `useAssistantHost(): { host, pendingConfirm, resolveConfirm }`.

The host hook builds an `AssistantHost` whose `confirm` sets a `pendingConfirm` state and returns a Promise resolved by the confirm card's buttons (or `false` on abort/unmount). `navigate` closes the palette then routes. `onActivity` pushes to the store.

- [ ] **Step 1: Write the confirm-card unit test**

`app/src/components/assistant/__tests__/AssistantConfirmCard.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AssistantConfirmCard } from '../AssistantConfirmCard';

it('confirms and cancels a destructive action', () => {
  const onAccept = vi.fn(); const onCancel = vi.fn();
  render(<AssistantConfirmCard request={{ toolName: 'set_monitor_enabled', messageKey: 'assistant.confirm.set_monitor_enabled', messageParams: { id: '4', enabled: false }, params: { monitorId: '4' } }} onAccept={onAccept} onCancel={onCancel} />);
  fireEvent.click(screen.getByTestId('assistant-confirm-cancel'));
  expect(onCancel).toHaveBeenCalled();
  fireEvent.click(screen.getByTestId('assistant-confirm-accept'));
  expect(onAccept).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/components/assistant/__tests__/AssistantConfirmCard.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `AssistantConfirmCard.tsx`**

Card with icon, `t(request.messageKey, request.messageParams)` sentence, a collapsible `<details>` showing `JSON.stringify(request.params, null, 2)`, and Cancel (autofocus, `data-testid="assistant-confirm-cancel"`) + Confirm (`data-testid="assistant-confirm-accept"`) buttons. Root `data-testid="assistant-confirm"`. Props: `{ request: ConfirmRequest; onAccept(): void; onCancel(): void }`.

- [ ] **Step 4: Implement `useAssistantHost.ts`**

```typescript
import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AssistantHost, ConfirmRequest } from '../../lib/assistant/types';
import { useAssistantStore } from '../../stores/assistant';
import { useCommandPaletteStore } from '../../stores/commandPalette';

export function useAssistantHost() {
  const navigate = useNavigate();
  const setOpen = useCommandPaletteStore((s) => s.setOpen);
  const pushActivity = useAssistantStore((s) => s.pushActivity);
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmRequest | null>(null);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const resolveConfirm = useCallback((ok: boolean) => {
    resolverRef.current?.(ok);
    resolverRef.current = null;
    setPendingConfirm(null);
  }, []);

  const host: AssistantHost = {
    confirm: (request) =>
      new Promise<boolean>((resolve) => { resolverRef.current = resolve; setPendingConfirm(request); }),
    navigate: (path) => { setOpen(false); navigate(path); },
    onActivity: (a) => pushActivity(a),
  };
  return { host, pendingConfirm, resolveConfirm };
}
```

- [ ] **Step 5: Implement `AskPanel.tsx`**

Renders the thread from `useAssistantStore.getThread(profileId)` with `<Markdown>` for assistant text (replacing a leading `__i18n:<key>` with `t(key)`), activity chips from `activities`, an input row (`data-testid="assistant-input"`) plus send button (`data-testid="assistant-send"`), an Abort button (`data-testid="assistant-abort"`) while `running`, and the `AssistantConfirmCard` when `pendingConfirm` is set. On send: append the user message, set running, build the `SystemPromptContext` from cached monitors + `useCurrentProfile()` settings/locale, call `runAssistantTurn({ provider: getAssistantProvider(), host, ctx, history, system, signal })`, append the returned tail, clear running. Errors render an `ErrorBanner` with `resolveQueryError(err, t)`. If the assistant is enabled but the provider throws the "not available yet" error (Phase 1 real path), show the Settings call-to-action instead. Aborting or unmounting calls `resolveConfirm(false)` and aborts the controller.

- [ ] **Step 6: Add `assistant.*` i18n keys to all five locales**

Keys: `assistant.title`, `assistant.placeholder`, `assistant.send`, `assistant.abort`, `assistant.thinking`, `assistant.activity.<tool>` (or a generic `assistant.activity.running` with a tool name param), `assistant.iteration_cap_reached`, `assistant.error_generic`, `assistant.not_configured_cta`, `assistant.confirm.set_monitor_enabled`, `assistant.confirm.trigger_alarm`, `assistant.confirm.cancel_alarm`, `assistant.confirm.change_monitor_function`, `assistant.confirm.change_run_state`, `assistant.confirm.delete_event`, `assistant.confirm.archive_event`, `assistant.confirm.generic`, `assistant.confirm.cancel`, `assistant.confirm.accept`, `assistant.confirm.details`. Translate concisely in en/de/es/fr/zh (rule 22).

- [ ] **Step 7: Run tests + build**

Run: `cd app && npx vitest run src/components/assistant && npx tsc -b`
Expected: PASS / no type errors.

- [ ] **Step 8: Commit**

```bash
git add app/src/components/assistant app/src/locales
git commit -m "feat(assistant): add AskPanel, confirm card, and host hook (refs #246)"
```

---

### Task 9: Palette Ask mode + `?` key + Settings section

**Files:**
- Modify: `app/src/stores/commandPalette.ts`
- Modify: `app/src/components/CommandPalette.tsx`
- Modify: `app/src/components/KeyboardShortcuts.tsx`
- Create: `app/src/components/settings/AssistantSection.tsx`
- Modify: `app/src/pages/Settings.tsx`
- Modify: `app/src/locales/{en,de,es,fr,zh}/translation.json` (add `settings.assistant.*`)

**Interfaces:**
- Consumes: `useCurrentProfile().settings.assistantEnabled`, `AskPanel`, `ASSISTANT.webllmModels`.
- Produces: palette `mode: 'command' | 'ask'`, `openAsk()`; `<AssistantSection />`.

- [ ] **Step 1: Extend the palette store**

Add to `CommandPaletteState`: `mode: 'command' | 'ask'`, `openAsk: () => void`, and set `mode: 'command'` in `setOpen(false)`:

```typescript
mode: 'command',
setOpen: (open) => set({ open, mode: open ? get().mode : 'command' }),
openAsk: () => set({ open: true, mode: 'ask' }),
setMode: (mode) => set({ mode }),
```

- [ ] **Step 2: Wire CommandPalette ask mode**

Read `mode = useCommandPaletteStore((s) => s.mode)` and `setMode`. When the input value starts with `?`, call `setMode('ask')`. When `mode === 'ask'`, render `<AskPanel />` in place of the `command-palette-results` div (keep the same `Dialog`/input shell). Add an "Ask" `CommandItem` to the normal list that calls `openAsk()` (touch entry point).

- [ ] **Step 3: Wire the `?` key**

In `KeyboardShortcuts.tsx`, read `const { settings } = useCurrentProfile();` and `const openAsk = useCommandPaletteStore((s) => s.openAsk);`. Change the `?` branch:

```typescript
if (e.key === '?') {
  e.preventDefault();
  if (settings.assistantEnabled) openAsk();
  else setHelpOpen((open) => !open);
  return;
}
```

Add `settings.assistantEnabled` and `openAsk` to the `useCallback` dep array.

- [ ] **Step 4: Implement `AssistantSection.tsx`**

Follow `PlaybackSection.tsx` shape (props `{ settings, update, currentProfile, updateSettings }`). Master `Switch` bound to `settings.assistantEnabled` (`data-testid="assistant-enabled-toggle"`). When on: WebGPU-availability line (`!!navigator.gpu`; Phase 2 refines the probe), a model `<select>` from `ASSISTANT.webllmModels` bound to `assistantModelId` (`data-testid="assistant-model-select"`), a Download button showing `approxSizeMb` and "coming in the next update" copy (Phase 2 wires it), and the on-device privacy disclosure text. When `navigator.gpu` is absent, disable the toggle with an explanatory line.

- [ ] **Step 5: Render it in Settings**

Import and add `<AssistantSection settings={settings} update={update} currentProfile={currentProfile} updateSettings={updateSettings} />` to the section list in `app/src/pages/Settings.tsx`.

- [ ] **Step 6: Add `settings.assistant.*` i18n keys (all five locales)**

`settings.assistant.title`, `.subtitle`, `.enable`, `.no_webgpu`, `.model`, `.download`, `.download_size`, `.coming_soon`, `.privacy`, `.delete`.

- [ ] **Step 7: Run gates**

Run: `cd app && npm test && npx tsc -b && npm run build`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add app/src/stores/commandPalette.ts app/src/components/CommandPalette.tsx app/src/components/KeyboardShortcuts.tsx app/src/components/settings/AssistantSection.tsx app/src/pages/Settings.tsx app/src/locales
git commit -m "feat(assistant): add palette ask mode, ? hook, and settings section (refs #246)"
```

---

### Task 10: E2e feature, steps, and web-llm test mock

**Files:**
- Modify: `app/src/tests/setup.ts` (mock `@mlc-ai/web-llm`)
- Create: `app/tests/features/assistant.feature`
- Create: `app/tests/steps/assistant.steps.ts`

**Interfaces:**
- Consumes: the test-mode flag `STORAGE_KEYS.assistantTestMode` and `sharedMockProvider`. The steps set `localStorage['zmng-assistant-test-mode'] = '1'` before load and seed the mock script via a `window.__assistantMockScript` hook the `AskPanel` reads when in test mode.

Add a small test hook: in test mode, before running a turn, `AskPanel` reads `window.__assistantMockScript` (if present) and calls `sharedMockProvider.setScript(...)`. This is the one production-visible test seam, gated by `isAssistantTestMode()`.

- [ ] **Step 1: Mock `@mlc-ai/web-llm` in setup.ts**

```typescript
vi.mock('@mlc-ai/web-llm', () => ({
  CreateMLCEngine: vi.fn().mockResolvedValue({
    chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content: '{"answer":"ok"}' } }] }) } },
  }),
}));
```

- [ ] **Step 2: Write `assistant.feature`**

```gherkin
@all
Feature: In-app assistant

  Scenario: Assistant is off by default and ? shows keyboard help
    Given I am logged into zmNinjaNg
    When I press the "?" key
    Then I should see the keyboard shortcuts help

  Scenario: Ask a question that counts events
    Given I am logged into zmNinjaNg
    And the assistant is enabled with the mock backend
    And the assistant will answer "You have 3 events" after calling count_events
    When I press the "?" key
    Then the assistant panel should open
    When I ask "how many events today"
    Then the assistant reply should contain "You have 3 events"
    And an activity chip for "count_events" should have appeared

  Scenario: Destructive action requires confirmation
    Given I am logged into zmNinjaNg
    And the assistant is enabled with the mock backend
    And the assistant will call trigger_alarm on monitor "1"
    When I press the "?" key
    And I ask "trigger the alarm on monitor 1"
    Then the assistant confirm card should be visible
    When I cancel the confirmation
    Then monitor "1" should not be in alarm
    When I ask "trigger the alarm on monitor 1"
    And I confirm the confirmation
    Then monitor "1" should be in alarm
```

- [ ] **Step 3: Write `assistant.steps.ts`**

Use `createBdd()`, reuse `Given('I am logged into zmNinjaNg')` from `common.steps.ts`. The enable step navigates to Settings and toggles `assistant-enabled-toggle`, sets the test-mode localStorage flag, and seeds `window.__assistantMockScript`. Assertions use auto-retrying `expect(page.getByTestId(...)).toBeVisible()`. The alarm assertions poll `getAlarmStatus` via `tests/helpers/zm-api.ts`; the confirm scenario cancels the alarm via the helper for cleanup (rule 34: hard-assert, data-derived guards only).

- [ ] **Step 4: Run the e2e feature**

Run: `cd app && npm run test:e2e -- assistant.feature`
Expected: all scenarios pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/tests/setup.ts app/tests/features/assistant.feature app/tests/steps/assistant.steps.ts
git commit -m "test(assistant): add e2e feature, steps, and web-llm mock (refs #246)"
```

---

### Task 11: Documentation

**Files:**
- Modify: `docs/developer-guide/call-flows.rst` (new flow "Asking the assistant a question")
- Modify: `docs/developer-guide/12-shared-services-and-components.rst` (provider layer + agent)
- Modify: `docs/developer-guide/05-component-architecture.rst` (AskPanel)
- Create/modify: `docs/user-guide/` Assistant page + settings page update

- [ ] **Step 1: Write the call flow**

Follow the call-flow recipe (spec Documentation section): title after the user action, one paragraph + the counterintuitive fact (the model runs on-device, tool results never leave the phone), one `sequenceDiagram` with `autonumber`, 8-14 numbered steps tracing "?" → palette ask mode → `runAssistantTurn` → `getToolByName`/executor → `api/*` → `host.confirm` gate → render, each step naming the exact symbol and file, teaching React only at the point of use. End by naming the adjacent flow (command palette navigation).

- [ ] **Step 2: Add chapter entries**

Provider layer + agent in `12-shared-services-and-components.rst`, AskPanel in `05-component-architecture.rst`, each connecting the artifact to the user-visible behavior it serves (rule 37), with one real code example grep-verified against `app/src/`.

- [ ] **Step 3: Write the user-guide Assistant page**

Enable, model download (Phase 2), on-device privacy, confirmation behavior. Update the settings page to mention the section.

- [ ] **Step 4: Run the banned-words + em-dash grep**

```bash
grep -niE "\b(comprehensive|robust|powerful|extensively|thoroughly|excellent|amazing|seamless|cutting.edge|state.of.the.art|user.friendly|ground.up rewrite)\b" docs/developer-guide/call-flows.rst
grep -n "—" docs/developer-guide/call-flows.rst
```

Expected: zero hits each.

- [ ] **Step 5: Commit**

```bash
git add docs/developer-guide docs/user-guide
git commit -m "docs(assistant): add call flow, chapter entries, and user guide (refs #246)"
```

---

### Task 12: Phase 1 verification and PR

- [ ] **Step 1: Run all gates unwrapped (rule 40)**

```bash
cd app
./node_modules/.bin/vitest run
./node_modules/.bin/tsc -b --force
npm run build
npm run test:e2e -- assistant.feature
```

Expected: all pass. State: "Tests verified: npm test ✓, tsc -b ✓, build ✓, test:e2e -- assistant.feature ✓".

- [ ] **Step 2: Revert any native version bump (rule 28)**

If `npm run build` or a sync touched `app/android/app/build.gradle` or `app/ios/App/App.xcodeproj/project.pbxproj`, `git checkout --` them before the PR.

- [ ] **Step 3: Open the PR (do not merge without approval, rule 18)**

PR body references #246, lists what Phase 1 delivers, and states the on-device backend is greyed out pending Phase 2.

---

# Phase 2: On-device WebLLM backend (device-gated)

Phase 2 has no CI coverage (no WebGPU in CI). Every task ends with a manual device pass, and the phase ships only after one iOS and one Android pass, stated in the PR (rule 27). The iOS WebGPU availability question is answered here; if WKWebView lacks WebGPU, the assistant is unavailable on iPhone and the PR records that.

### Task 13: WebGPU capability probe

**Files:**
- Create: `app/src/lib/assistant/webgpu.ts`
- Test: `app/src/lib/assistant/__tests__/webgpu.test.ts`

- [ ] Add `hasWebGpu(): Promise<boolean>` (`!!navigator.gpu` then `await navigator.gpu.requestAdapter()` non-null), cached in a module-level promise. Unit-test both branches by stubbing `navigator.gpu`. Wire the result into `AssistantSection` (replace the Phase 1 `!!navigator.gpu` line) and the `?` hook gate. Commit `feat(assistant): add webgpu capability probe (refs #246)`.

### Task 14: Model download manager

**Files:**
- Create: `app/src/lib/assistant/model-download.ts`
- Test: `app/src/lib/assistant/__tests__/model-download.test.ts`

- [ ] Implement `downloadModel(modelId, onProgress)`, `deleteModel(modelId)`, `isModelCached(modelId)` over the Cache API (`caches`), scoped by `ASSISTANT.modelCacheScopePrefix`. Before download call `navigator.storage?.persist?.()`. Wrap progress in a `backgroundTasks` task (`addTask`/`updateProgress`/`completeTask`, `cancelFn`). Delete = `caches.delete` of the scope. Unit-test cache presence/delete against a mocked `caches`. Wire the Download/Delete buttons in `AssistantSection` to these; handle "cache missing on next use → prompt re-download". Commit `feat(assistant): add on-device model download manager (refs #246)`. Device pass: download, cancel, delete, restart-survives.

### Task 15: WebLLM adapter with constrained JSON

**Files:**
- Create: `app/src/lib/assistant/providers/webllm.ts`
- Test: `app/src/lib/assistant/__tests__/webllm.test.ts`

- [ ] Dynamic-import `@mlc-ai/web-llm` only (rule 14). Implement `WebLlmProvider` with one engine per session, created on first `chat()`, dropped on model change. Constrain generation with `response_format: { type: 'json_object', schema }` against the union `{tool, input} | {answer}`, one tool call per turn. Unit-test the pure request builder and response parser (union-schema assembly, parsing both shapes, malformed JSON → error turn) with the mocked module, no WebGPU. Wire `getAssistantProvider()` (Task 2) to return `WebLlmProvider` when not in test mode. Commit `feat(assistant): add webllm on-device provider (refs #246)`. Device pass: a real question answers offline.

### Task 16: Device passes and Phase 2 PR

- [ ] Run one iOS and one Android device pass covering enable → download → ask → confirm → answer, offline. Record results in the PR (rule 27). Remove the "coming in the next update" copy. Verify gates unwrapped, revert native version bumps (rule 28), open the PR referencing #246, do not merge without approval (rule 18).

---

## Self-review notes

- Spec coverage: requirements a-d map to Tasks 7/9 (off by default), 13-16 (on-device backend), 9 (`?` ask mode), 4+6+8 (confirm gate). Non-goals honored: no remote adapter, no streaming, no vision, no voice. Acceptance a→Task 9 gate, b→Tasks 14-16, c→Task 10 e2e + device, d→Tasks 4/6/8 + agent test.
- The one production-visible test seam (mock provider selection + script injection) is gated by `isAssistantTestMode()` which returns false in production builds (Task 2).
- `changeMonitorFunction`, `getDaemonCheck`, `getVersion` (in `api/auth.ts`), `setEventArchived`, and the flat `ProfileSettings` shape are the verified real names, used throughout.
</content>
</invoke>
