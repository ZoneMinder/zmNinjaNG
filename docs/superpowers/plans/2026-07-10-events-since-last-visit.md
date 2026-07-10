# Events Since Last Visit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monitor card's fixed 7-day event count with a per-monitor count of events recorded since the user last looked at that monitor.

**Architecture:** A persisted, profile-scoped watermark store holds the `StartDateTime` of the newest event the user has seen per monitor. One thin API call per monitor returns both the count of newer events and the newest event's timestamp in a single response, so clearing the badge costs no extra request. The badge clears when the user opens the monitor's events, or opens its detail page with the recent-events list actually rendered.

**Tech Stack:** React 19, TypeScript, Zustand (`persist` middleware), TanStack Query v5, Vitest, Playwright + playwright-bdd.

Spec: `docs/superpowers/specs/2026-07-10-events-since-last-visit-design.md`. Issue: #239.

## Global Constraints

- All `npm` commands run from `app/`. Never run two `npm run test:e2e` at once in this checkout (rule 39).
- Before every commit: `npx vitest run`, `./node_modules/.bin/tsc -b`, `npm run build`. Run them directly, not through a summarizing wrapper (rule 40).
- Every commit for this work references the issue: `refs #239`. Never `fixes` until the user confirms (rule 19).
- One logical change per commit (rule 19). Do not batch unrelated changes (rule 20).
- Query keys come from `lib/query/query-keys.ts` only. Never inline a key array (rule 29).
- Zustand: subscribe with field selectors; never mutate objects from `getState()`; all changes go through actions (rule 30).
- Named constants live in `lib/zmninja-ng-constants.ts` (rule 25).
- Polling intervals come from `useBandwidthSettings()` / `BandwidthSettings`. Never hardcode (rule 8).
- Logging via `log.*` with an explicit `LogLevel`. Never `console.*` (rule 9).
- User-facing strings in all five locales: `en`, `de`, `es`, `fr`, `zh` (rule 5). Keep labels short (rule 22).
- `data-testid="kebab-case"` on interactive elements (rule 13).
- Prose in commits, comments, and docs: no em-dashes, no superlatives, no marketing language (rule 1).
- `app/tsconfig.tests.json` now typechecks `tests/`, so `tsc -b` will catch errors in step definitions.

**Exact values from the spec, copied verbatim:**

- Storage key: `monitorSeenStore: 'zmng-monitor-seen'`
- Bandwidth field: `monitorNewEventsInterval`, `60000` normal, `120000` low
- Badge formatting: `formatEventCount` from `lib/utils.ts`, unchanged (exact to 999, then `1k+`)
- Test id: `monitor-new-events-badge`
- i18n key: `monitors.new_events_count`
- Filter operator: strict `>`, verified against ZM 1.39.1. `>=` counts the watermark event itself and must not be used.

---

## File Structure

**Create:**
- `app/src/stores/monitorSeen.ts`: the persisted watermark store. Sole owner of what "seen" means.
- `app/src/stores/__tests__/monitorSeen.test.ts`
- `app/src/hooks/useMonitorNewEvents.ts`: fans out one query per monitor, joins with the store, returns counts. Keeps `Monitors.tsx` from growing.
- `app/src/hooks/__tests__/useMonitorNewEvents.test.tsx`

**Modify:**
- `app/src/lib/zmninja-ng-constants.ts`: add `STORAGE_KEYS.monitorSeenStore`, add `BandwidthSettings.monitorNewEventsInterval` + both mode objects; later remove `consoleEventsInterval`.
- `app/src/api/events.ts`: add `getMonitorEventsSince`; later remove `getConsoleEvents`.
- `app/src/api/types.ts`: later remove `ConsoleEventsResponseSchema`.
- `app/src/lib/query/query-keys.ts`: add `monitorEventsSince`; later remove `consoleEvents`/`consoleEventsList`.
- `app/src/pages/Monitors.tsx:78-83, 250, 264`: swap the `consoleEvents` query for the new hook.
- `app/src/components/monitors/MonitorCard.tsx:199-203, 344-349`: badge renders the new count, Events button clears.
- `app/src/components/monitors/MonitorRecentEvents.tsx`: clears on render of the list.
- `app/src/components/settings/HiddenMonitorsSection.tsx:65`: repoint invalidation.
- `app/src/locales/{en,de,es,fr,zh}/translation.json`
- `app/tests/features/monitors.feature`, `app/tests/steps/monitors.steps.ts`
- `docs/developer-guide/call-flows.rst`, `05-component-architecture.rst`, `07-api-and-data-fetching.rst`, `12-shared-services-and-components.rst`

**Task order rationale:** store and API are independent leaves, both testable alone. The hook joins them. The UI consumes the hook. Cleanup lands last, once nothing calls `getConsoleEvents`. Docs land with the behavior they describe.

---

## Task 1: The watermark store

**Files:**
- Create: `app/src/stores/monitorSeen.ts`
- Create: `app/src/stores/__tests__/monitorSeen.test.ts`
- Modify: `app/src/lib/zmninja-ng-constants.ts` (STORAGE_KEYS block, around line 371)

**Interfaces:**
- Consumes: `STORAGE_KEYS` from `lib/zmninja-ng-constants`.
- Produces:
  - `useMonitorSeenStore` (Zustand hook)
  - `hasWatermark(profileId: string, monitorId: string): boolean`
  - `getWatermark(profileId: string, monitorId: string): string | null`: returns `null` both for "seeded with no events" and for "absent". Callers that need to tell them apart use `hasWatermark`.
  - `seed(profileId: string, monitorId: string, newest: string | null): void`: no-op if a watermark already exists.
  - `markSeen(profileId: string, monitorId: string, newest: string | null): void`: no-op when `newest` is `null`.
  - `clearProfile(profileId: string): void`

The absent/`null` distinction is the heart of this store. `hasWatermark === false` means "never seeded, seed it and show no badge". A stored `null` means "seeded when this monitor had zero events", so every event since is genuinely new and the count query runs unfiltered.

- [ ] **Step 1: Add the storage key**

In `app/src/lib/zmninja-ng-constants.ts`, inside the `STORAGE_KEYS` object, after `eventFavoritesStore`:

```ts
  eventFavoritesStore: 'zmng-event-favorites',
  monitorSeenStore: 'zmng-monitor-seen',
```

- [ ] **Step 2: Write the failing test**

Create `app/src/stores/__tests__/monitorSeen.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useMonitorSeenStore } from '../monitorSeen';

const P1 = 'profile-1';
const P2 = 'profile-2';

describe('useMonitorSeenStore', () => {
  beforeEach(() => {
    useMonitorSeenStore.setState({ profileWatermarks: {} });
  });

  it('reports no watermark for a monitor it has never seen', () => {
    const { hasWatermark, getWatermark } = useMonitorSeenStore.getState();
    expect(hasWatermark(P1, '1')).toBe(false);
    expect(getWatermark(P1, '1')).toBeNull();
  });

  it('seeds a monitor with the newest event timestamp', () => {
    useMonitorSeenStore.getState().seed(P1, '1', '2026-07-09 14:26:47');
    const { hasWatermark, getWatermark } = useMonitorSeenStore.getState();
    expect(hasWatermark(P1, '1')).toBe(true);
    expect(getWatermark(P1, '1')).toBe('2026-07-09 14:26:47');
  });

  it('distinguishes "seeded with no events" from "never seeded"', () => {
    useMonitorSeenStore.getState().seed(P1, '1', null);
    const { hasWatermark, getWatermark } = useMonitorSeenStore.getState();
    // Seeded, so no badge on first sight. Watermark is null, so the count
    // query runs unfiltered and the first event ever recorded reads as new.
    expect(hasWatermark(P1, '1')).toBe(true);
    expect(getWatermark(P1, '1')).toBeNull();
  });

  it('does not re-seed a monitor that already has a watermark', () => {
    useMonitorSeenStore.getState().seed(P1, '1', '2026-07-01 00:00:00');
    useMonitorSeenStore.getState().seed(P1, '1', '2026-07-09 14:26:47');
    expect(useMonitorSeenStore.getState().getWatermark(P1, '1')).toBe('2026-07-01 00:00:00');
  });

  it('markSeen advances the watermark', () => {
    useMonitorSeenStore.getState().seed(P1, '1', '2026-07-01 00:00:00');
    useMonitorSeenStore.getState().markSeen(P1, '1', '2026-07-09 14:26:47');
    expect(useMonitorSeenStore.getState().getWatermark(P1, '1')).toBe('2026-07-09 14:26:47');
  });

  it('markSeen with no newest event is a no-op', () => {
    useMonitorSeenStore.getState().seed(P1, '1', '2026-07-01 00:00:00');
    useMonitorSeenStore.getState().markSeen(P1, '1', null);
    expect(useMonitorSeenStore.getState().getWatermark(P1, '1')).toBe('2026-07-01 00:00:00');
  });

  it('scopes watermarks per profile', () => {
    useMonitorSeenStore.getState().seed(P1, '1', '2026-07-09 14:26:47');
    expect(useMonitorSeenStore.getState().hasWatermark(P2, '1')).toBe(false);

    useMonitorSeenStore.getState().seed(P2, '1', '2026-07-05 09:00:00');
    expect(useMonitorSeenStore.getState().getWatermark(P1, '1')).toBe('2026-07-09 14:26:47');
    expect(useMonitorSeenStore.getState().getWatermark(P2, '1')).toBe('2026-07-05 09:00:00');
  });

  it('clearProfile drops only that profile', () => {
    useMonitorSeenStore.getState().seed(P1, '1', '2026-07-09 14:26:47');
    useMonitorSeenStore.getState().seed(P2, '1', '2026-07-05 09:00:00');
    useMonitorSeenStore.getState().clearProfile(P1);
    expect(useMonitorSeenStore.getState().hasWatermark(P1, '1')).toBe(false);
    expect(useMonitorSeenStore.getState().hasWatermark(P2, '1')).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `node node_modules/vitest/vitest.mjs run src/stores/__tests__/monitorSeen.test.ts`
Expected: FAIL, `Failed to resolve import "../monitorSeen"`.

- [ ] **Step 4: Implement the store**

Create `app/src/stores/monitorSeen.ts`:

```ts
/**
 * Monitor "seen" watermarks.
 *
 * Per profile, per monitor: the StartDateTime of the newest event the user had
 * seen the last time they looked at that monitor's events. The monitor card
 * badge counts events recorded after it.
 *
 * Absent versus null is load-bearing. An absent key means the monitor has never
 * been seeded, so the first response seeds it and shows no badge (a fresh
 * install must not greet the user with a week of backlog). A stored null means
 * the monitor had no events at all when it was seeded, so every event since is
 * new and the count query runs unfiltered (refs #239).
 *
 * The value is always a server StartDateTime, never a local Date.now(): clock
 * skew between the app and the ZoneMinder server would hide or duplicate events.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { STORAGE_KEYS } from '../lib/zmninja-ng-constants';

interface MonitorSeenState {
  // profileId -> monitorId -> newest seen StartDateTime (null: seeded empty)
  profileWatermarks: Record<string, Record<string, string | null>>;

  hasWatermark: (profileId: string, monitorId: string) => boolean;
  getWatermark: (profileId: string, monitorId: string) => string | null;
  seed: (profileId: string, monitorId: string, newest: string | null) => void;
  markSeen: (profileId: string, monitorId: string, newest: string | null) => void;
  clearProfile: (profileId: string) => void;
}

function withWatermark(
  state: MonitorSeenState,
  profileId: string,
  monitorId: string,
  newest: string | null
): Pick<MonitorSeenState, 'profileWatermarks'> {
  return {
    profileWatermarks: {
      ...state.profileWatermarks,
      [profileId]: { ...(state.profileWatermarks[profileId] ?? {}), [monitorId]: newest },
    },
  };
}

export const useMonitorSeenStore = create<MonitorSeenState>()(
  persist(
    (set, get) => ({
      profileWatermarks: {},

      hasWatermark: (profileId, monitorId) =>
        Object.prototype.hasOwnProperty.call(
          get().profileWatermarks[profileId] ?? {},
          monitorId
        ),

      getWatermark: (profileId, monitorId) =>
        get().profileWatermarks[profileId]?.[monitorId] ?? null,

      seed: (profileId, monitorId, newest) => {
        if (get().hasWatermark(profileId, monitorId)) return;
        set((state) => withWatermark(state, profileId, monitorId, newest));
      },

      markSeen: (profileId, monitorId, newest) => {
        if (newest === null) return;
        set((state) => withWatermark(state, profileId, monitorId, newest));
      },

      clearProfile: (profileId) => {
        set((state) => {
          if (!state.profileWatermarks[profileId]) return state;
          const next = { ...state.profileWatermarks };
          delete next[profileId];
          return { ...state, profileWatermarks: next };
        });
      },
    }),
    {
      name: STORAGE_KEYS.monitorSeenStore,
    }
  )
);
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `node node_modules/vitest/vitest.mjs run src/stores/__tests__/monitorSeen.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Verify and commit**

```bash
node node_modules/vitest/vitest.mjs run
./node_modules/.bin/tsc -b
npm run build
git add src/stores/monitorSeen.ts src/stores/__tests__/monitorSeen.test.ts src/lib/zmninja-ng-constants.ts
git commit -m "feat(monitors): add per-monitor seen-watermark store

Profile-scoped, persisted. Absent means never seeded; a stored null means
seeded while the monitor had no events, so its first event reads as new.

refs #239"
```

---

## Task 2: The count API

**Files:**
- Modify: `app/src/api/events.ts` (add after `getEvents`)
- Modify: `app/src/api/__tests__/events.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `getApiClient` from `api/client`, `log`/`LogLevel` from `lib/logger`.
- Produces: `getMonitorEventsSince(monitorId: string, since: string | null): Promise<{ count: number; newest: string | null }>`

`getEvents` cannot be reused: it hardcodes `params.limit = 100` per page and loops, so asking for one event transfers a hundred. This function asks for exactly one row, sorted newest first, and reads the total from `pagination.count`. That single response answers both "how many are new" and "what timestamp should I stamp when the user clears this badge".

- [ ] **Step 1: Write the failing test**

Append to `app/src/api/__tests__/events.test.ts` (inside the existing top-level `describe`, alongside the other blocks; the file already mocks `getApiClient` as `mockGet`):

```ts
  describe('getMonitorEventsSince', () => {
    it('uses the strict > operator and returns count plus newest', async () => {
      mockGet.mockResolvedValue({
        data: {
          events: [{ Event: { Id: '900', StartDateTime: '2026-07-09 14:26:47' } }],
          pagination: { pageCount: 31, page: 1, current: 1, count: 31, prevPage: false, nextPage: true },
        },
      });

      const result = await getMonitorEventsSince('1', '2026-07-01 00:00:00');

      expect(mockGet).toHaveBeenCalledWith(
        `/events/index/MonitorId%3A1/${encodeURIComponent('StartDateTime >:2026-07-01 00:00:00')}.json`,
        expect.objectContaining({
          params: { limit: 1, sort: 'StartDateTime', direction: 'desc' },
        })
      );
      expect(result).toEqual({ count: 31, newest: '2026-07-09 14:26:47' });
    });

    it('omits the date filter when there is no watermark', async () => {
      mockGet.mockResolvedValue({
        data: {
          events: [{ Event: { Id: '900', StartDateTime: '2026-07-09 14:26:47' } }],
          pagination: { pageCount: 1, page: 1, current: 1, count: 61, prevPage: false, nextPage: false },
        },
      });

      const result = await getMonitorEventsSince('1', null);

      expect(mockGet).toHaveBeenCalledWith(
        '/events/index/MonitorId%3A1.json',
        expect.objectContaining({ params: { limit: 1, sort: 'StartDateTime', direction: 'desc' } })
      );
      expect(result).toEqual({ count: 61, newest: '2026-07-09 14:26:47' });
    });

    it('returns a null newest when nothing matches', async () => {
      mockGet.mockResolvedValue({
        data: {
          events: [],
          pagination: { pageCount: 0, page: 1, current: 1, count: 0, prevPage: false, nextPage: false },
        },
      });

      const result = await getMonitorEventsSince('1', '2099-01-01 00:00:00');

      expect(result).toEqual({ count: 0, newest: null });
    });

    it('treats a missing pagination block as zero', async () => {
      mockGet.mockResolvedValue({ data: { events: [] } });

      const result = await getMonitorEventsSince('1', null);

      expect(result).toEqual({ count: 0, newest: null });
    });
  });
```

Add `getMonitorEventsSince` to the import list at the top of that test file.

- [ ] **Step 2: Run the test and watch it fail**

Run: `node node_modules/vitest/vitest.mjs run src/api/__tests__/events.test.ts -t getMonitorEventsSince`
Expected: FAIL, `getMonitorEventsSince is not a function`.

- [ ] **Step 3: Implement**

Add to `app/src/api/events.ts`, after `getEvents`:

```ts
/**
 * Count a monitor's events recorded after `since`, and report the newest one.
 *
 * One request answers both questions: sorting descending and taking a single
 * row gives the newest event, while ZoneMinder reports the full match size in
 * `pagination.count`. That is what lets the monitor card stamp its watermark
 * from cache when the user opens the events, instead of issuing a second
 * request (refs #239).
 *
 * The operator is strict `>`, verified against ZM 1.39.1: `>=` matches the
 * watermark event itself, so the badge would show a permanent "1 new" for an
 * event the user had already seen.
 *
 * `since` of null means no watermark yet, so every event counts.
 */
export async function getMonitorEventsSince(
  monitorId: string,
  since: string | null
): Promise<{ count: number; newest: string | null }> {
  const client = getApiClient();

  const segments = [`MonitorId:${monitorId}`];
  if (since !== null) {
    segments.push(`StartDateTime >:${since}`);
  }
  const url = `/events/index${segments.map((s) => `/${encodeURIComponent(s)}`).join('')}.json`;

  const response = await client.get<EventsResponse>(url, {
    params: { limit: 1, sort: 'StartDateTime', direction: 'desc' },
    intent: `Count events for monitor ${monitorId} since ${since ?? 'the beginning'}`,
  });

  const count = response.data.pagination?.count ?? 0;
  const newest = response.data.events?.[0]?.Event?.StartDateTime ?? null;

  log.api('Counted new events for monitor', LogLevel.DEBUG, { monitorId, since, count });

  return { count, newest };
}
```

Note: no `validateApiResponse` here. The response is read for two scalars and a
missing `pagination` block already degrades to zero, so a schema adds a failure
mode without adding a guarantee. `getEvents` above validates because callers
render its events.

- [ ] **Step 4: Run the test and watch it pass**

Run: `node node_modules/vitest/vitest.mjs run src/api/__tests__/events.test.ts -t getMonitorEventsSince`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the query key**

In `app/src/lib/query/query-keys.ts`, after the `consoleEventsList` entry:

```ts
  /** Count of a monitor's events newer than a watermark. Keyed by the
   *  watermark so clearing the badge invalidates exactly one monitor. */
  monitorEventsSince: (
    profileId: MaybeProfileId,
    monitorId: string,
    since: string | null
  ) => ['monitor-events-since', profileId, monitorId, since] as const,
```

- [ ] **Step 6: Verify and commit**

```bash
node node_modules/vitest/vitest.mjs run
./node_modules/.bin/tsc -b
npm run build
git add src/api/events.ts src/api/__tests__/events.test.ts src/lib/query/query-keys.ts
git commit -m "feat(events): add getMonitorEventsSince count query

One request returns both the count of events after a watermark and the
newest event's StartDateTime. Uses the strict > operator; >= matches the
watermark event itself.

refs #239"
```

---

## Task 3: The bandwidth interval

**Files:**
- Modify: `app/src/lib/zmninja-ng-constants.ts` (`BandwidthSettings` interface around line 661, `normal` around line 695, `low` around line 712)

**Interfaces:**
- Produces: `BandwidthSettings.monitorNewEventsInterval: number`

Low mode is roughly 2x slower than normal, matching every other field in the block.

- [ ] **Step 1: Add the interface field**

In the `BandwidthSettings` interface, next to `consoleEventsInterval`:

```ts
  consoleEventsInterval: number;
  monitorNewEventsInterval: number;
```

- [ ] **Step 2: Add both mode values**

In the `normal` object, after `consoleEventsInterval: 60000, // 60 sec`:

```ts
    monitorNewEventsInterval: 60000, // 60 sec
```

In the `low` object, after its `consoleEventsInterval` line:

```ts
    monitorNewEventsInterval: 120000, // 120 sec
```

- [ ] **Step 3: Verify it typechecks**

Run: `./node_modules/.bin/tsc -b`
Expected: clean. If a test asserts the exact shape of `BANDWIDTH_SETTINGS`, update it.

- [ ] **Step 4: Commit**

```bash
node node_modules/vitest/vitest.mjs run
./node_modules/.bin/tsc -b
git add src/lib/zmninja-ng-constants.ts
git commit -m "feat(bandwidth): add monitorNewEventsInterval

refs #239"
```

---

## Task 4: The hook that joins store and query

**Files:**
- Create: `app/src/hooks/useMonitorNewEvents.ts`
- Create: `app/src/hooks/__tests__/useMonitorNewEvents.test.tsx`

**Interfaces:**
- Consumes: `getMonitorEventsSince` (Task 2), `queryKeys.monitorEventsSince` (Task 2), `useMonitorSeenStore` (Task 1), `BandwidthSettings.monitorNewEventsInterval` (Task 3), `useCurrentProfile`, `useAuthStore`, `useBandwidthSettings`.
- Produces:
  - `useMonitorNewEvents(monitorIds: string[]): { counts: Record<string, number>; newest: Record<string, string | null> }`

Seeding lives here, in an effect: when a response lands for a monitor with no watermark, seed it and report a count of zero for that render. `counts` therefore never shows a backlog on first sight. `newest` is exported so `MonitorCard` can stamp the watermark on click without a request.

- [ ] **Step 1: Write the failing test**

Create `app/src/hooks/__tests__/useMonitorNewEvents.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useMonitorNewEvents } from '../useMonitorNewEvents';
import { useMonitorSeenStore } from '../../stores/monitorSeen';
import { getMonitorEventsSince } from '../../api/events';

vi.mock('../../api/events', () => ({ getMonitorEventsSince: vi.fn() }));
vi.mock('../useCurrentProfile', () => ({
  useCurrentProfile: () => ({ currentProfile: { id: 'p1' }, settings: {} }),
}));
vi.mock('../../stores/auth', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: true }),
}));
vi.mock('../useBandwidthSettings', () => ({
  useBandwidthSettings: () => ({ monitorNewEventsInterval: 60000 }),
}));

const mockCount = vi.mocked(getMonitorEventsSince);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useMonitorNewEvents', () => {
  beforeEach(() => {
    useMonitorSeenStore.setState({ profileWatermarks: {} });
    mockCount.mockReset();
  });

  it('seeds an unseen monitor and reports zero new events', async () => {
    mockCount.mockResolvedValue({ count: 61, newest: '2026-07-09 14:26:47' });

    const { result } = renderHook(() => useMonitorNewEvents(['1']), { wrapper });

    await waitFor(() => {
      expect(useMonitorSeenStore.getState().hasWatermark('p1', '1')).toBe(true);
    });
    // A fresh install must not report 61 events as new.
    expect(result.current.counts['1'] ?? 0).toBe(0);
    expect(useMonitorSeenStore.getState().getWatermark('p1', '1')).toBe('2026-07-09 14:26:47');
  });

  it('reports the count for a monitor that already has a watermark', async () => {
    useMonitorSeenStore.getState().seed('p1', '1', '2026-07-01 00:00:00');
    mockCount.mockResolvedValue({ count: 3, newest: '2026-07-09 14:26:47' });

    const { result } = renderHook(() => useMonitorNewEvents(['1']), { wrapper });

    await waitFor(() => expect(result.current.counts['1']).toBe(3));
    expect(result.current.newest['1']).toBe('2026-07-09 14:26:47');
    expect(mockCount).toHaveBeenCalledWith('1', '2026-07-01 00:00:00');
  });

  it('seeds a monitor that has never recorded an event with a null watermark', async () => {
    mockCount.mockResolvedValue({ count: 0, newest: null });

    renderHook(() => useMonitorNewEvents(['1']), { wrapper });

    await waitFor(() => {
      expect(useMonitorSeenStore.getState().hasWatermark('p1', '1')).toBe(true);
    });
    expect(useMonitorSeenStore.getState().getWatermark('p1', '1')).toBeNull();
  });

  it('queries each monitor independently', async () => {
    useMonitorSeenStore.getState().seed('p1', '1', '2026-07-01 00:00:00');
    useMonitorSeenStore.getState().seed('p1', '2', '2026-07-02 00:00:00');
    mockCount.mockImplementation(async (monitorId: string) =>
      monitorId === '1' ? { count: 3, newest: 'a' } : { count: 0, newest: 'b' }
    );

    const { result } = renderHook(() => useMonitorNewEvents(['1', '2']), { wrapper });

    await waitFor(() => expect(result.current.counts['1']).toBe(3));
    expect(result.current.counts['2']).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `node node_modules/vitest/vitest.mjs run src/hooks/__tests__/useMonitorNewEvents.test.tsx`
Expected: FAIL, `Failed to resolve import "../useMonitorNewEvents"`.

- [ ] **Step 3: Implement**

Create `app/src/hooks/useMonitorNewEvents.ts`:

```ts
/**
 * How many events each monitor has recorded since the user last looked at it.
 *
 * One query per monitor. The alternative, a single query OR-ing every
 * MonitorId, starves: ZoneMinder ORs repeated MonitorId segments, so one busy
 * camera consumes the whole page limit and every other monitor reads zero.
 *
 * A monitor with no watermark is seeded from its first response and reports
 * zero, so a fresh install shows no backlog (refs #239).
 */

import { useEffect, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { getMonitorEventsSince } from '../api/events';
import { queryKeys } from '../lib/query/query-keys';
import { useMonitorSeenStore } from '../stores/monitorSeen';
import { useCurrentProfile } from './useCurrentProfile';
import { useAuthStore } from '../stores/auth';
import { useBandwidthSettings } from './useBandwidthSettings';

interface MonitorNewEvents {
  counts: Record<string, number>;
  newest: Record<string, string | null>;
}

export function useMonitorNewEvents(monitorIds: string[]): MonitorNewEvents {
  const { currentProfile } = useCurrentProfile();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const bandwidth = useBandwidthSettings();

  const profileId = currentProfile?.id;
  const profileWatermarks = useMonitorSeenStore((s) => s.profileWatermarks);
  const seed = useMonitorSeenStore((s) => s.seed);

  const watermarks = useMemo(
    () => (profileId ? (profileWatermarks[profileId] ?? {}) : {}),
    [profileWatermarks, profileId]
  );

  const results = useQueries({
    queries: monitorIds.map((monitorId) => {
      const since = watermarks[monitorId] ?? null;
      return {
        queryKey: queryKeys.monitorEventsSince(profileId, monitorId, since),
        queryFn: () => getMonitorEventsSince(monitorId, since),
        enabled: !!profileId && isAuthenticated,
        refetchInterval: bandwidth.monitorNewEventsInterval,
      };
    }),
  });

  // Seed on first response. Effect, not render: seeding writes to a store, and
  // a write during render would tear the tree.
  useEffect(() => {
    if (!profileId) return;
    monitorIds.forEach((monitorId, i) => {
      const data = results[i]?.data;
      if (!data) return;
      seed(profileId, monitorId, data.newest);
    });
  }, [profileId, monitorIds, results, seed]);

  return useMemo(() => {
    const counts: Record<string, number> = {};
    const newest: Record<string, string | null> = {};

    monitorIds.forEach((monitorId, i) => {
      const data = results[i]?.data;
      if (!data) return;
      newest[monitorId] = data.newest;
      // Unseeded monitors report zero: the response that seeds them is also
      // the one that would otherwise show their whole history as new.
      const seeded = Object.prototype.hasOwnProperty.call(watermarks, monitorId);
      counts[monitorId] = seeded ? data.count : 0;
    });

    return { counts, newest };
  }, [monitorIds, results, watermarks]);
}
```

`seed` is a no-op when a watermark exists (Task 1), so the effect is safe to run on every response.

- [ ] **Step 4: Run the test and watch it pass**

Run: `node node_modules/vitest/vitest.mjs run src/hooks/__tests__/useMonitorNewEvents.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Verify and commit**

```bash
node node_modules/vitest/vitest.mjs run
./node_modules/.bin/tsc -b
npm run build
git add src/hooks/useMonitorNewEvents.ts src/hooks/__tests__/useMonitorNewEvents.test.tsx
git commit -m "feat(monitors): add useMonitorNewEvents

One count query per monitor, joined with the seen-watermark store. Seeds
an unseen monitor from its first response and reports zero for it.

refs #239"
```

---

## Task 5: Badge and clearing

**Files:**
- Modify: `app/src/pages/Monitors.tsx` (replace the `eventCounts` query at 78-83; the two `MonitorCard` call sites at 250 and 264)
- Modify: `app/src/components/monitors/MonitorCard.tsx` (props, the two badge blocks at 199-203 and 344-349)
- Modify: `app/src/components/monitors/MonitorRecentEvents.tsx` (clear on render)
- Modify: `app/src/locales/{en,de,es,fr,zh}/translation.json`

**Interfaces:**
- Consumes: `useMonitorNewEvents` (Task 4), `useMonitorSeenStore.markSeen` (Task 1).
- Produces: `MonitorCardComponentProps.newEventCount?: number` and `newestEventAt?: string | null` replacing `eventCount`.

- [ ] **Step 1: Add the i18n key to all five locales**

`en`, inside `monitors`: `"new_events_count_one": "{{count}} new event", "new_events_count_other": "{{count}} new events"`
`de`: `"new_events_count_one": "{{count}} neues Ereignis", "new_events_count_other": "{{count}} neue Ereignisse"`
`es`: `"new_events_count_one": "{{count}} evento nuevo", "new_events_count_other": "{{count}} eventos nuevos"`
`fr`: `"new_events_count_one": "{{count}} nouvel évènement", "new_events_count_other": "{{count}} nouveaux évènements"`
`zh`: `"new_events_count_one": "{{count}} 个新事件", "new_events_count_other": "{{count}} 个新事件"`

This is the `aria-label`, not a visible label, so length is not constrained by rule 22.

- [ ] **Step 2: Swap the query in `Monitors.tsx`**

Delete the `eventCounts` `useQuery` block (lines 78-83) and its `getConsoleEvents` / `queryKeys.consoleEventsList` imports. After `allMonitors` is computed, add:

```tsx
  const monitorIds = useMemo(() => allMonitors.map(({ Monitor }) => Monitor.Id), [allMonitors]);
  const { counts: newEventCounts, newest: newestEventAt } = useMonitorNewEvents(monitorIds);
```

Import `useMonitorNewEvents` from `../hooks/useMonitorNewEvents`.

At both `MonitorCard` call sites, replace `eventCount={eventCounts?.[Monitor.Id]}` with:

```tsx
                  newEventCount={newEventCounts[Monitor.Id]}
                  newestEventAt={newestEventAt[Monitor.Id]}
```

- [ ] **Step 3: Update `MonitorCard`**

`eventCount` is declared on `MonitorCardProps` in `app/src/api/types.ts:558`, not on the
component's own props interface. Change it there:

```ts
export interface MonitorCardProps {
  monitor: Monitor;
  status: MonitorStatus | undefined;
  /** Events recorded since the user last looked at this monitor (refs #239) */
  newEventCount?: number;
  /** StartDateTime of this monitor's newest event, stamped when the badge clears */
  newestEventAt?: string | null;
  objectFit?: React.CSSProperties['objectFit'] | 'flex';
  compact?: boolean;
}
```

Then update the destructure in `MonitorCardComponent` (`eventCount` becomes
`newEventCount, newestEventAt`) and the `@param props.eventCount` JSDoc line above it.
`MonitorCardComponentProps` extends `MonitorCardProps` and needs no change.

Add near the other hooks:

```ts
  const markSeen = useMonitorSeenStore((s) => s.markSeen);
```

(import `useMonitorSeenStore` from `../../stores/monitorSeen`)

Add above the return:

```ts
  const openEvents = () => {
    if (currentProfile) {
      markSeen(currentProfile.id, monitor.Id, newestEventAt ?? null);
    }
    navigate(`/events?monitorId=${monitor.Id}`, { state: { from: '/monitors' } });
  };
```

At **both** Events buttons (around lines 194 and 339), replace `onClick={() => navigate(...)}` with `onClick={openEvents}`.

At **both** badge blocks (around 199-203 and 344-349), replace the body with:

```tsx
              {newEventCount !== undefined && newEventCount > 0 && (
                <Badge
                  variant="info"
                  className="ml-0.5 px-0.5 py-0 text-[8px] h-3 min-w-3 shrink-0"
                  data-testid="monitor-new-events-badge"
                  aria-label={t('monitors.new_events_count', { count: newEventCount })}
                >
                  {formatEventCount(newEventCount)}
                </Badge>
              )}
```

Keep `formatEventCount` (already imported in this file): exact to 999, then `1k+`. The badge
markup is otherwise unchanged from the existing one, so only the count's meaning changes.

- [ ] **Step 4: Clear from the recent-events list**

In `app/src/components/monitors/MonitorRecentEvents.tsx`, after the `useMonitorRecentEvents` destructure:

```ts
  const markSeen = useMonitorSeenStore((s) => s.markSeen);

  // The list is on screen, so its events have been seen. Collapsed (`hidden`)
  // means the user opened this page for the live stream and never saw them.
  useEffect(() => {
    if (hidden || isLoading || events.length === 0) return;
    if (!currentProfile) return;
    markSeen(currentProfile.id, monitorId, events[0].StartDateTime);
  }, [hidden, isLoading, events, currentProfile, monitorId, markSeen]);
```

Import `useEffect` from `react` and `useMonitorSeenStore` from `../../stores/monitorSeen`. Confirm the newest event is `events[0]`: `useMonitorRecentEvents` sorts `StartDateTime` `desc`.

- [ ] **Step 5: Run the unit suite**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS. `MonitorCard.test.tsx` passes `eventCount`; update it to `newEventCount`.

- [ ] **Step 6: Drive the real app**

Run `npm run dev`, open Monitors, and confirm: badges show a count, clicking Events clears that monitor's badge and no other, going back leaves it clear, and a monitor you never opened keeps its badge. Confirm in devtools that clicking Events issues no extra count request.

- [ ] **Step 7: Verify and commit**

```bash
node node_modules/vitest/vitest.mjs run
./node_modules/.bin/tsc -b
npm run build
git add src/pages/Monitors.tsx src/components/monitors/MonitorCard.tsx src/components/monitors/MonitorRecentEvents.tsx src/components/monitors/__tests__/MonitorCard.test.tsx src/locales
git commit -m "feat(monitors): badge counts events since you last looked

Replaces the fixed 7-day consoleEvents count. Clears on opening the
monitor's events, or its detail page when the recent-events list renders.

refs #239"
```

---

## Task 6: E2e coverage

**Files:**
- Modify: `app/tests/features/monitors.feature`
- Modify: `app/tests/steps/monitors.steps.ts`

The guard comes from the ZM API, never from the badge's own visibility: a guard keyed on the element under test turns its regression into a green pass (rule 34). Events cannot be created on demand, so "the badge appears when an event arrives" stays a unit test.

- [ ] **Step 1: Write the scenario**

Append to `app/tests/features/monitors.feature`:

```gherkin
  @all
  Scenario: Opening a monitor's events clears only that monitor's new-event badge
    Given I am logged into zmNinjaNg
    When I navigate to the "Monitors" page
    And I record which monitors show a new-event badge
    And I open the events of the first badged monitor
    And I navigate to the "Monitors" page
    Then that monitor should have no new-event badge
    And the other badged monitors should keep theirs
```

- [ ] **Step 2: Write the steps**

Append to `app/tests/steps/monitors.steps.ts`:

```ts
let badgedMonitorIds: string[] = [];
let clearedMonitorId: string | null = null;

When('I record which monitors show a new-event badge', async ({ page }) => {
  const cards = page.locator('[data-testid="monitor-card"]');
  await expect(cards.first()).toBeVisible({ timeout: testConfig.timeouts.pageLoad });

  badgedMonitorIds = [];
  for (const card of await cards.all()) {
    const badge = card.getByTestId('monitor-new-events-badge');
    if (await badge.count()) {
      const id = await card.getAttribute('data-monitor-id');
      if (id) badgedMonitorIds.push(id);
    }
  }
  log.info('E2E badged monitors', { component: 'e2e', count: badgedMonitorIds.length });
});

When('I open the events of the first badged monitor', async ({ page }) => {
  if (badgedMonitorIds.length === 0) return; // nothing new on this server right now
  clearedMonitorId = badgedMonitorIds[0];
  const card = page.locator(`[data-monitor-id="${clearedMonitorId}"]`);
  await card.getByTestId('monitor-events-button').click();
  await page.waitForURL(/\/events\?monitorId=\d+/, { timeout: testConfig.timeouts.transition });
});

Then('that monitor should have no new-event badge', async ({ page }) => {
  if (!clearedMonitorId) return; // data-derived skip: no monitor had new events
  const card = page.locator(`[data-monitor-id="${clearedMonitorId}"]`);
  await expect(card).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  await expect(card.getByTestId('monitor-new-events-badge')).toHaveCount(0);
});

Then('the other badged monitors should keep theirs', async ({ page }) => {
  for (const id of badgedMonitorIds.slice(1)) {
    const card = page.locator(`[data-monitor-id="${id}"]`);
    await expect(card.getByTestId('monitor-new-events-badge')).toHaveCount(1);
  }
});
```

The skip in step 2 and 3 is keyed on `badgedMonitorIds.length`, which is data about the server's events, not on whether the badge element rendered. If a monitor had new events and the badge failed to render, `badgedMonitorIds` is empty and the scenario reports no assertions rather than a false pass. To close that hole, the `Given` may assert `getEventCount() > 0` from `tests/helpers/zm-api.ts` first.

- [ ] **Step 3: Add `data-monitor-id` to the card**

`MonitorCard` root needs `data-monitor-id={monitor.Id}` for the locators above. Add it in both layouts.

- [ ] **Step 4: Run the feature**

Run: `npm run test:e2e -- monitors.feature`
Expected: PASS. Never run this while another e2e run is active in this checkout (rule 39).

- [ ] **Step 5: Commit**

```bash
node node_modules/vitest/vitest.mjs run
./node_modules/.bin/tsc -b
npm run build
git add tests/features/monitors.feature tests/steps/monitors.steps.ts src/components/monitors/MonitorCard.tsx
git commit -m "test(e2e): opening a monitor's events clears only its badge

refs #239"
```

---

## Task 7: Remove the dead consoleEvents path

Nothing calls `getConsoleEvents` after Task 5. Rule 12: delete replaced code completely.

**Files:**
- Modify: `app/src/api/events.ts` (remove `getConsoleEvents`)
- Modify: `app/src/api/types.ts` (remove `ConsoleEventsResponseSchema`)
- Modify: `app/src/lib/query/query-keys.ts` (remove `consoleEvents`, `consoleEventsList`)
- Modify: `app/src/lib/zmninja-ng-constants.ts` (remove `consoleEventsInterval` from the interface and both mode objects)
- Modify: `app/src/components/settings/HiddenMonitorsSection.tsx:65`
- Modify: `app/src/api/__tests__/events.test.ts` (remove the two `getConsoleEvents` tests and the import)

- [ ] **Step 1: Confirm there are no callers**

Run: `grep -rn "getConsoleEvents\|consoleEvents" app/src app/tests`
Expected: only the definitions, the two tests, the query keys, the bandwidth field, and `HiddenMonitorsSection.tsx:65`. If anything else appears, stop and reassess.

- [ ] **Step 2: Repoint the invalidation**

In `HiddenMonitorsSection.tsx`, replace:

```ts
    queryClient.invalidateQueries({ queryKey: queryKeys.consoleEvents(currentProfile?.id) });
```

with:

```ts
    queryClient.invalidateQueries({ queryKey: ['monitor-events-since', currentProfile?.id] });
```

Rule 29 forbids inline keys, so instead add a domain-prefix factory to `query-keys.ts` next to `monitorEventsSince` and use it:

```ts
  /** All monitor-events-since queries. Domain prefix for invalidation. */
  monitorEventsSinceAll: (profileId: MaybeProfileId) =>
    ['monitor-events-since', profileId] as const,
```

and call `queryKeys.monitorEventsSinceAll(currentProfile?.id)`.

- [ ] **Step 3: Delete the rest**

Remove `getConsoleEvents` from `api/events.ts`, `ConsoleEventsResponseSchema` from `api/types.ts`, the two key factories, both `consoleEventsInterval` values and the interface field, and the two tests plus the import in `api/__tests__/events.test.ts`.

- [ ] **Step 4: Verify nothing references them**

Run: `grep -rn "consoleEvents" app/src app/tests`
Expected: no output.

- [ ] **Step 5: Verify and commit**

```bash
node node_modules/vitest/vitest.mjs run
./node_modules/.bin/tsc -b
npm run build
git add -A
git commit -m "chore(events): remove the dead consoleEvents path

The monitor badge no longer counts a fixed 7-day window, so getConsoleEvents,
its schema, its query keys and its bandwidth interval have no callers.

refs #239"
```

---

## Task 8: Documentation

**Files:**
- Modify: `docs/developer-guide/call-flows.rst` (append Flow 18)
- Modify: `docs/developer-guide/05-component-architecture.rst` (MonitorCard badge)
- Modify: `docs/developer-guide/07-api-and-data-fetching.rst` (`getMonitorEventsSince`)
- Modify: `docs/developer-guide/12-shared-services-and-components.rst` (`stores/monitorSeen.ts`)

Follow the call-flow recipe in `AGENTS.md`: title after a user action, one opening paragraph with the counterintuitive fact, one mermaid diagram with `autonumber` and one `Note over`, 8 to 14 numbered steps each with a bold plain-language lead, the file and symbol in double backticks, a counterfactual reason, and a `source` link plus a `:doc:` link.

- [ ] **Step 1: Write Flow 18**

Title: "Flow 18: Seeing what happened while you were away". The counterintuitive fact for the opening paragraph: one query answers two questions, which is why clearing the badge costs no request. The `Note over` marks the seeding moment. State the negative: an absent watermark seeds silently rather than showing backlog, and watermarks do not sync across devices.

Cover, in order: the monitors query lands; `useMonitorNewEvents` reads watermarks from the store; one `getMonitorEventsSince` per monitor; the strict `>` operator and why `>=` is wrong; `pagination.count` plus `events[0]` in one response; the seeding effect; the badge render; `openEvents` stamping from cache; `MonitorRecentEvents` clearing only when `!hidden`; the query key carrying the watermark so clearing invalidates one monitor.

- [ ] **Step 2: Add the chapter entries**

Each entry names the user-visible behavior it serves and links Flow 18 (rule 37). Do not append a bare Location/Props/Used-By block.

- [ ] **Step 3: Check the prose**

```bash
grep -niE "\b(comprehensive|robust|powerful|extensively|thoroughly|excellent|amazing|seamless|cutting.edge|state.of.the.art|user.friendly)\b" docs/developer-guide/call-flows.rst
grep -n "—" docs/developer-guide/call-flows.rst
```

Both must return zero hits.

- [ ] **Step 4: Build the docs**

Run: `cd docs && make html`
Expected: no warning naming `call-flows.rst`.

- [ ] **Step 5: Commit**

```bash
git add docs/developer-guide
git commit -m "docs: trace the events-since-last-visit badge

refs #239"
```

---

## Task 9: Land it

- [ ] **Step 1: Full verification**

```bash
cd app
node node_modules/vitest/vitest.mjs run
./node_modules/.bin/tsc -b --force
npm run build
npm run test:e2e
```

All must pass. The PTZ scenario in `monitor-detail.feature` fails on `main` for an unrelated reason (#238); confirm it is the only failure and that it fails identically on `main` before attributing it to this work.

- [ ] **Step 2: Check for incidental build artifacts**

Run: `git status --short`
Expected: no changes to `app/android/app/build.gradle` or `app/ios/App/App.xcodeproj/project.pbxproj`. If present, `git checkout --` them (rule 28).

- [ ] **Step 3: Delete the plan and spec**

Rule 16: no plan files in git once the feature is complete.

```bash
git rm docs/superpowers/plans/2026-07-10-events-since-last-visit.md
git rm docs/superpowers/specs/2026-07-10-events-since-last-visit-design.md
git commit -m "chore: remove the completed events-since-last-visit plan

refs #239"
```

- [ ] **Step 4: Push and report**

Push to `main` directly with no intermediate scratch branch, so GitHub links the commits to #239 (rule 36). Then check the issue timeline; post a linking comment only if the reference is missing (rule 26).

Do not close #239. Report to the user and let them confirm the fix works first (rule 19).
