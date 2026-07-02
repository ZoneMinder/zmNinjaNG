# Event row detail + delete — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap the recent-events count at 50, enrich the compact row (detection, event id, relative time), and add a confirm-guarded event delete usable from both the recent-events list and the main event list.

**Architecture:** A shared `parseDetectedObjects` helper, a `useDeleteEvent` hook wrapping the existing `deleteEvent` API with query invalidation + toasts, and an `EventDeleteButton` component (trash + AlertDialog) reused by `CompactEventRow` and `EventCard`. The count clamp is enforced in the settings input via the existing `clampRecentEventsCount`.

**Tech Stack:** React 18, TypeScript, React Query v5, react-i18next, Radix AlertDialog, Vitest + @testing-library/react, Playwright (web e2e).

## Global Constraints

- All npm commands run from `app/`.
- Verify before every commit: `npm test`, `npx tsc --noEmit`, `npm run build`. After `npm run build`, revert native build-number bumps: `git checkout -- app/android/app/build.gradle app/ios/App/App.xcodeproj/project.pbxproj`.
- No hardcoded user-facing strings; update all 5 locales (en, de, es, fr, zh). Reuse `common.delete` / `common.cancel` (they exist). Keep labels short.
- Logging via `log.*` with explicit `LogLevel`; never `console.*`. Use `log.eventCard`.
- HTTP only via existing `api/events.ts` functions; do not add raw fetch.
- Named constants live in `lib/zmninja-ng-constants.ts`.
- `data-testid` (kebab-case) on interactive elements.
- Date/time via `useDateTimeFormat`; relative time via `formatEventRelative` guarded by `isWithinDays(..., RELATIVE_TIME_LIST_WINDOW_DAYS)`.
- Deleting a real ZM event is permanent; no automated e2e may delete a real event. The e2e opens the confirm dialog and cancels.
- Commit format: conventional, `refs #213`.
- The existing `deleteEvent(eventId)` API is in `app/src/api/events.ts`; import it aliased (`deleteEvent as apiDeleteEvent`) to avoid shadowing.

---

### Task 1: Cap count at 50 + clamp the settings input

**Files:**
- Modify: `app/src/lib/zmninja-ng-constants.ts` (`MONITOR_DETAIL_RECENT_EVENTS.maxCount`)
- Modify: `app/src/lib/__tests__/monitor-recent-events.test.ts` (clamp assertion 20 → 50)
- Modify: `app/src/components/settings/PlaybackSection.tsx` (clamp onChange)
- Modify: `app/src/components/settings/__tests__/PlaybackSection-recent-events.test.tsx` (over-max clamps)

**Interfaces:**
- Consumes: `clampRecentEventsCount` (exists in `lib/monitor-recent-events.ts`), `MONITOR_DETAIL_RECENT_EVENTS`.
- Produces: nothing new.

- [ ] **Step 1: Bump the max constant**

In `app/src/lib/zmninja-ng-constants.ts`, change `MONITOR_DETAIL_RECENT_EVENTS`:

```ts
export const MONITOR_DETAIL_RECENT_EVENTS = {
  defaultCount: 5,
  minCount: 1,
  maxCount: 50,
} as const;
```

- [ ] **Step 2: Update the existing clamp test**

In `app/src/lib/__tests__/monitor-recent-events.test.ts`, change the "clamps above max" case from `expect(clampRecentEventsCount(999)).toBe(20);` to:

```ts
    expect(clampRecentEventsCount(999)).toBe(50);
```

- [ ] **Step 3: Clamp the settings input onChange**

In `app/src/components/settings/PlaybackSection.tsx`, add the import (with the other lib imports):

```ts
import { clampRecentEventsCount } from '../../lib/monitor-recent-events';
```

Replace the `onChange` of the `monitor-recent-events-count` `Input` with:

```tsx
              onChange={(e) => {
                if (!currentProfile) return;
                const raw = e.target.value;
                if (raw === '') return;
                updateSettings(currentProfile.id, {
                  monitorDetailRecentEventsCount: clampRecentEventsCount(Number(raw)),
                });
              }}
```

(The input's `max={MONITOR_DETAIL_RECENT_EVENTS.maxCount}` already references the constant, so it becomes 50 automatically. Leave the preset buttons `[3, 5, 10]` as-is.)

- [ ] **Step 4: Add the over-max clamp test**

In `app/src/components/settings/__tests__/PlaybackSection-recent-events.test.tsx`, add a test inside the existing `describe`:

```tsx
  it('clamps a typed value above the max down to 50', () => {
    const updateSettings = vi.fn();
    render(
      <PlaybackSection
        settings={{ ...DEFAULT_SETTINGS }}
        update={vi.fn()}
        currentProfile={profile}
        updateSettings={updateSettings}
      />
    );
    const input = screen.getByTestId('settings-monitor-recent-events-count') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '244' } });
    expect(updateSettings).toHaveBeenCalledWith('p1', { monitorDetailRecentEventsCount: 50 });
  });
```

- [ ] **Step 5: Run tests**

Run: `cd app && npm test -- monitor-recent-events PlaybackSection-recent-events`
Expected: PASS (clamp now 50; over-max stores 50).

- [ ] **Step 6: Commit**

```bash
cd app && npx tsc --noEmit
git add src/lib/zmninja-ng-constants.ts src/lib/__tests__/monitor-recent-events.test.ts src/components/settings/PlaybackSection.tsx src/components/settings/__tests__/PlaybackSection-recent-events.test.tsx
git commit -m "fix: cap recent-events count at 50 and clamp the settings input (refs #213)"
```

---

### Task 2: Extract `parseDetectedObjects` to a shared helper

**Files:**
- Create: `app/src/lib/event-detection.ts`
- Create: `app/src/lib/__tests__/event-detection.test.ts`
- Modify: `app/src/components/timeline/EventPreviewPopover.tsx` (use the shared helper)

**Interfaces:**
- Produces: `parseDetectedObjects(notes: string | null): string[]`

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/__tests__/event-detection.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseDetectedObjects } from '../event-detection';

describe('parseDetectedObjects', () => {
  it('returns [] for null/empty/no-match', () => {
    expect(parseDetectedObjects(null)).toEqual([]);
    expect(parseDetectedObjects('')).toEqual([]);
    expect(parseDetectedObjects('Motion: All')).toEqual([]);
  });
  it('parses a single detected object, stripping the |motion suffix', () => {
    expect(parseDetectedObjects('detected:person|Motion: All')).toEqual(['person']);
  });
  it('parses multiple detected objects', () => {
    expect(parseDetectedObjects('detected:person,car|Motion: All')).toEqual(['person', 'car']);
  });
  it('is case-insensitive on the detected: prefix', () => {
    expect(parseDetectedObjects('Detected:dog')).toEqual(['dog']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- event-detection`
Expected: FAIL — cannot resolve `../event-detection`.

- [ ] **Step 3: Write the implementation**

Create `app/src/lib/event-detection.ts`:

```ts
/**
 * Parse detected object classes from a ZoneMinder event Notes field.
 * Notes look like "detected:person,car|Motion: All"; we take the part after
 * "detected:" and, for each comma-separated entry, the part before "|".
 */
export function parseDetectedObjects(notes: string | null): string[] {
  if (!notes) return [];
  const match = notes.match(/detected:(.*)/i);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((s) => s.split('|')[0].trim())
    .filter(Boolean);
}
```

- [ ] **Step 4: Reuse it in EventPreviewPopover**

In `app/src/components/timeline/EventPreviewPopover.tsx`: delete the local `function parseDetectedObjects(...)` (around lines 51-61) and add an import near the top:

```ts
import { parseDetectedObjects } from '../../lib/event-detection';
```

Leave the call site `const detectedObjects = parseDetectedObjects(event.notes);` unchanged.

- [ ] **Step 5: Run tests + typecheck**

Run: `cd app && npm test -- event-detection && npx tsc --noEmit`
Expected: PASS, no type errors (confirms the popover still compiles with the import).

- [ ] **Step 6: Commit**

```bash
cd app
git add src/lib/event-detection.ts src/lib/__tests__/event-detection.test.ts src/components/timeline/EventPreviewPopover.tsx
git commit -m "refactor: extract parseDetectedObjects to lib/event-detection (refs #213)"
```

---

### Task 3: `useDeleteEvent` hook

**Files:**
- Create: `app/src/hooks/useDeleteEvent.ts`
- Create: `app/src/hooks/__tests__/useDeleteEvent.test.tsx`
- Modify: `app/src/locales/{en,de,es,fr,zh}/translation.json` (`events.delete_success`, `events.delete_failed`)

**Interfaces:**
- Consumes: `deleteEvent` from `api/events.ts` (aliased), `log.eventCard`.
- Produces: `useDeleteEvent(): { deleteEvent: (eventId: string) => Promise<void>; isDeleting: boolean }`

- [ ] **Step 1: Add the two i18n keys**

Add to the `events` namespace in `app/src/locales/en/translation.json`:

```json
"delete_success": "Event deleted",
"delete_failed": "Delete failed",
```

Add translations to the `events` namespace of de/es/fr/zh:
- de: `"Ereignis gelöscht"` / `"Löschen fehlgeschlagen"`
- es: `"Evento eliminado"` / `"Error al eliminar"`
- fr: `"Événement supprimé"` / `"Échec de la suppression"`
- zh: `"事件已删除"` / `"删除失败"`

- [ ] **Step 2: Write the failing test**

Create `app/src/hooks/__tests__/useDeleteEvent.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useDeleteEvent } from '../useDeleteEvent';
import { deleteEvent } from '../../api/events';
import { toast } from 'sonner';

vi.mock('../../api/events', () => ({ deleteEvent: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../lib/logger', () => ({
  log: { eventCard: vi.fn() },
  LogLevel: { ERROR: 'ERROR' },
}));

let qc: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.clearAllMocks();
});

describe('useDeleteEvent', () => {
  it('deletes, invalidates events/event/monitorRecentEvents, and toasts success', async () => {
    (deleteEvent as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteEvent(), { wrapper });

    await act(async () => { await result.current.deleteEvent('42'); });

    expect(deleteEvent).toHaveBeenCalledWith('42');
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(keys.some((k) => k.includes('"events"'))).toBe(true);
    expect(keys.some((k) => k.includes('"event"') && k.includes('42'))).toBe(true);
    // the monitorRecentEvents invalidation uses a predicate (no queryKey field)
    expect(spy.mock.calls.some((c) => typeof (c[0] as { predicate?: unknown })?.predicate === 'function')).toBe(true);
    expect(toast.success).toHaveBeenCalledWith('events.delete_success');
  });

  it('toasts failure when the API rejects', async () => {
    (deleteEvent as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useDeleteEvent(), { wrapper });
    await act(async () => { await result.current.deleteEvent('42'); });
    expect(toast.error).toHaveBeenCalledWith('events.delete_failed');
  });

  it('predicate matches a monitorRecentEvents query key', async () => {
    (deleteEvent as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteEvent(), { wrapper });
    await act(async () => { await result.current.deleteEvent('42'); });
    const predCall = spy.mock.calls.find((c) => typeof (c[0] as { predicate?: unknown })?.predicate === 'function');
    const predicate = (predCall![0] as { predicate: (q: { queryKey: unknown[] }) => boolean }).predicate;
    expect(predicate({ queryKey: ['p1', 'monitorRecentEvents', '3', 5] })).toBe(true);
    expect(predicate({ queryKey: ['monitors'] })).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app && npm test -- useDeleteEvent`
Expected: FAIL — cannot resolve `../useDeleteEvent`.

- [ ] **Step 4: Write the implementation**

Create `app/src/hooks/useDeleteEvent.ts`:

```ts
/**
 * Delete a ZoneMinder event with query invalidation and toasts.
 * Invalidates the events list, the single-event query, and any
 * monitorRecentEvents query so the monitor-detail recent list refreshes.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { deleteEvent as apiDeleteEvent } from '../api/events';
import { log, LogLevel } from '../lib/logger';

export function useDeleteEvent(): {
  deleteEvent: (eventId: string) => Promise<void>;
  isDeleting: boolean;
} {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = useState(false);

  const deleteEvent = async (eventId: string) => {
    setIsDeleting(true);
    try {
      await apiDeleteEvent(eventId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['events'] }),
        queryClient.invalidateQueries({ queryKey: ['event', eventId] }),
        queryClient.invalidateQueries({
          predicate: (q) => q.queryKey.includes('monitorRecentEvents'),
        }),
      ]);
      toast.success(t('events.delete_success'));
    } catch (err) {
      log.eventCard('Delete event failed', LogLevel.ERROR, { eventId, error: err });
      toast.error(t('events.delete_failed'));
    } finally {
      setIsDeleting(false);
    }
  };

  return { deleteEvent, isDeleting };
}
```

- [ ] **Step 5: Run test + validate JSON**

Run: `cd app && npm test -- useDeleteEvent && node -e "['en','de','es','fr','zh'].forEach(l=>require('./src/locales/'+l+'/translation.json'))"`
Expected: PASS (3 tests), JSON valid.

- [ ] **Step 6: Commit**

```bash
cd app && npx tsc --noEmit
git add src/hooks/useDeleteEvent.ts src/hooks/__tests__/useDeleteEvent.test.tsx src/locales/en/translation.json src/locales/de/translation.json src/locales/es/translation.json src/locales/fr/translation.json src/locales/zh/translation.json
git commit -m "feat: add useDeleteEvent hook (refs #213)"
```

---

### Task 4: `EventDeleteButton` component

**Files:**
- Create: `app/src/components/events/EventDeleteButton.tsx`
- Create: `app/src/components/events/__tests__/EventDeleteButton.test.tsx`
- Modify: `app/src/locales/{en,de,es,fr,zh}/translation.json` (`events.delete_confirm_title`, `events.delete_confirm_desc`, `events.delete_aria`)

**Interfaces:**
- Consumes: `useDeleteEvent` (Task 3), Radix `AlertDialog` from `components/ui/alert-dialog`.
- Produces: `EventDeleteButton(props: { eventId: string; eventName: string; monitorName?: string; size?: 'sm' | 'md'; className?: string })`.

- [ ] **Step 1: Add the three i18n keys**

Add to the `events` namespace in `app/src/locales/en/translation.json`:

```json
"delete_confirm_title": "Delete event?",
"delete_confirm_desc": "Event #{{id}} ({{monitor}}) will be permanently deleted.",
"delete_aria": "Delete event",
```

Add translations to de/es/fr/zh (`events` namespace):
- de: `"Ereignis löschen?"` / `"Ereignis #{{id}} ({{monitor}}) wird dauerhaft gelöscht."` / `"Ereignis löschen"`
- es: `"¿Eliminar evento?"` / `"El evento #{{id}} ({{monitor}}) se eliminará permanentemente."` / `"Eliminar evento"`
- fr: `"Supprimer l'événement ?"` / `"L'événement #{{id}} ({{monitor}}) sera supprimé définitivement."` / `"Supprimer l'événement"`
- zh: `"删除事件？"` / `"事件 #{{id}}（{{monitor}}）将被永久删除。"` / `"删除事件"`

- [ ] **Step 2: Write the failing test**

Create `app/src/components/events/__tests__/EventDeleteButton.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EventDeleteButton } from '../EventDeleteButton';

const deleteEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../hooks/useDeleteEvent', () => ({
  useDeleteEvent: () => ({ deleteEvent, isDeleting: false }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

beforeEach(() => deleteEvent.mockClear());

describe('EventDeleteButton', () => {
  it('opens the confirm dialog and deletes on confirm', async () => {
    render(<EventDeleteButton eventId="42" eventName="Cam-42" monitorName="FrontDoor" />);
    fireEvent.click(screen.getByTestId('event-delete-button'));
    expect(screen.getByTestId('event-delete-dialog')).toBeTruthy();
    fireEvent.click(screen.getByTestId('event-delete-confirm'));
    expect(deleteEvent).toHaveBeenCalledWith('42');
  });

  it('does not delete when cancelled', () => {
    render(<EventDeleteButton eventId="42" eventName="Cam-42" monitorName="FrontDoor" />);
    fireEvent.click(screen.getByTestId('event-delete-button'));
    fireEvent.click(screen.getByTestId('event-delete-cancel'));
    expect(deleteEvent).not.toHaveBeenCalled();
  });

  it('stops click propagation so a parent row does not navigate', () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <EventDeleteButton eventId="42" eventName="Cam-42" />
      </div>
    );
    fireEvent.click(screen.getByTestId('event-delete-button'));
    expect(parentClick).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app && npm test -- EventDeleteButton`
Expected: FAIL — cannot resolve `../EventDeleteButton`.

- [ ] **Step 4: Write the implementation**

Create `app/src/components/events/EventDeleteButton.tsx`:

```tsx
/**
 * Trash button that opens a confirm dialog and deletes a ZoneMinder event.
 * Used by both the compact recent-events row and the full EventCard. Click
 * propagation is stopped so it never triggers the parent row/card navigation.
 */
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { useDeleteEvent } from '../../hooks/useDeleteEvent';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';

interface EventDeleteButtonProps {
  eventId: string;
  eventName: string;
  monitorName?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function EventDeleteButton({ eventId, eventName, monitorName, size = 'md', className }: EventDeleteButtonProps) {
  const { t } = useTranslation();
  const { deleteEvent, isDeleting } = useDeleteEvent();
  const [open, setOpen] = useState(false);
  const iconSize = size === 'sm' ? 'h-4 w-4' : 'h-4 w-4 sm:h-5 sm:w-5';

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          'p-1 rounded-full hover:bg-accent transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          className
        )}
        aria-label={t('events.delete_aria')}
        title={t('events.delete_aria')}
        data-testid="event-delete-button"
      >
        <Trash2 className={cn(iconSize, 'stroke-muted-foreground hover:stroke-destructive transition-colors')} />
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent data-testid="event-delete-dialog" onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('events.delete_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('events.delete_confirm_desc', { id: eventId, monitor: monitorName ?? eventName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="event-delete-cancel">{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async (e) => {
                e.stopPropagation();
                await deleteEvent(eventId);
                setOpen(false);
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="event-delete-confirm"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

- [ ] **Step 5: Run test + validate JSON**

Run: `cd app && npm test -- EventDeleteButton && node -e "['en','de','es','fr','zh'].forEach(l=>require('./src/locales/'+l+'/translation.json'))"`
Expected: PASS (3 tests), JSON valid. If the Radix dialog content is not found under jsdom, the test uses `fireEvent.click` on the trigger which opens a controlled dialog rendered in a portal that testing-library still queries via `screen`; keep the controlled `open` state as written.

- [ ] **Step 6: Commit**

```bash
cd app && npx tsc --noEmit
git add src/components/events/EventDeleteButton.tsx src/components/events/__tests__/EventDeleteButton.test.tsx src/locales/en/translation.json src/locales/de/translation.json src/locales/es/translation.json src/locales/fr/translation.json src/locales/zh/translation.json
git commit -m "feat: add EventDeleteButton with confirm dialog (refs #213)"
```

---

### Task 5: Enrich `CompactEventRow` (detection, eid, relative time, delete)

**Files:**
- Modify: `app/src/components/events/CompactEventRow.tsx`
- Modify: `app/src/components/monitors/MonitorRecentEvents.tsx` (pass `monitorName`)
- Modify: `app/src/components/events/__tests__/CompactEventRow.test.tsx`

**Interfaces:**
- Consumes: `parseDetectedObjects` (Task 2), `getObjectClassIconFromList` (`lib/object-class-icons`), `formatEventRelative`/`isWithinDays` (`lib/relative-time`), `RELATIVE_TIME_LIST_WINDOW_DAYS` (`lib/zmninja-ng-constants`), `EventDeleteButton` (Task 4).
- Produces: `CompactEventRow` now also takes `monitorName?: string`.

- [ ] **Step 1: Update the failing test**

Replace `app/src/components/events/__tests__/CompactEventRow.test.tsx` with:

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
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));
vi.mock('../../../hooks/useDateTimeFormat', () => ({
  useDateTimeFormat: () => ({ fmtTime: () => '2:19 PM' }),
}));
vi.mock('../../../hooks/useDeleteEvent', () => ({
  useDeleteEvent: () => ({ deleteEvent: vi.fn(), isDeleting: false }),
}));

const base = {
  Id: '233228',
  MonitorId: '4',
  Name: 'FrontDoor-233228',
  Cause: 'Motion:All',
  StartDateTime: '2026-07-02 14:19:00',
  MaxScore: '43',
  Notes: 'detected:person|Motion: All',
} as never;

const render1 = (event = base) =>
  render(
    <MemoryRouter>
      <CompactEventRow event={event} thumbnailUrls={['http://x/1.jpg']} aspectRatio={1.6} monitorName="FrontDoor" />
    </MemoryRouter>
  );

describe('CompactEventRow', () => {
  it('shows detection, event id, time and a delete button', () => {
    render1();
    expect(screen.getByText('person')).toBeTruthy();
    expect(screen.getByText(/#233228/)).toBeTruthy();
    expect(screen.getByText(/2:19 PM/)).toBeTruthy();
    expect(screen.getByText('43')).toBeTruthy();
    expect(screen.getByTestId('event-delete-button')).toBeTruthy();
  });

  it('falls back to Cause when there is no detection', () => {
    render1({ ...base, Notes: 'Motion: All' } as never);
    expect(screen.getByText('Motion:All')).toBeTruthy();
  });

  it('navigates to the event on row click', () => {
    render1();
    fireEvent.click(screen.getByTestId('compact-event-row'));
    expect(navigate).toHaveBeenCalledWith('/events/233228', { state: { from: '/monitors/4' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- CompactEventRow`
Expected: FAIL (no detection/eid/delete button in the current row).

- [ ] **Step 3: Rewrite CompactEventRow**

Replace `app/src/components/events/CompactEventRow.tsx` with:

```tsx
/**
 * Compact event row for the monitor-detail recent-events list.
 * Thumbnail + detection (or cause) + event id + time + relative time + score,
 * with a delete button. Clicking the row opens the event detail.
 */
import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDateTimeFormat } from '../../hooks/useDateTimeFormat';
import { EventThumbnail } from './EventThumbnail';
import { EventDeleteButton } from './EventDeleteButton';
import { parseDetectedObjects } from '../../lib/event-detection';
import { getObjectClassIconFromList } from '../../lib/object-class-icons';
import { formatEventRelative, isWithinDays } from '../../lib/relative-time';
import { RELATIVE_TIME_LIST_WINDOW_DAYS } from '../../lib/zmninja-ng-constants';
import type { Event } from '../../api/types';

interface CompactEventRowProps {
  event: Event;
  thumbnailUrls: string[];
  aspectRatio: number;
  objectFit?: CSSProperties['objectFit'];
  monitorName?: string;
}

export function CompactEventRow({ event, thumbnailUrls, aspectRatio, objectFit = 'cover', monitorName }: CompactEventRowProps) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { fmtTime } = useDateTimeFormat();
  const startTime = new Date(event.StartDateTime.replace(' ', 'T'));
  const detected = parseDetectedObjects(event.Notes);
  const DetIcon = detected.length ? getObjectClassIconFromList(detected.join(',')) : null;
  const primaryText = detected.length ? detected.join(', ') : event.Cause;
  const showRelative = isWithinDays(startTime, RELATIVE_TIME_LIST_WINDOW_DAYS);
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
        <div className="flex items-center gap-1 min-w-0">
          {DetIcon && <DetIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          <span className="text-sm truncate" title={primaryText}>{primaryText}</span>
          <span className="text-[11px] text-muted-foreground shrink-0">· #{event.Id}</span>
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {fmtTime(startTime)}
          {showRelative && ` · ${formatEventRelative(startTime, i18n.language, t)}`}
        </p>
      </div>
      <span
        className="flex-shrink-0 text-xs font-medium tabular-nums px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
        title={t('events.score')}
      >
        {event.MaxScore}
      </span>
      <EventDeleteButton
        eventId={event.Id}
        eventName={event.Name}
        monitorName={monitorName}
        size="sm"
        className="flex-shrink-0"
      />
    </div>
  );
}
```

- [ ] **Step 4: Pass monitorName from MonitorRecentEvents**

In `app/src/components/monitors/MonitorRecentEvents.tsx`, in the `events.map` render of `<CompactEventRow ... />`, add the prop:

```tsx
                  <CompactEventRow
                    key={ev.Id}
                    event={ev}
                    thumbnailUrls={urls}
                    aspectRatio={aspectRatio}
                    objectFit={thumbnailFit}
                    monitorName={monitor.Name}
                  />
```

(`monitor` is the `Monitor` prop already in scope in this component.)

- [ ] **Step 5: Run tests + typecheck**

Run: `cd app && npm test -- CompactEventRow && npx tsc --noEmit`
Expected: PASS (3 tests), no type errors.

- [ ] **Step 6: Commit**

```bash
cd app
git add src/components/events/CompactEventRow.tsx src/components/monitors/MonitorRecentEvents.tsx src/components/events/__tests__/CompactEventRow.test.tsx
git commit -m "feat: show detection, event id, relative time and delete in compact row (refs #213)"
```

---

### Task 6: Delete button in the main event list (`EventCard`)

**Files:**
- Modify: `app/src/components/events/EventCard.tsx`

**Interfaces:**
- Consumes: `EventDeleteButton` (Task 4).

- [ ] **Step 1: Import and place the button**

In `app/src/components/events/EventCard.tsx`, add the import near the other event imports:

```ts
import { EventDeleteButton } from './EventDeleteButton';
```

In the action-buttons cluster (the `<div className="flex items-center gap-1 sm:gap-2 shrink-0">` that holds the favorite and archive buttons), add the delete button immediately after the archive `<button>...</button>` and before the Cause `Badge` block:

```tsx
                <EventDeleteButton
                  eventId={event.Id}
                  eventName={event.Name}
                  monitorName={monitorName}
                />
```

- [ ] **Step 2: Typecheck + build**

Run: `cd app && npx tsc --noEmit && npm run build`
Expected: PASS. Then revert native build bumps:

```bash
cd /Users/arjun/fiddle/zmNinjaNg
git checkout -- app/android/app/build.gradle app/ios/App/App.xcodeproj/project.pbxproj
```

- [ ] **Step 3: Run the events unit tests (regression)**

Run: `cd app && npm test -- EventCard events`
Expected: existing tests still pass (the change only adds a button; if there is no EventCard unit test, this simply runs the related suites without failures).

- [ ] **Step 4: Commit**

```bash
cd /Users/arjun/fiddle/zmNinjaNg/app
git add src/components/events/EventCard.tsx
git commit -m "feat: add delete button to event list cards (refs #213)"
```

---

### Task 7: E2E (cancel-delete) + docs

**Files:**
- Modify: `app/tests/features/monitor-detail.feature`
- Modify: `app/tests/steps/monitor-detail.steps.ts`
- Modify: `docs/developer-guide/05-component-architecture.rst`

**Interfaces:**
- Consumes: test ids `compact-event-row`, `event-delete-button`, `event-delete-dialog`, `event-delete-cancel`.

- [ ] **Step 1: Add the e2e scenario**

Append to `app/tests/features/monitor-detail.feature`:

```gherkin
@all
Scenario: Delete confirm dialog on a recent event can be cancelled
  Given I am logged into zmNinjaNg
  When I open the first monitor's detail view
  Then the recent events list should be visible
  When I tap the delete button on the first recent event
  Then the event delete confirm dialog should be visible
  When I cancel the event delete dialog
  Then the first recent event should still be present
```

- [ ] **Step 2: Implement the step definitions**

In `app/tests/steps/monitor-detail.steps.ts`, add steps using the existing raw-Playwright pattern in that file (the same style the file already uses for the recent-events steps). Concretely:
- "I tap the delete button on the first recent event": within the first `[data-testid="monitor-recent-events-body"] [data-testid="compact-event-row"]`, click its `[data-testid="event-delete-button"]`.
- "the event delete confirm dialog should be visible": assert `[data-testid="event-delete-dialog"]` is visible.
- "I cancel the event delete dialog": click `[data-testid="event-delete-cancel"]`.
- "the first recent event should still be present": assert a `[data-testid="compact-event-row"]` is still visible inside the recent-events body.

Reuse the existing "Given I am logged into zmNinjaNg", "I open the first monitor's detail view", and "the recent events list should be visible" steps already defined for the earlier recent-events scenario — do not redefine them.

- [ ] **Step 3: Run the e2e feature**

Run: `cd app && npm run test:e2e -- monitor-detail.feature`
Expected: all scenarios pass on `web-chromium`, including the new cancel-delete scenario. This does not delete any real event (it cancels). If there is no reachable ZM server in this environment, report that the scenario compiles but needs a manual run, and do not treat it as a code failure.

- [ ] **Step 4: Update the developer guide**

In `docs/developer-guide/05-component-architecture.rst`, extend the recent-events section (added earlier) to document `EventDeleteButton` (trash + confirm dialog; used by both `CompactEventRow` and `EventCard`), the `useDeleteEvent` hook (invalidates events, the single event, and `monitorRecentEvents` queries; toasts), the shared `parseDetectedObjects` helper in `lib/event-detection.ts`, and that the recent row now shows detected objects (falling back to Cause), the event id, and a relative time. Factual tone; NO banned words, NO em-dashes. Verify (from repo root):

Run: `grep -niE "\b(comprehensive|robust|powerful|seamless|intuitive|extensively|thoroughly|excellent|amazing|cutting.edge|state.of.the.art|user.friendly)\b" docs/developer-guide/05-component-architecture.rst; grep -n "—" docs/developer-guide/05-component-architecture.rst`
Expected: zero hits.

- [ ] **Step 5: Full verification**

Run: `cd app && npm test && npx tsc --noEmit && npm run build`
Expected: all pass. Revert native build bumps:

```bash
cd /Users/arjun/fiddle/zmNinjaNg
git checkout -- app/android/app/build.gradle app/ios/App/App.xcodeproj/project.pbxproj
```

- [ ] **Step 6: Commit**

```bash
cd /Users/arjun/fiddle/zmNinjaNg
git add app/tests/features/monitor-detail.feature app/tests/steps/monitor-detail.steps.ts docs/developer-guide/05-component-architecture.rst
git commit -m "test: e2e cancel-delete on recent events; docs (refs #213)"
```

---

## Notes for the implementer

- The API function `deleteEvent` and the hook method are both named `deleteEvent`; in the hook, import the API one aliased (`deleteEvent as apiDeleteEvent`).
- `event.Notes` is `string | null` on the `Event` schema; `parseDetectedObjects` handles null.
- Delete must invalidate the `monitorRecentEvents` queries (predicate on `queryKey.includes('monitorRecentEvents')`), not just `['events']`, or the recent list will not refresh after a delete.
- Do not run device (iOS/Android) e2e; those are manual-invoke only. The web e2e cancels rather than deletes, so it is safe against the live server.
- `log.eventCard(msg, LogLevel.ERROR, { ...context, error })` matches the existing usage in `EventCard.tsx` (error goes inside the context object).
