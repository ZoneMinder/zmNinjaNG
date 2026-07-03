# Bulk delete events — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-event delete confirmation with a batch: tapping trash queues an event (red-marked row), a floating "Delete N events" bubble (rendered app-wide) confirms or cancels, and the batch persists across navigation until confirmed or cancelled.

**Architecture:** A zustand selection store holds queued event ids. `EventDeleteButton` toggles membership; `CompactEventRow`/`EventCard` red-mark selected rows. `DeleteBatchBar` (rendered once in `AppLayout`) shows the count and drives `useBulkDeleteEvents`, which deletes via the existing API and invalidates queries.

**Tech Stack:** React 18, TypeScript, Zustand, React Query v5, react-i18next (with `_one`/`_other` plurals), Tailwind, Vitest + @testing-library/react, Playwright (web e2e).

## Global Constraints

- All npm commands run from `app/`.
- Verify before every commit: `npm test`, `npx tsc --noEmit`, `npm run build`. After `npm run build`, revert native build-number bumps: `git checkout -- app/android/app/build.gradle app/ios/App/App.xcodeproj/project.pbxproj`.
- HTTP only via the existing `deleteEvent` in `api/events.ts`.
- `log.*` (use `log.eventCard`) not `console.*`; named constants in `lib/zmninja-ng-constants.ts`.
- No hardcoded user-facing strings; update all 5 locales (en/de/es/fr/zh). Reuse `common.cancel`, `common.delete`, existing `events.delete_failed`.
- i18n plurals use `_one`/`_other` with `{{count}}` (project convention, e.g. `monitors.count_one`).
- `data-testid` on interactive elements. No em-dashes in `app/src` (a unit test enforces it).
- No automated e2e may delete a real event; the e2e cancels.
- Commit format: conventional, `refs #213`.

---

### Task 1: Delete-selection store

**Files:**
- Create: `app/src/stores/deleteSelection.ts`
- Create: `app/src/stores/__tests__/deleteSelection.test.ts`

**Interfaces:**
- Produces: `useDeleteSelectionStore` with `{ selectedIds: string[]; toggle: (eventId: string) => void; clear: () => void }`.

- [ ] **Step 1: Write the failing test**

Create `app/src/stores/__tests__/deleteSelection.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useDeleteSelectionStore } from '../deleteSelection';

describe('useDeleteSelectionStore', () => {
  beforeEach(() => useDeleteSelectionStore.getState().clear());

  it('starts empty', () => {
    expect(useDeleteSelectionStore.getState().selectedIds).toEqual([]);
  });
  it('toggle adds an id, toggle again removes it', () => {
    useDeleteSelectionStore.getState().toggle('42');
    expect(useDeleteSelectionStore.getState().selectedIds).toEqual(['42']);
    useDeleteSelectionStore.getState().toggle('42');
    expect(useDeleteSelectionStore.getState().selectedIds).toEqual([]);
  });
  it('accumulates multiple ids', () => {
    useDeleteSelectionStore.getState().toggle('1');
    useDeleteSelectionStore.getState().toggle('2');
    expect(useDeleteSelectionStore.getState().selectedIds).toEqual(['1', '2']);
  });
  it('clear empties the selection', () => {
    useDeleteSelectionStore.getState().toggle('1');
    useDeleteSelectionStore.getState().clear();
    expect(useDeleteSelectionStore.getState().selectedIds).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- deleteSelection`
Expected: FAIL — cannot resolve `../deleteSelection`.

- [ ] **Step 3: Write the implementation**

Create `app/src/stores/deleteSelection.ts`:

```ts
/**
 * Transient selection of events queued for bulk deletion (refs #213). Session
 * only, not persisted. Cleared on cancel or after a successful bulk delete.
 */
import { create } from 'zustand';

interface DeleteSelectionState {
  selectedIds: string[];
  toggle: (eventId: string) => void;
  clear: () => void;
}

export const useDeleteSelectionStore = create<DeleteSelectionState>((set) => ({
  selectedIds: [],
  toggle: (eventId) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(eventId)
        ? s.selectedIds.filter((id) => id !== eventId)
        : [...s.selectedIds, eventId],
    })),
  clear: () => set({ selectedIds: [] }),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test -- deleteSelection`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd app && npx tsc --noEmit
git add src/stores/deleteSelection.ts src/stores/__tests__/deleteSelection.test.ts
git commit -m "feat: add delete-selection store for bulk delete (refs #213)"
```

---

### Task 2: `useBulkDeleteEvents` hook

**Files:**
- Create: `app/src/hooks/useBulkDeleteEvents.ts`
- Create: `app/src/hooks/__tests__/useBulkDeleteEvents.test.tsx`
- Modify: `app/src/locales/{en,de,es,fr,zh}/translation.json` (`delete_selected_success` plurals)

**Interfaces:**
- Consumes: `deleteEvent` from `api/events.ts` (aliased), `log.eventCard`, `events.delete_selected_success`, `events.delete_failed`.
- Produces: `useBulkDeleteEvents(): { deleteEvents: (eventIds: string[]) => Promise<void>; isDeleting: boolean }`.

- [ ] **Step 1: Add the i18n keys**

Add to the `events` namespace in `app/src/locales/en/translation.json`:

```json
"delete_selected_success_one": "Deleted {{count}} event",
"delete_selected_success_other": "Deleted {{count}} events",
```

Add to de/es/fr/zh (`events` namespace):
- de: `"{{count}} Ereignis gelöscht"` / `"{{count}} Ereignisse gelöscht"`
- es: `"{{count}} evento eliminado"` / `"{{count}} eventos eliminados"`
- fr: `"{{count}} événement supprimé"` / `"{{count}} événements supprimés"`
- zh: `"已删除 {{count}} 个事件"` / `"已删除 {{count}} 个事件"`

- [ ] **Step 2: Write the failing test**

Create `app/src/hooks/__tests__/useBulkDeleteEvents.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useBulkDeleteEvents } from '../useBulkDeleteEvents';
import { deleteEvent } from '../../api/events';
import { toast } from 'sonner';

vi.mock('../../api/events', () => ({ deleteEvent: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, o?: { count?: number }) => `${k}:${o?.count ?? ''}` }) }));
vi.mock('../../lib/logger', () => ({ log: { eventCard: vi.fn() }, LogLevel: { ERROR: 'ERROR' } }));

let qc: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.clearAllMocks();
});

describe('useBulkDeleteEvents', () => {
  it('deletes all ids, invalidates, and toasts success with the count', async () => {
    (deleteEvent as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useBulkDeleteEvents(), { wrapper });

    await act(async () => { await result.current.deleteEvents(['1', '2']); });

    expect(deleteEvent).toHaveBeenCalledTimes(2);
    expect(deleteEvent).toHaveBeenCalledWith('1');
    expect(deleteEvent).toHaveBeenCalledWith('2');
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(keys.some((k) => k.includes('"events"'))).toBe(true);
    expect(spy.mock.calls.some((c) => typeof (c[0] as { predicate?: unknown })?.predicate === 'function')).toBe(true);
    expect(toast.success).toHaveBeenCalledWith('events.delete_selected_success:2');
  });

  it('toasts failure when any delete rejects, without aborting the rest', async () => {
    (deleteEvent as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('nope'));
    const { result } = renderHook(() => useBulkDeleteEvents(), { wrapper });
    await act(async () => { await result.current.deleteEvents(['1', '2']); });
    expect(deleteEvent).toHaveBeenCalledTimes(2); // both attempted
    expect(toast.error).toHaveBeenCalledWith('events.delete_failed:');
  });

  it('does nothing for an empty list', async () => {
    const { result } = renderHook(() => useBulkDeleteEvents(), { wrapper });
    await act(async () => { await result.current.deleteEvents([]); });
    expect(deleteEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app && npm test -- useBulkDeleteEvents`
Expected: FAIL — cannot resolve `../useBulkDeleteEvents`.

- [ ] **Step 4: Write the implementation**

Create `app/src/hooks/useBulkDeleteEvents.ts`:

```ts
/**
 * Delete several ZoneMinder events at once (refs #213). Uses Promise.allSettled
 * so one failure does not abort the rest, invalidates the events / single-event
 * / monitorRecentEvents queries, and toasts a count (or a failure).
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { deleteEvent as apiDeleteEvent } from '../api/events';
import { log, LogLevel } from '../lib/logger';

export function useBulkDeleteEvents(): {
  deleteEvents: (eventIds: string[]) => Promise<void>;
  isDeleting: boolean;
} {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = useState(false);

  const deleteEvents = async (eventIds: string[]) => {
    if (eventIds.length === 0) return;
    setIsDeleting(true);
    try {
      const results = await Promise.allSettled(eventIds.map((id) => apiDeleteEvent(id)));
      const failed = results.filter((r) => r.status === 'rejected').length;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['events'] }),
        ...eventIds.map((id) => queryClient.invalidateQueries({ queryKey: ['event', id] })),
        queryClient.invalidateQueries({
          predicate: (q) => q.queryKey.includes('monitorRecentEvents'),
        }),
      ]);
      if (failed > 0) {
        log.eventCard('Bulk delete had failures', LogLevel.ERROR, { failed, total: eventIds.length });
        toast.error(t('events.delete_failed'));
      } else {
        toast.success(t('events.delete_selected_success', { count: eventIds.length }));
      }
    } finally {
      setIsDeleting(false);
    }
  };

  return { deleteEvents, isDeleting };
}
```

- [ ] **Step 5: Run test + validate JSON**

Run: `cd app && npm test -- useBulkDeleteEvents && node -e "['en','de','es','fr','zh'].forEach(l=>require('./src/locales/'+l+'/translation.json'))"`
Expected: PASS (3 tests), JSON valid.

- [ ] **Step 6: Commit**

```bash
cd app && npx tsc --noEmit
git add src/hooks/useBulkDeleteEvents.ts src/hooks/__tests__/useBulkDeleteEvents.test.tsx src/locales/en/translation.json src/locales/de/translation.json src/locales/es/translation.json src/locales/fr/translation.json src/locales/zh/translation.json
git commit -m "feat: add useBulkDeleteEvents hook (refs #213)"
```

---

### Task 3: `DeleteBatchBar` + mount app-wide

**Files:**
- Create: `app/src/components/events/DeleteBatchBar.tsx`
- Create: `app/src/components/events/__tests__/DeleteBatchBar.test.tsx`
- Modify: `app/src/components/layout/AppLayout.tsx` (render the bar)
- Modify: `app/src/locales/{en,de,es,fr,zh}/translation.json` (`delete_selected` plurals)

**Interfaces:**
- Consumes: `useDeleteSelectionStore` (Task 1), `useBulkDeleteEvents` (Task 2).

- [ ] **Step 1: Add the i18n keys**

Add to the `events` namespace in `app/src/locales/en/translation.json`:

```json
"delete_selected_one": "Delete {{count}} event",
"delete_selected_other": "Delete {{count}} events",
```

Add to de/es/fr/zh:
- de: `"{{count}} Ereignis löschen"` / `"{{count}} Ereignisse löschen"`
- es: `"Eliminar {{count}} evento"` / `"Eliminar {{count}} eventos"`
- fr: `"Supprimer {{count}} événement"` / `"Supprimer {{count}} événements"`
- zh: `"删除 {{count}} 个事件"` / `"删除 {{count}} 个事件"`

- [ ] **Step 2: Write the failing test**

Create `app/src/components/events/__tests__/DeleteBatchBar.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeleteBatchBar } from '../DeleteBatchBar';
import { useDeleteSelectionStore } from '../../../stores/deleteSelection';

const deleteEvents = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../hooks/useBulkDeleteEvents', () => ({
  useBulkDeleteEvents: () => ({ deleteEvents, isDeleting: false }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: { count?: number }) => `${k}:${o?.count ?? ''}` }),
}));

beforeEach(() => {
  useDeleteSelectionStore.getState().clear();
  deleteEvents.mockClear();
});

describe('DeleteBatchBar', () => {
  it('is hidden when the selection is empty', () => {
    render(<DeleteBatchBar />);
    expect(screen.queryByTestId('delete-batch-bar')).toBeNull();
  });

  it('shows the count and clears on cancel', () => {
    useDeleteSelectionStore.getState().toggle('1');
    useDeleteSelectionStore.getState().toggle('2');
    render(<DeleteBatchBar />);
    expect(screen.getByTestId('delete-batch-bar')).toBeTruthy();
    expect(screen.getByText(/delete_selected:2/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('delete-batch-cancel'));
    expect(useDeleteSelectionStore.getState().selectedIds).toEqual([]);
  });

  it('deletes the selected ids on confirm', () => {
    useDeleteSelectionStore.getState().toggle('7');
    render(<DeleteBatchBar />);
    fireEvent.click(screen.getByTestId('delete-batch-confirm'));
    expect(deleteEvents).toHaveBeenCalledWith(['7']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app && npm test -- DeleteBatchBar`
Expected: FAIL — cannot resolve `../DeleteBatchBar`.

- [ ] **Step 4: Write the component**

Create `app/src/components/events/DeleteBatchBar.tsx`:

```tsx
/**
 * Floating bar shown while events are queued for bulk deletion (refs #213).
 * Rendered once app-wide; hidden when the selection is empty.
 */
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { useDeleteSelectionStore } from '../../stores/deleteSelection';
import { useBulkDeleteEvents } from '../../hooks/useBulkDeleteEvents';

export function DeleteBatchBar() {
  const { t } = useTranslation();
  const selectedIds = useDeleteSelectionStore((s) => s.selectedIds);
  const clear = useDeleteSelectionStore((s) => s.clear);
  const { deleteEvents, isDeleting } = useBulkDeleteEvents();

  if (selectedIds.length === 0) return null;

  const onDelete = async () => {
    await deleteEvents(selectedIds);
    clear();
  };

  return (
    <div
      className="fixed left-1/2 top-[calc(3.5rem+var(--sai-top,env(safe-area-inset-top)))] z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background/95 px-4 py-2 shadow-lg backdrop-blur"
      role="region"
      aria-label={t('events.delete_selected', { count: selectedIds.length })}
      data-testid="delete-batch-bar"
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <Trash2 className="h-4 w-4 text-destructive" />
        {t('events.delete_selected', { count: selectedIds.length })}
      </span>
      <Button variant="ghost" size="sm" onClick={clear} data-testid="delete-batch-cancel">
        {t('common.cancel')}
      </Button>
      <Button
        size="sm"
        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onClick={onDelete}
        disabled={isDeleting}
        data-testid="delete-batch-confirm"
      >
        {t('common.delete')}
      </Button>
    </div>
  );
}
```

- [ ] **Step 5: Mount it in AppLayout**

In `app/src/components/layout/AppLayout.tsx`, add the import near the other component imports:

```ts
import { DeleteBatchBar } from '../events/DeleteBatchBar';
```

Inside `<main ...>`, add `<DeleteBatchBar />` right after the `<Outlet />`:

```tsx
        <Outlet />
        <DeleteBatchBar />
```

- [ ] **Step 6: Run test + typecheck + JSON**

Run: `cd app && npm test -- DeleteBatchBar && npx tsc --noEmit && node -e "['en','de','es','fr','zh'].forEach(l=>require('./src/locales/'+l+'/translation.json'))"`
Expected: PASS (3 tests), no type errors, JSON valid.

- [ ] **Step 7: Commit**

```bash
cd app
git add src/components/events/DeleteBatchBar.tsx src/components/events/__tests__/DeleteBatchBar.test.tsx src/components/layout/AppLayout.tsx src/locales/en/translation.json src/locales/de/translation.json src/locales/es/translation.json src/locales/fr/translation.json src/locales/zh/translation.json
git commit -m "feat: add app-wide DeleteBatchBar for bulk delete (refs #213)"
```

---

### Task 4: `EventDeleteButton` becomes a toggle; remove the single-delete path

**Files:**
- Modify: `app/src/components/events/EventDeleteButton.tsx`
- Modify: `app/src/components/events/__tests__/EventDeleteButton.test.tsx` (rewrite)
- Modify: `app/src/components/events/CompactEventRow.tsx` (call site) and `app/src/components/events/EventCard.tsx` (call site)
- Delete: `app/src/hooks/useDeleteEvent.ts` and `app/src/hooks/__tests__/useDeleteEvent.test.tsx`
- Modify: `app/src/components/events/__tests__/CompactEventRow.test.tsx` (drop the `useDeleteEvent` mock)
- Modify: `app/src/locales/{en,de,es,fr,zh}/translation.json` (add `delete_toggle_aria`; remove `delete_confirm_title`, `delete_confirm_desc`, `delete_aria`, `delete_success` from the `events` namespace only)

**Interfaces:**
- Consumes: `useDeleteSelectionStore` (Task 1).
- Produces: `EventDeleteButton(props: { eventId: string; size?: 'sm' | 'md'; className?: string })` — a toggle button.

- [ ] **Step 1: Confirm `useDeleteEvent` has no other callers**

Run: `cd app && grep -rn "useDeleteEvent" src | grep -v "__tests__\|useDeleteEvent.ts"`
Expected: only `EventDeleteButton.tsx` (which this task rewrites). If any other file uses it, stop and report — do not delete the hook.

- [ ] **Step 2: Add / remove i18n keys**

In each of `en/de/es/fr/zh`: add to the `events` namespace `"delete_toggle_aria": <text>` and remove the `events`-namespace keys `delete_confirm_title`, `delete_confirm_desc`, `delete_aria`, `delete_success`. Do NOT touch the identically-named keys in the `profiles` namespace.

`delete_toggle_aria` text:
- en: `"Select event for deletion"`
- de: `"Ereignis zum Löschen auswählen"`
- es: `"Seleccionar evento para eliminar"`
- fr: `"Sélectionner l'événement à supprimer"`
- zh: `"选择要删除的事件"`

- [ ] **Step 3: Rewrite the EventDeleteButton test**

Replace `app/src/components/events/__tests__/EventDeleteButton.test.tsx` with:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EventDeleteButton } from '../EventDeleteButton';
import { useDeleteSelectionStore } from '../../../stores/deleteSelection';

beforeEach(() => useDeleteSelectionStore.getState().clear());

describe('EventDeleteButton', () => {
  it('toggles the event id in the selection store on click', () => {
    render(<EventDeleteButton eventId="42" />);
    fireEvent.click(screen.getByTestId('event-delete-button'));
    expect(useDeleteSelectionStore.getState().selectedIds).toEqual(['42']);
    fireEvent.click(screen.getByTestId('event-delete-button'));
    expect(useDeleteSelectionStore.getState().selectedIds).toEqual([]);
  });

  it('reflects the selected state via aria-pressed', () => {
    useDeleteSelectionStore.getState().toggle('42');
    render(<EventDeleteButton eventId="42" />);
    expect(screen.getByTestId('event-delete-button').getAttribute('aria-pressed')).toBe('true');
  });

  it('does not bubble the click to a parent row', () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <EventDeleteButton eventId="42" />
      </div>
    );
    fireEvent.click(screen.getByTestId('event-delete-button'));
    expect(parentClick).not.toHaveBeenCalled();
  });
});
```

Add `import { vi } from 'vitest';` to the imports (used by the third test).

- [ ] **Step 4: Run test to verify it fails**

Run: `cd app && npm test -- EventDeleteButton`
Expected: FAIL — the current button opens a dialog, not the store.

- [ ] **Step 5: Rewrite EventDeleteButton**

Replace `app/src/components/events/EventDeleteButton.tsx` with:

```tsx
/**
 * Trash toggle that queues/unqueues a ZoneMinder event for bulk deletion
 * (refs #213). Used by the compact recent-events row and the full EventCard.
 * Click propagation is stopped so it never triggers the parent row navigation.
 */
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { useDeleteSelectionStore } from '../../stores/deleteSelection';

interface EventDeleteButtonProps {
  eventId: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function EventDeleteButton({ eventId, size = 'md', className }: EventDeleteButtonProps) {
  const { t } = useTranslation();
  const selected = useDeleteSelectionStore((s) => s.selectedIds.includes(eventId));
  const toggle = useDeleteSelectionStore((s) => s.toggle);
  const iconSize = size === 'sm' ? 'h-4 w-4' : 'h-4 w-4 sm:h-5 sm:w-5';

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggle(eventId);
      }}
      className={cn(
        'p-1 rounded-full hover:bg-accent transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        className
      )}
      aria-label={t('events.delete_toggle_aria')}
      aria-pressed={selected}
      title={t('events.delete_toggle_aria')}
      data-testid="event-delete-button"
    >
      <Trash2
        className={cn(
          iconSize,
          'transition-colors',
          selected ? 'fill-destructive text-destructive' : 'stroke-muted-foreground hover:stroke-destructive'
        )}
      />
    </button>
  );
}
```

- [ ] **Step 6: Update the two call sites**

In `app/src/components/events/CompactEventRow.tsx`, change the `<EventDeleteButton .../>` to drop `eventName`/`monitorName`:

```tsx
      <EventDeleteButton eventId={event.Id} size="sm" className="flex-shrink-0" />
```

In `app/src/components/events/EventCard.tsx`, change it to:

```tsx
                <EventDeleteButton eventId={event.Id} />
```

- [ ] **Step 7: Remove the single-delete hook and its test mock**

Delete `app/src/hooks/useDeleteEvent.ts` and `app/src/hooks/__tests__/useDeleteEvent.test.tsx`:

```bash
cd app && git rm src/hooks/useDeleteEvent.ts src/hooks/__tests__/useDeleteEvent.test.tsx
```

In `app/src/components/events/__tests__/CompactEventRow.test.tsx`, remove the now-broken mock block:

```tsx
vi.mock('../../../hooks/useDeleteEvent', () => ({
  useDeleteEvent: () => ({ deleteEvent: vi.fn(), isDeleting: false }),
}));
```

(The rest of that test file stays; it renders `EventDeleteButton`, which now uses the real selection store.)

- [ ] **Step 8: Run tests + typecheck + build**

Run: `cd app && npm test -- EventDeleteButton CompactEventRow events && npx tsc --noEmit && npm run build && node -e "['en','de','es','fr','zh'].forEach(l=>require('./src/locales/'+l+'/translation.json'))"`
Expected: all pass (the build's `tsc -b` also confirms no dangling references to `useDeleteEvent` or the removed i18n keys). Revert native build bumps:

```bash
cd /Users/arjun/fiddle/zmNinjaNg
git checkout -- app/android/app/build.gradle app/ios/App/App.xcodeproj/project.pbxproj
```

- [ ] **Step 9: Commit**

```bash
cd /Users/arjun/fiddle/zmNinjaNg/app
git add src/components/events/EventDeleteButton.tsx src/components/events/__tests__/EventDeleteButton.test.tsx src/components/events/CompactEventRow.tsx src/components/events/EventCard.tsx src/components/events/__tests__/CompactEventRow.test.tsx src/hooks/useDeleteEvent.ts src/hooks/__tests__/useDeleteEvent.test.tsx src/locales/en/translation.json src/locales/de/translation.json src/locales/es/translation.json src/locales/fr/translation.json src/locales/zh/translation.json
git commit -m "feat: make EventDeleteButton a batch toggle, drop single-delete dialog (refs #213)"
```

---

### Task 5: Red-mark queued rows

**Files:**
- Modify: `app/src/components/events/CompactEventRow.tsx`
- Modify: `app/src/components/events/EventCard.tsx`
- Modify: `app/src/components/events/__tests__/CompactEventRow.test.tsx` (add a selected-highlight test)

**Interfaces:**
- Consumes: `useDeleteSelectionStore` (Task 1).

- [ ] **Step 1: Add the failing test**

In `app/src/components/events/__tests__/CompactEventRow.test.tsx`, add the store import at the top if not present:

```tsx
import { useDeleteSelectionStore } from '../../../stores/deleteSelection';
```

and add a test inside the `describe`:

```tsx
  it('marks the row for deletion when its event is queued', () => {
    useDeleteSelectionStore.getState().clear();
    useDeleteSelectionStore.getState().toggle('233228');
    render1();
    expect(screen.getByTestId('compact-event-row').className).toContain('ring-destructive/60');
    useDeleteSelectionStore.getState().clear();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- CompactEventRow`
Expected: FAIL — no `ring-destructive/60` on the row yet.

- [ ] **Step 3: Add the highlight in CompactEventRow**

In `app/src/components/events/CompactEventRow.tsx`, add near the other hooks:

```ts
  const selectedForDelete = useDeleteSelectionStore((s) => s.selectedIds.includes(event.Id));
```

and its import:

```ts
import { useDeleteSelectionStore } from '../../stores/deleteSelection';
```

In the row container's `className` `cn(...)`, add the destructive highlight AFTER the existing `flash && ...` entry so it wins when both apply:

```tsx
        flash && 'ring-2 ring-primary/60 bg-primary/5',
        selectedForDelete && 'ring-2 ring-destructive/60 bg-destructive/5'
```

- [ ] **Step 4: Add the highlight in EventCard**

In `app/src/components/events/EventCard.tsx`, add the import and hook:

```ts
import { useDeleteSelectionStore } from '../../stores/deleteSelection';
```
```ts
  const selectedForDelete = useDeleteSelectionStore((s) => s.selectedIds.includes(event.Id));
```

In the `Card`'s `className` `cn(...)`, add after the `flash && ...` entry:

```tsx
        flash && 'ring-2 ring-primary/60 bg-primary/5',
        selectedForDelete && 'ring-2 ring-destructive/60 bg-destructive/5'
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd app && npm test -- CompactEventRow EventCard events && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd app
git add src/components/events/CompactEventRow.tsx src/components/events/EventCard.tsx src/components/events/__tests__/CompactEventRow.test.tsx
git commit -m "feat: red-mark rows queued for bulk deletion (refs #213)"
```

---

### Task 6: E2e (replace dialog scenario) + docs

**Files:**
- Modify: `app/tests/features/monitor-detail.feature`
- Modify: `app/tests/steps/monitor-detail.steps.ts`
- Modify: `docs/developer-guide/05-component-architecture.rst`

**Interfaces:**
- Consumes: test ids `compact-event-row`, `event-delete-button`, `delete-batch-bar`, `delete-batch-cancel`.

- [ ] **Step 1: Replace the old delete scenario**

In `app/tests/features/monitor-detail.feature`, delete the scenario titled "Delete confirm dialog on a recent event can be cancelled" and append:

```gherkin
@web
Scenario: Queue two events for deletion and cancel the batch
  Given I am logged into zmNinjaNg
  When I open the first monitor's detail view
  Then the recent events list should be visible
  When I queue the first two recent events for deletion
  Then the delete batch bar should show 2 events
  When I cancel the delete batch
  Then the delete batch bar should be gone
```

- [ ] **Step 2: Update the step definitions**

In `app/tests/steps/monitor-detail.steps.ts`: remove the steps that referenced the old dialog (`event-delete-dialog`, `event-delete-cancel`, and any "tap the delete button on the first recent event" / "the event delete confirm dialog should be visible" / "cancel the event delete dialog" / "the first recent event should still be present" steps that only that scenario used). Add, using the existing raw-Playwright pattern and reusing the login/open/recent-list-visible steps:
- "I queue the first two recent events for deletion": click the `event-delete-button` inside the first two `[data-testid="monitor-recent-events-body"] [data-testid="compact-event-row"]`.
- "the delete batch bar should show 2 events": assert `[data-testid="delete-batch-bar"]` is visible and contains the text "2".
- "I cancel the delete batch": click `[data-testid="delete-batch-cancel"]`.
- "the delete batch bar should be gone": assert `[data-testid="delete-batch-bar"]` is not visible.

- [ ] **Step 3: Run the e2e feature**

Run: `cd app && npm run test:e2e -- monitor-detail.feature`
Expected: all scenarios pass on `web-chromium`, including the new batch-cancel one. No real event is deleted (cancel path). If no ZM server is reachable, report that it compiles but needs a manual run; do not treat env issues as a code failure.

- [ ] **Step 4: Update the developer guide**

In `docs/developer-guide/05-component-architecture.rst`, replace the previous per-event delete description with the batch model: the `useDeleteSelectionStore` (queued ids, toggle/clear, session-only), `EventDeleteButton` as a toggle that red-marks the row, `DeleteBatchBar` (rendered once in `AppLayout`, shows the count, Cancel/Delete), and `useBulkDeleteEvents` (Promise.allSettled, batched invalidation, pluralized toast). Note the batch persists across navigation and clears on cancel or after delete. Factual tone; NO banned words, NO em-dashes. Verify (from repo root):

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
git commit -m "test: e2e for bulk-delete batch bar; docs (refs #213)"
```

---

## Notes for the implementer

- The batch persists across navigation on purpose (survives opening an event); it clears only on Cancel or after a successful Delete. Do NOT add a clear-on-unmount.
- `DeleteBatchBar` is rendered once in `AppLayout` so it floats above every page; do not also render it inside the lists.
- The destructive queued-row highlight must come AFTER the return-flash highlight in the `cn(...)` list so it wins if both are ever active.
- Do not run device (iOS/Android) e2e; those are manual-invoke only. The web e2e cancels rather than deletes.
- After removing `useDeleteEvent`, the `events.delete_success` key is unused; it is removed in Task 4. `events.delete_failed` stays (used by the bulk hook).
