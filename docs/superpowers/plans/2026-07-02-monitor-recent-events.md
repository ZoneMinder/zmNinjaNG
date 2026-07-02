# Recent events on monitor detail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a compact, auto-refreshing, per-monitor-hideable list of the last X events under the live view on the monitor detail page, with a single "All events" entry point to the filtered Events page.

**Architecture:** Pure helpers in `lib/monitor-recent-events.ts` (clamp, hidden set). A data hook `useMonitorRecentEvents(monitorId)` wraps a React Query call to `getEvents` and the per-monitor hidden toggle. A presentational `CompactEventRow` renders one event. `MonitorRecentEvents` composes the hook + rows + collapsible header and is mounted in `MonitorDetail.tsx`. Count is a profile setting; refresh interval is a new bandwidth-settings property.

**Tech Stack:** React 18, TypeScript, React Query v5, Zustand (settings store), react-i18next, Tailwind, Vitest + @testing-library/react, Playwright (web e2e).

## Global Constraints

- All npm commands run from `app/`.
- Verify before every commit: `npm test`, `npx tsc --noEmit`, `npm run build`. UI changes also need e2e where applicable.
- After `npm run build`, revert native build-number bumps: `git checkout -- app/android/app/build.gradle app/ios/App/App.xcodeproj/project.pbxproj` before committing (rule 28).
- Logging via `log.*` with explicit `LogLevel`; never `console.*`.
- No hardcoded user-facing strings; update all 5 locales: `en`, `de`, `es`, `fr`, `zh`. Keep labels short (rule 22).
- Named constants live in `lib/zmninja-ng-constants.ts` (rule 25).
- Polling intervals come from bandwidth settings (rule 8).
- Profile-scoped settings via `getProfileSettings`/`updateProfileSettings` (rule 7).
- `data-testid` (kebab-case) on interactive elements (rule 13).
- Files ~400 LOC max (rule 12).
- Commit format: conventional, reference issue `refs #213`; final commit `fixes #213` only after the user confirms it works (rule 19).
- Route to monitor detail is `/monitors/:id`; the Events page filters via `/events?monitorId=<id>`.

---

### Task 1: Pure helpers + count constant

**Files:**
- Create: `app/src/lib/monitor-recent-events.ts`
- Create: `app/src/lib/__tests__/monitor-recent-events.test.ts`
- Modify: `app/src/lib/zmninja-ng-constants.ts` (add `MONITOR_DETAIL_RECENT_EVENTS`)

**Interfaces:**
- Produces:
  - `MONITOR_DETAIL_RECENT_EVENTS = { defaultCount: 5, minCount: 1, maxCount: 20 }` (const, in constants file)
  - `clampRecentEventsCount(n: number): number`
  - `isMonitorRecentEventsHidden(hidden: string[], monitorId: string): boolean`
  - `toggleMonitorRecentEventsHidden(hidden: string[], monitorId: string): string[]`

- [ ] **Step 1: Add the constant**

In `app/src/lib/zmninja-ng-constants.ts`, after the `API_PAGINATION` block, add:

```ts
/**
 * Recent-events list shown under the live view on the monitor detail page.
 * Count is a per-profile setting; these are its default and clamp bounds.
 */
export const MONITOR_DETAIL_RECENT_EVENTS = {
  defaultCount: 5,
  minCount: 1,
  maxCount: 20,
} as const;
```

- [ ] **Step 2: Write the failing test**

Create `app/src/lib/__tests__/monitor-recent-events.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  clampRecentEventsCount,
  isMonitorRecentEventsHidden,
  toggleMonitorRecentEventsHidden,
} from '../monitor-recent-events';

describe('clampRecentEventsCount', () => {
  it('clamps below min up to min', () => {
    expect(clampRecentEventsCount(0)).toBe(1);
    expect(clampRecentEventsCount(-5)).toBe(1);
  });
  it('clamps above max down to max', () => {
    expect(clampRecentEventsCount(999)).toBe(20);
  });
  it('rounds fractional values', () => {
    expect(clampRecentEventsCount(4.6)).toBe(5);
  });
  it('falls back to default for non-finite input', () => {
    expect(clampRecentEventsCount(NaN)).toBe(5);
    expect(clampRecentEventsCount(undefined as unknown as number)).toBe(5);
  });
  it('passes through an in-range value', () => {
    expect(clampRecentEventsCount(8)).toBe(8);
  });
});

describe('hidden set helpers', () => {
  it('reports membership', () => {
    expect(isMonitorRecentEventsHidden(['3', '7'], '7')).toBe(true);
    expect(isMonitorRecentEventsHidden(['3', '7'], '9')).toBe(false);
  });
  it('adds a monitor id when absent', () => {
    expect(toggleMonitorRecentEventsHidden(['3'], '7')).toEqual(['3', '7']);
  });
  it('removes a monitor id when present', () => {
    expect(toggleMonitorRecentEventsHidden(['3', '7'], '7')).toEqual(['3']);
  });
  it('does not mutate the input array', () => {
    const input = ['3'];
    toggleMonitorRecentEventsHidden(input, '7');
    expect(input).toEqual(['3']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app && npm test -- monitor-recent-events`
Expected: FAIL — cannot resolve `../monitor-recent-events`.

- [ ] **Step 4: Write the implementation**

Create `app/src/lib/monitor-recent-events.ts`:

```ts
/**
 * Helpers for the recent-events list on the monitor detail page.
 * Pure functions: clamp the configured count and manage the per-monitor
 * hidden set stored in profile settings.
 */
import { MONITOR_DETAIL_RECENT_EVENTS } from './zmninja-ng-constants';

export function clampRecentEventsCount(n: number): number {
  const { minCount, maxCount, defaultCount } = MONITOR_DETAIL_RECENT_EVENTS;
  if (!Number.isFinite(n)) return defaultCount;
  return Math.min(maxCount, Math.max(minCount, Math.round(n)));
}

export function isMonitorRecentEventsHidden(hidden: string[], monitorId: string): boolean {
  return hidden.includes(monitorId);
}

export function toggleMonitorRecentEventsHidden(hidden: string[], monitorId: string): string[] {
  return hidden.includes(monitorId)
    ? hidden.filter((id) => id !== monitorId)
    : [...hidden, monitorId];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npm test -- monitor-recent-events`
Expected: PASS (10 tests).

- [ ] **Step 6: Commit**

```bash
cd app && npx tsc --noEmit
git add src/lib/monitor-recent-events.ts src/lib/__tests__/monitor-recent-events.test.ts src/lib/zmninja-ng-constants.ts
git commit -m "feat: add recent-events helpers and count constant (refs #213)"
```

---

### Task 2: Settings + bandwidth fields

**Files:**
- Modify: `app/src/stores/settings.ts` (`ProfileSettings` interface + `DEFAULT_SETTINGS`)
- Modify: `app/src/lib/zmninja-ng-constants.ts` (`BandwidthSettings` interface + both `BANDWIDTH_SETTINGS` entries)
- Create: `app/src/stores/__tests__/settings-recent-events.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces:
  - `ProfileSettings.monitorDetailRecentEventsCount: number` (default 5)
  - `ProfileSettings.monitorDetailRecentEventsHidden: string[]` (default `[]`)
  - `BandwidthSettings.monitorRecentEventsInterval: number` (ms; normal 30000, low 60000)

- [ ] **Step 1: Add the settings fields**

In `app/src/stores/settings.ts`, in the `ProfileSettings` interface near `defaultEventLimit`:

```ts
  /** Number of recent events shown under the live view on the monitor detail page. */
  monitorDetailRecentEventsCount: number;
  /** Monitor IDs whose recent-events list is collapsed/hidden on the detail page. */
  monitorDetailRecentEventsHidden: string[];
```

In `DEFAULT_SETTINGS` near `defaultEventLimit: 100`:

```ts
  monitorDetailRecentEventsCount: 5,
  monitorDetailRecentEventsHidden: [],
```

- [ ] **Step 2: Add the bandwidth property**

In `app/src/lib/zmninja-ng-constants.ts`, in the `BandwidthSettings` interface (after `timelineNowRefreshInterval`):

```ts
  /** Monitor-detail recent-events list polling interval (ms) */
  monitorRecentEventsInterval: number;
```

In `BANDWIDTH_SETTINGS.normal` add `monitorRecentEventsInterval: 30000, // 30 sec`.
In `BANDWIDTH_SETTINGS.low` add `monitorRecentEventsInterval: 60000, // 60 sec`.

- [ ] **Step 3: Write the failing test**

Create `app/src/stores/__tests__/settings-recent-events.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings';
import { BANDWIDTH_SETTINGS } from '../../lib/zmninja-ng-constants';

describe('recent-events settings defaults', () => {
  it('defaults the count to 5', () => {
    expect(DEFAULT_SETTINGS.monitorDetailRecentEventsCount).toBe(5);
  });
  it('defaults the hidden set to empty', () => {
    expect(DEFAULT_SETTINGS.monitorDetailRecentEventsHidden).toEqual([]);
  });
  it('sets normal/low refresh intervals in ms', () => {
    expect(BANDWIDTH_SETTINGS.normal.monitorRecentEventsInterval).toBe(30000);
    expect(BANDWIDTH_SETTINGS.low.monitorRecentEventsInterval).toBe(60000);
  });
});
```

- [ ] **Step 4: Run test to verify it fails, then passes**

Run: `cd app && npm test -- settings-recent-events`
Expected first run: FAIL (undefined values). After Steps 1–2 are in place it should PASS. If you wrote Steps 1–2 before the test, run it once to confirm PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd app && npx tsc --noEmit
git add src/stores/settings.ts src/lib/zmninja-ng-constants.ts src/stores/__tests__/settings-recent-events.test.ts
git commit -m "feat: add recent-events count setting and bandwidth interval (refs #213)"
```

---

### Task 3: Settings UI control + settings i18n

**Files:**
- Modify: `app/src/components/settings/PlaybackSection.tsx`
- Modify: `app/src/locales/{en,de,es,fr,zh}/translation.json` (settings keys)
- Create: `app/src/components/settings/__tests__/PlaybackSection-recent-events.test.tsx`

**Interfaces:**
- Consumes: `ProfileSettings.monitorDetailRecentEventsCount` (Task 2); `MONITOR_DETAIL_RECENT_EVENTS` (Task 1).
- Produces: a numeric input `data-testid="settings-monitor-recent-events-count"` that writes `monitorDetailRecentEventsCount`.

- [ ] **Step 1: Add i18n keys**

Add to the `settings` namespace in `app/src/locales/en/translation.json`:

```json
"monitor_recent_events_count": "Recent events on monitor",
"monitor_recent_events_count_desc": "How many recent events to show under the live view",
```

Add translated equivalents (short) to `de`, `es`, `fr`, `zh` in the same `settings` namespace:
- de: `"Letzte Ereignisse"` / `"Anzahl der Ereignisse unter dem Livebild"`
- es: `"Eventos recientes"` / `"Cuántos eventos mostrar bajo la vista en vivo"`
- fr: `"Événements récents"` / `"Nombre d'événements sous la vue en direct"`
- zh: `"最近事件数"` / `"实时画面下方显示的事件数量"`

- [ ] **Step 2: Add the control to PlaybackSection**

In `PlaybackSection.tsx`, add an import at the top:

```ts
import { MONITOR_DETAIL_RECENT_EVENTS } from '../../lib/zmninja-ng-constants';
```

Inside `<SettingsCard>`, after the "Events Per Page" block, add:

```tsx
        {/* Recent events on monitor detail */}
        <div className="px-4 py-3 space-y-2">
          <RowLabel
            label={t('settings.monitor_recent_events_count')}
            desc={t('settings.monitor_recent_events_count_desc')}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Input
              id="monitor-recent-events-count"
              type="number"
              min={MONITOR_DETAIL_RECENT_EVENTS.minCount}
              max={MONITOR_DETAIL_RECENT_EVENTS.maxCount}
              step="1"
              value={settings.monitorDetailRecentEventsCount ?? MONITOR_DETAIL_RECENT_EVENTS.defaultCount}
              onChange={(e) =>
                currentProfile &&
                updateSettings(currentProfile.id, {
                  monitorDetailRecentEventsCount: Number(e.target.value),
                })
              }
              className="w-24"
              data-testid="settings-monitor-recent-events-count"
            />
            <span className="text-xs text-muted-foreground">{t('settings.events_per_page_suffix')}</span>
            <div className="flex gap-1.5">
              {[3, 5, 10].map((val) => (
                <Button key={val} variant="outline" size="sm" className="h-7 text-xs px-2"
                  onClick={() =>
                    currentProfile &&
                    updateSettings(currentProfile.id, { monitorDetailRecentEventsCount: val })
                  }
                  data-testid={`monitor-recent-events-count-preset-${val}`}>
                  {val}{val === 5 ? ` (${t('settings.default')})` : ''}
                </Button>
              ))}
            </div>
          </div>
        </div>
```

- [ ] **Step 3: Write the failing test**

Create `app/src/components/settings/__tests__/PlaybackSection-recent-events.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlaybackSection } from '../PlaybackSection';
import { DEFAULT_SETTINGS } from '../../../stores/settings';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: string) => d ?? k }),
}));

describe('PlaybackSection recent-events count', () => {
  const profile = { id: 'p1' } as never;

  it('renders the current count and writes changes', () => {
    const updateSettings = vi.fn();
    render(
      <PlaybackSection
        settings={{ ...DEFAULT_SETTINGS, monitorDetailRecentEventsCount: 5 }}
        update={vi.fn()}
        currentProfile={profile}
        updateSettings={updateSettings}
      />
    );
    const input = screen.getByTestId('settings-monitor-recent-events-count') as HTMLInputElement;
    expect(input.value).toBe('5');
    fireEvent.change(input, { target: { value: '8' } });
    expect(updateSettings).toHaveBeenCalledWith('p1', { monitorDetailRecentEventsCount: 8 });
  });

  it('applies a preset on click', () => {
    const updateSettings = vi.fn();
    render(
      <PlaybackSection
        settings={{ ...DEFAULT_SETTINGS }}
        update={vi.fn()}
        currentProfile={profile}
        updateSettings={updateSettings}
      />
    );
    fireEvent.click(screen.getByTestId('monitor-recent-events-count-preset-10'));
    expect(updateSettings).toHaveBeenCalledWith('p1', { monitorDetailRecentEventsCount: 10 });
  });
});
```

- [ ] **Step 4: Run test**

Run: `cd app && npm test -- PlaybackSection-recent-events`
Expected: PASS (2 tests). If it fails first because the control is absent, add Step 2, then re-run.

- [ ] **Step 5: Verify translations are valid JSON**

Run: `cd app && npx tsc --noEmit && node -e "['en','de','es','fr','zh'].forEach(l=>require('./src/locales/'+l+'/translation.json'))"`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
cd app
git add src/components/settings/PlaybackSection.tsx src/components/settings/__tests__/PlaybackSection-recent-events.test.tsx src/locales/en/translation.json src/locales/de/translation.json src/locales/es/translation.json src/locales/fr/translation.json src/locales/zh/translation.json
git commit -m "feat: add recent-events count control in settings (refs #213)"
```

---

### Task 4: CompactEventRow component + monitor_detail i18n

**Files:**
- Create: `app/src/components/events/CompactEventRow.tsx`
- Create: `app/src/components/events/__tests__/CompactEventRow.test.tsx`
- Modify: `app/src/locales/{en,de,es,fr,zh}/translation.json` (`monitor_detail` keys)

**Interfaces:**
- Consumes: `EventThumbnail` (existing), `useDateTimeFormat` (existing).
- Produces: `CompactEventRow(props: { event: Event; thumbnailUrls: string[]; aspectRatio: number; objectFit?: React.CSSProperties['objectFit'] })` — renders a clickable row with `data-testid="compact-event-row"`, navigating to `/events/<eventId>` with state `{ from: '/monitors/<monitorId>' }`.

- [ ] **Step 1: Add monitor_detail i18n keys**

Add to the `monitor_detail` namespace in `app/src/locales/en/translation.json` (which already has `events`/`view_events`):

```json
"recent_events": "Recent Events",
"all_events": "All events",
"no_recent_events": "No recent events",
"refresh_events": "Refresh"
```

Add short equivalents to the `monitor_detail` namespace in `de`, `es`, `fr`, `zh`:
- de: `"Letzte Ereignisse"`, `"Alle Ereignisse"`, `"Keine Ereignisse"`, `"Aktualisieren"`
- es: `"Eventos recientes"`, `"Todos los eventos"`, `"Sin eventos"`, `"Actualizar"`
- fr: `"Événements récents"`, `"Tous les événements"`, `"Aucun événement"`, `"Actualiser"`
- zh: `"最近事件"`, `"全部事件"`, `"暂无事件"`, `"刷新"`

- [ ] **Step 2: Write the failing test**

Create `app/src/components/events/__tests__/CompactEventRow.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CompactEventRow } from '../CompactEventRow';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('../../../hooks/useDateTimeFormat', () => ({
  useDateTimeFormat: () => ({ fmtTime: () => '2:19 PM' }),
}));

const event = {
  Id: '233228',
  MonitorId: '4',
  Name: 'FrontDoor-233228',
  Cause: 'Motion:All',
  StartDateTime: '2026-07-02 14:19:00',
  MaxScore: '43',
} as never;

describe('CompactEventRow', () => {
  it('shows cause, time, and score, and navigates on click', () => {
    render(
      <MemoryRouter>
        <CompactEventRow event={event} thumbnailUrls={['http://x/1.jpg']} aspectRatio={1.6} />
      </MemoryRouter>
    );
    expect(screen.getByText('Motion:All')).toBeTruthy();
    expect(screen.getByText('2:19 PM')).toBeTruthy();
    expect(screen.getByText('43')).toBeTruthy();
    fireEvent.click(screen.getByTestId('compact-event-row'));
    expect(navigate).toHaveBeenCalledWith('/events/233228', {
      state: { from: '/monitors/4' },
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app && npm test -- CompactEventRow`
Expected: FAIL — cannot resolve `../CompactEventRow`.

- [ ] **Step 4: Write the implementation**

Create `app/src/components/events/CompactEventRow.tsx`:

```tsx
/**
 * Compact event row for the monitor-detail recent-events list.
 * Thumbnail + cause + time + score. Clicking opens the event detail.
 */
import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDateTimeFormat } from '../../hooks/useDateTimeFormat';
import { EventThumbnail } from './EventThumbnail';
import type { Event } from '../../api/types';

interface CompactEventRowProps {
  event: Event;
  thumbnailUrls: string[];
  aspectRatio: number;
  objectFit?: CSSProperties['objectFit'];
}

export function CompactEventRow({ event, thumbnailUrls, aspectRatio, objectFit = 'cover' }: CompactEventRowProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { fmtTime } = useDateTimeFormat();
  const startTime = new Date(event.StartDateTime.replace(' ', 'T'));
  const open = () =>
    navigate(`/events/${event.Id}`, { state: { from: `/monitors/${event.MonitorId}` } });

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      className="flex items-center gap-2.5 rounded-md p-1.5 cursor-pointer hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary"
      data-testid="compact-event-row"
      data-event-id={event.Id}
      aria-label={`${t('common.view')}: ${event.Name}`}
    >
      <div
        className="relative flex-shrink-0 w-16 rounded overflow-hidden bg-card border border-border/40"
        style={{ aspectRatio: aspectRatio.toString() }}
      >
        <EventThumbnail
          urls={thumbnailUrls}
          cacheKey={event.Id}
          alt={event.Name}
          className="w-full h-full"
          objectFit={objectFit}
          loading="lazy"
          data-testid="compact-event-thumbnail"
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate" title={event.Cause}>{event.Cause}</p>
        <p className="text-xs text-muted-foreground">{fmtTime(startTime)}</p>
      </div>
      <span
        className="flex-shrink-0 text-xs font-medium tabular-nums px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
        title={t('events.score')}
      >
        {event.MaxScore}
      </span>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npm test -- CompactEventRow`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
cd app && npx tsc --noEmit
git add src/components/events/CompactEventRow.tsx src/components/events/__tests__/CompactEventRow.test.tsx src/locales/en/translation.json src/locales/de/translation.json src/locales/es/translation.json src/locales/fr/translation.json src/locales/zh/translation.json
git commit -m "feat: add CompactEventRow for monitor recent events (refs #213)"
```

---

### Task 5: useMonitorRecentEvents data hook

**Files:**
- Create: `app/src/hooks/useMonitorRecentEvents.ts`
- Create: `app/src/hooks/__tests__/useMonitorRecentEvents.test.tsx`

**Interfaces:**
- Consumes: `getEvents` (`api/events`), `clampRecentEventsCount`/`isMonitorRecentEventsHidden`/`toggleMonitorRecentEventsHidden` (Task 1), `useBandwidthSettings` → `monitorRecentEventsInterval` (Task 2), `useCurrentProfile`, `useAuthStore`, `useSettingsStore`.
- Produces:
  `useMonitorRecentEvents(monitorId: string): { events: EventData[]; isLoading: boolean; isError: boolean; isFetching: boolean; hidden: boolean; count: number; toggleHidden: () => void; refetch: () => void }`

- [ ] **Step 1: Write the failing test**

Create `app/src/hooks/__tests__/useMonitorRecentEvents.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useMonitorRecentEvents } from '../useMonitorRecentEvents';
import { getEvents } from '../../api/events';

vi.mock('../../api/events', () => ({ getEvents: vi.fn() }));

const updateProfileSettings = vi.fn();
let hiddenList: string[] = [];
vi.mock('../useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    currentProfile: { id: 'p1' },
    settings: {
      monitorDetailRecentEventsCount: 5,
      get monitorDetailRecentEventsHidden() { return hiddenList; },
      bandwidthMode: 'normal',
    },
  }),
}));
vi.mock('../../stores/auth', () => ({
  useAuthStore: (sel: (s: { isAuthenticated: boolean }) => unknown) => sel({ isAuthenticated: true }),
}));
vi.mock('../../stores/settings', () => ({
  useSettingsStore: (sel: (s: { updateProfileSettings: typeof updateProfileSettings }) => unknown) =>
    sel({ updateProfileSettings }),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

beforeEach(() => {
  hiddenList = [];
  updateProfileSettings.mockClear();
  (getEvents as unknown as ReturnType<typeof vi.fn>).mockReset();
});

describe('useMonitorRecentEvents', () => {
  it('fetches recent events for the monitor, capped to count', async () => {
    (getEvents as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      events: [{ Event: { Id: '1' } }, { Event: { Id: '2' } }],
    });
    const { result } = renderHook(() => useMonitorRecentEvents('4'), { wrapper });
    await waitFor(() => expect(result.current.events.length).toBe(2));
    expect(getEvents).toHaveBeenCalledWith({
      monitorId: '4', limit: 5, sort: 'StartTime', direction: 'desc',
    });
  });

  it('does not fetch when the monitor is hidden', async () => {
    hiddenList = ['4'];
    const { result } = renderHook(() => useMonitorRecentEvents('4'), { wrapper });
    expect(result.current.hidden).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(getEvents).not.toHaveBeenCalled();
  });

  it('toggleHidden writes the updated hidden set', () => {
    const { result } = renderHook(() => useMonitorRecentEvents('4'), { wrapper });
    act(() => result.current.toggleHidden());
    expect(updateProfileSettings).toHaveBeenCalledWith('p1', {
      monitorDetailRecentEventsHidden: ['4'],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- useMonitorRecentEvents`
Expected: FAIL — cannot resolve `../useMonitorRecentEvents`.

- [ ] **Step 3: Write the implementation**

Create `app/src/hooks/useMonitorRecentEvents.ts`:

```ts
/**
 * Data hook for the monitor-detail recent-events list. Wraps the events query
 * and the per-monitor hidden toggle. The query is disabled while hidden so no
 * request or refresh fires (refs #213).
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getEvents } from '../api/events';
import type { EventData } from '../api/types';
import { useCurrentProfile } from './useCurrentProfile';
import { useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { useBandwidthSettings } from './useBandwidthSettings';
import {
  clampRecentEventsCount,
  isMonitorRecentEventsHidden,
  toggleMonitorRecentEventsHidden,
} from '../lib/monitor-recent-events';

export interface UseMonitorRecentEvents {
  events: EventData[];
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  hidden: boolean;
  count: number;
  toggleHidden: () => void;
  refetch: () => void;
}

export function useMonitorRecentEvents(monitorId: string): UseMonitorRecentEvents {
  const { currentProfile, settings } = useCurrentProfile();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const updateProfileSettings = useSettingsStore((s) => s.updateProfileSettings);
  const bandwidth = useBandwidthSettings();

  const count = clampRecentEventsCount(settings.monitorDetailRecentEventsCount);
  const hiddenList = settings.monitorDetailRecentEventsHidden;
  const hidden = isMonitorRecentEventsHidden(hiddenList, monitorId);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: [currentProfile?.id, 'monitorRecentEvents', monitorId, count],
    queryFn: () => getEvents({ monitorId, limit: count, sort: 'StartTime', direction: 'desc' }),
    enabled: !!currentProfile && isAuthenticated && !hidden,
    refetchInterval: hidden ? false : bandwidth.monitorRecentEventsInterval,
  });

  const events = useMemo(() => (data?.events ?? []).slice(0, count), [data?.events, count]);

  const toggleHidden = () => {
    if (!currentProfile) return;
    updateProfileSettings(currentProfile.id, {
      monitorDetailRecentEventsHidden: toggleMonitorRecentEventsHidden(hiddenList, monitorId),
    });
  };

  return {
    events,
    isLoading,
    isError,
    isFetching,
    hidden,
    count,
    toggleHidden,
    refetch: () => { void refetch(); },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test -- useMonitorRecentEvents`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd app && npx tsc --noEmit
git add src/hooks/useMonitorRecentEvents.ts src/hooks/__tests__/useMonitorRecentEvents.test.tsx
git commit -m "feat: add useMonitorRecentEvents data hook (refs #213)"
```

---

### Task 6: MonitorRecentEvents section component

**Files:**
- Create: `app/src/components/monitors/MonitorRecentEvents.tsx`

**Interfaces:**
- Consumes: `useMonitorRecentEvents` (Task 5), `CompactEventRow` (Task 4), `buildThumbnailChain`, `getPortalUrlForEvent`, `calculateThumbnailDimensions`, `getMonitorDimensions`, `EVENT_GRID_CONSTANTS`, `resolveMinStreamingPort`, `useFreshAccessToken`, `useCurrentProfile`.
- Produces: `MonitorRecentEvents(props: { monitor: Monitor })` — renders `data-testid="monitor-recent-events"` with the always-visible header (toggle `monitor-recent-events-toggle`, refresh `monitor-recent-events-refresh`, all-events `monitor-recent-events-all`) and the collapsible body `monitor-recent-events-body`.

- [ ] **Step 1: Write the component**

Create `app/src/components/monitors/MonitorRecentEvents.tsx`:

```tsx
/**
 * Recent-events list under the live view on the monitor detail page.
 * Always-visible header (title, refresh, collapse, "All events"). The body is
 * collapsible per monitor; while collapsed the query is disabled (refs #213).
 */
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { CompactEventRow } from '../events/CompactEventRow';
import { useMonitorRecentEvents } from '../../hooks/useMonitorRecentEvents';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import { useFreshAccessToken } from '../../hooks/useFreshAccessToken';
import { resolveMinStreamingPort } from '../../lib/multiport';
import { getPortalUrlForEvent } from '../../lib/server-resolver';
import { buildThumbnailChain } from '../../lib/thumbnail-chain';
import {
  calculateThumbnailDimensions,
  getMonitorDimensions,
  EVENT_GRID_CONSTANTS,
} from '../../lib/event-utils';
import type { Event, Monitor } from '../../api/types';

interface MonitorRecentEventsProps {
  monitor: Monitor;
}

export function MonitorRecentEvents({ monitor }: MonitorRecentEventsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentProfile, settings } = useCurrentProfile();
  const { token: accessToken, isFresh } = useFreshAccessToken();
  const monitorId = monitor.Id;
  const { events, isLoading, isError, isFetching, hidden, toggleHidden, refetch } =
    useMonitorRecentEvents(monitorId);

  const portalUrl = currentProfile?.portalUrl || '';
  const thumbnailChain = settings.thumbnailFallbackChain;
  const thumbnailFit = settings.eventsThumbnailFit === 'fill' ? 'contain' : settings.eventsThumbnailFit;
  const minStreamingPort = resolveMinStreamingPort(
    currentProfile?.minStreamingPort,
    settings.forceDisableMultiPort
  );
  const monitorsForResolve = [{ Monitor: monitor }];

  const buildRow = (ev: Event) => {
    const { width, height } = getMonitorDimensions(monitor, ev.Width, ev.Height);
    const { width: tw, height: th } = calculateThumbnailDimensions(
      width,
      height,
      monitor.Orientation ?? ev.Orientation,
      EVENT_GRID_CONSTANTS.LIST_VIEW_TARGET_SIZE
    );
    const eventPortalUrl = getPortalUrlForEvent(ev.MonitorId, monitorsForResolve, portalUrl);
    const urls = buildThumbnailChain(eventPortalUrl, ev.Id, thumbnailChain, {
      token: isFresh ? accessToken ?? undefined : undefined,
      width: tw,
      height: th,
      minStreamingPort,
      monitorId: ev.MonitorId,
    });
    return { urls, aspectRatio: tw / th };
  };

  return (
    <div className="w-full max-w-5xl mt-4 px-2" data-testid="monitor-recent-events">
      <div className="flex items-center justify-between gap-2 py-1.5 border-b border-border/40">
        <button
          type="button"
          onClick={toggleHidden}
          className="flex items-center gap-1.5 text-sm font-medium min-w-0"
          aria-expanded={!hidden}
          data-testid="monitor-recent-events-toggle"
        >
          {hidden ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          <span className="truncate">{t('monitor_detail.recent_events')}</span>
        </button>
        <div className="flex items-center gap-1">
          {!hidden && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={refetch}
              disabled={isFetching}
              title={t('monitor_detail.refresh_events')}
              aria-label={t('monitor_detail.refresh_events')}
              data-testid="monitor-recent-events-refresh"
            >
              <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => navigate(`/events?monitorId=${monitorId}`)}
            data-testid="monitor-recent-events-all"
          >
            {t('monitor_detail.all_events')}
            <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
          </Button>
        </div>
      </div>

      {!hidden && (
        <div className="pt-2" data-testid="monitor-recent-events-body">
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-14 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex items-center gap-2 text-xs text-destructive py-2">
              <AlertCircle className="h-4 w-4" />
              {t('common.error')}
            </div>
          ) : events.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 text-center">
              {t('monitor_detail.no_recent_events')}
            </p>
          ) : (
            <div className="space-y-1.5">
              {events.map(({ Event: ev }) => {
                const { urls, aspectRatio } = buildRow(ev);
                return (
                  <CompactEventRow
                    key={ev.Id}
                    event={ev}
                    thumbnailUrls={urls}
                    aspectRatio={aspectRatio}
                    objectFit={thumbnailFit}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check and build**

Run: `cd app && npx tsc --noEmit`
Expected: PASS. Fix any prop/type mismatches (e.g. `getMonitorDimensions` argument shape) against the real signatures before proceeding.

- [ ] **Step 3: Commit**

```bash
cd app
git add src/components/monitors/MonitorRecentEvents.tsx
git commit -m "feat: add MonitorRecentEvents section component (refs #213)"
```

---

### Task 7: Wire into MonitorDetail + remove duplicate events buttons

**Files:**
- Modify: `app/src/pages/MonitorDetail.tsx`

**Interfaces:**
- Consumes: `MonitorRecentEvents` (Task 6).

- [ ] **Step 1: Import the component**

In `app/src/pages/MonitorDetail.tsx`, add near the other component imports:

```ts
import { MonitorRecentEvents } from '../components/monitors/MonitorRecentEvents';
```

- [ ] **Step 2: Remove the header events button**

Delete the header events `<Button>` (currently ~lines 291-300, the one with `onClick={() => navigate(\`/events?monitorId=${monitor.Monitor.Id}\`)}` and `<Clock ... />` + `t('monitor_detail.events')`). Leave the `Select` (feed fit) and settings button in that header row intact.

- [ ] **Step 3: Remove the controls-bar events button**

Delete the controls-bar events `<Button>` (currently ~lines 454-463, icon-only `<Clock className="h-4 w-4" />` with `title={t('monitor_detail.view_events')}`). Keep the snapshot and zones buttons.

- [ ] **Step 4: Mount the recent-events section**

Directly after the closing of the "Video Controls Bar" block (the `)}` that closes `{!isFullscreen && ( ... )}` ending ~line 489), and before the PTZ Controls block, insert:

```tsx
        {/* Recent events - Hidden in fullscreen */}
        {!isFullscreen && (
          <MonitorRecentEvents monitor={monitor.Monitor} />
        )}
```

- [ ] **Step 5: Remove now-unused imports**

If `Clock` from `lucide-react` is no longer referenced in the file after Steps 2–3, remove it from the import on line 20. Confirm with:

Run: `cd app && grep -n "Clock" src/pages/MonitorDetail.tsx`
Expected: no matches (if there are, leave the import). Then `npx tsc --noEmit` must pass (it errors on unused imports under `tsc -b`).

- [ ] **Step 6: Build**

Run: `cd app && npm test && npx tsc --noEmit && npm run build`
Expected: all pass. Then revert native build-number bumps:

```bash
cd /Users/arjun/fiddle/zmNinjaNg
git checkout -- app/android/app/build.gradle app/ios/App/App.xcodeproj/project.pbxproj
```

- [ ] **Step 7: Commit**

```bash
cd /Users/arjun/fiddle/zmNinjaNg/app
git add src/pages/MonitorDetail.tsx
git commit -m "feat: show recent events on monitor detail, drop duplicate events buttons (refs #213)"
```

---

### Task 8: Web e2e + docs

**Files:**
- Modify: `app/tests/features/monitor-detail.feature`
- Modify/Create: `app/tests/steps/monitor-detail.steps.ts` (add any missing steps)
- Modify: `docs/developer-guide/05-component-architecture.rst` (document the hook + components)

**Interfaces:**
- Consumes: the `data-testid`s from Tasks 3–7.

- [ ] **Step 1: Add the e2e scenario**

Append to `app/tests/features/monitor-detail.feature`:

```gherkin
@all
Scenario: Recent events list under the live view
  Given I am logged into zmNinjaNg
  When I open the first monitor's detail view
  Then the recent events list should be visible
  When I tap the recent events collapse toggle
  Then the recent events body should be hidden
  When I refresh the page
  Then the recent events body should still be hidden
  When I tap the recent events collapse toggle
  Then the recent events body should be visible
  When I tap "All events"
  Then I should be on the events page filtered to that monitor
```

- [ ] **Step 2: Implement the step definitions**

In `app/tests/steps/monitor-detail.steps.ts`, add steps using `TestActions` and the test ids: `monitor-recent-events`, `monitor-recent-events-toggle`, `monitor-recent-events-body`, `monitor-recent-events-all`. Assert visibility of `monitor-recent-events-body`, that after refresh it stays hidden (persistence), and that "All events" navigation lands on `/events?monitorId=...`. Follow the existing patterns in that steps file for navigation, tapping by test id, and URL assertions. If a needed generic step (e.g. "I refresh the page") already exists in a shared steps file, reuse it rather than redefining.

- [ ] **Step 3: Run the e2e feature**

Run: `cd app && npm run test:e2e -- monitor-detail.feature`
Expected: the new scenario passes on `web-chromium`. Debug with `--headed` if a selector or wait is off. (Device profiles are manual-invoke only; do not run them here.)

- [ ] **Step 4: Update the developer guide**

In `docs/developer-guide/05-component-architecture.rst`, add a short subsection describing `MonitorRecentEvents` (monitor-detail recent-events section), `CompactEventRow` (compact list row), and the `useMonitorRecentEvents` hook: purpose, props/return shape, that the query is disabled while the list is collapsed per monitor, and that the refresh interval comes from `BandwidthSettings.monitorRecentEventsInterval`. Match the chapter's factual tone; no banned words, no em-dashes. Verify:

Run (from repo root): `grep -niE "\b(comprehensive|robust|powerful|seamless|intuitive)\b" docs/developer-guide/05-component-architecture.rst; grep -n "—" docs/developer-guide/05-component-architecture.rst`
Expected: zero hits.

- [ ] **Step 5: Full verification**

Run: `cd app && npm test && npx tsc --noEmit && npm run build && npm run test:e2e -- monitor-detail.feature`
Expected: all pass. Revert native build-number bumps if `npm run build` changed them:

```bash
cd /Users/arjun/fiddle/zmNinjaNg
git checkout -- app/android/app/build.gradle app/ios/App/App.xcodeproj/project.pbxproj
```

- [ ] **Step 6: Commit**

```bash
cd /Users/arjun/fiddle/zmNinjaNg
git add app/tests/features/monitor-detail.feature app/tests/steps/monitor-detail.steps.ts docs/developer-guide/05-component-architecture.rst
git commit -m "test: e2e for monitor recent events; docs (refs #213)"
```

---

## Notes for the implementer

- **RQ v5 `isLoading` on disabled queries** is `false` (not `true`). This is fine here: the body is only rendered when `!hidden`, and when expanded the query is enabled so `isLoading` behaves normally. Do not gate any reset/self-heal effect on `isLoading`.
- **Sort:** the events query passes `sort: 'StartTime', direction: 'desc'` so the newest events come first regardless of server default.
- **Thumbnail plumbing** mirrors `EventListView`'s `EventItem`: `getMonitorDimensions` → `calculateThumbnailDimensions` → `getPortalUrlForEvent` → `buildThumbnailChain`. Keep the token gated on `isFresh` from `useFreshAccessToken`.
- **`monitor.Monitor`** is the shape used throughout `MonitorDetail.tsx`; pass `monitor.Monitor` (the inner `Monitor`) to `MonitorRecentEvents`.
- Do not run device (iOS/Android) e2e; those are manual-invoke only.
