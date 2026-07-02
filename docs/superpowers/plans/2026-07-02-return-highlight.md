# Return highlight — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When you return from an event, briefly flag the row you came from with a blinking arrow and a soft highlight for 4 seconds, in both the recent-events list and the main event list.

**Architecture:** A zustand store records the last-opened event id when a row is clicked; a `useReturnFlash(eventId)` hook consumes it once on the returning list's mount and drives a 4s flash. A shared `ReturnFlashArrow` renders the blinking arrow; both `CompactEventRow` and `EventCard` add a highlight ring when flashing.

**Tech Stack:** React 18, TypeScript, Zustand, Tailwind v3 (config keyframes), Vitest + @testing-library/react, Playwright (web e2e).

## Global Constraints

- All npm commands run from `app/`.
- Verify before every commit: `npm test`, `npx tsc --noEmit`, `npm run build`. After `npm run build`, revert native build-number bumps: `git checkout -- app/android/app/build.gradle app/ios/App/App.xcodeproj/project.pbxproj`.
- Named constants live in `lib/zmninja-ng-constants.ts`.
- `data-testid` (kebab-case) on the indicator.
- The blink must be gated `motion-safe:` so reduced-motion users get a static arrow + highlight.
- The arrow is decorative: `aria-hidden`. No new user-facing strings, so no i18n changes.
- The flash must fire only on return, exactly once, on one row (consume the stored id).
- Commit format: conventional, `refs #213`.

---

### Task 1: Store + constant

**Files:**
- Create: `app/src/stores/returnHighlight.ts`
- Create: `app/src/stores/__tests__/returnHighlight.test.ts`
- Modify: `app/src/lib/zmninja-ng-constants.ts` (`RETURN_FLASH_MS`)

**Interfaces:**
- Produces:
  - `useReturnHighlightStore` (zustand) with state `{ lastViewedEventId: string | null; markViewed: (eventId: string) => void; clear: () => void }`
  - `RETURN_FLASH_MS = 4000`

- [ ] **Step 1: Add the constant**

In `app/src/lib/zmninja-ng-constants.ts`, after `SCROLL_RESTORE_MAX_MS`:

```ts
/**
 * How long (ms) to flag the event row a user just returned from, with a blinking
 * arrow and a soft highlight, in the recent-events and main event lists.
 */
export const RETURN_FLASH_MS = 4000;
```

- [ ] **Step 2: Write the failing test**

Create `app/src/stores/__tests__/returnHighlight.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useReturnHighlightStore } from '../returnHighlight';

describe('useReturnHighlightStore', () => {
  beforeEach(() => useReturnHighlightStore.getState().clear());

  it('starts empty', () => {
    expect(useReturnHighlightStore.getState().lastViewedEventId).toBeNull();
  });
  it('markViewed sets the id', () => {
    useReturnHighlightStore.getState().markViewed('42');
    expect(useReturnHighlightStore.getState().lastViewedEventId).toBe('42');
  });
  it('clear nulls the id', () => {
    useReturnHighlightStore.getState().markViewed('42');
    useReturnHighlightStore.getState().clear();
    expect(useReturnHighlightStore.getState().lastViewedEventId).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app && npm test -- returnHighlight`
Expected: FAIL — cannot resolve `../returnHighlight`.

- [ ] **Step 4: Write the implementation**

Create `app/src/stores/returnHighlight.ts`:

```ts
/**
 * Transient store of the last event a user opened from a list, so the list can
 * flag that row when the user returns (refs #213). Session-only, not persisted.
 */
import { create } from 'zustand';

interface ReturnHighlightState {
  lastViewedEventId: string | null;
  markViewed: (eventId: string) => void;
  clear: () => void;
}

export const useReturnHighlightStore = create<ReturnHighlightState>((set) => ({
  lastViewedEventId: null,
  markViewed: (eventId) => set({ lastViewedEventId: eventId }),
  clear: () => set({ lastViewedEventId: null }),
}));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npm test -- returnHighlight`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
cd app && npx tsc --noEmit
git add src/stores/returnHighlight.ts src/stores/__tests__/returnHighlight.test.ts src/lib/zmninja-ng-constants.ts
git commit -m "feat: add return-highlight store and flash duration constant (refs #213)"
```

---

### Task 2: `useReturnFlash` hook

**Files:**
- Create: `app/src/hooks/useReturnFlash.ts`
- Create: `app/src/hooks/__tests__/useReturnFlash.test.tsx`

**Interfaces:**
- Consumes: `useReturnHighlightStore` (Task 1), `RETURN_FLASH_MS` (Task 1).
- Produces: `useReturnFlash(eventId: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `app/src/hooks/__tests__/useReturnFlash.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReturnFlash } from '../useReturnFlash';
import { useReturnHighlightStore } from '../../stores/returnHighlight';

describe('useReturnFlash', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useReturnHighlightStore.getState().clear();
  });
  afterEach(() => vi.useRealTimers());

  it('flashes for a matching id, then stops after 4s, and consumes the id', () => {
    useReturnHighlightStore.getState().markViewed('42');
    const { result } = renderHook(() => useReturnFlash('42'));
    expect(result.current).toBe(true);
    // consumed so it will not re-flash on a later mount
    expect(useReturnHighlightStore.getState().lastViewedEventId).toBeNull();
    act(() => vi.advanceTimersByTime(4000));
    expect(result.current).toBe(false);
  });

  it('does not flash for a non-matching id and leaves the store intact', () => {
    useReturnHighlightStore.getState().markViewed('42');
    const { result } = renderHook(() => useReturnFlash('99'));
    expect(result.current).toBe(false);
    expect(useReturnHighlightStore.getState().lastViewedEventId).toBe('42');
  });

  it('does not flash when nothing was stored', () => {
    const { result } = renderHook(() => useReturnFlash('42'));
    expect(result.current).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- useReturnFlash`
Expected: FAIL — cannot resolve `../useReturnFlash`.

- [ ] **Step 3: Write the implementation**

Create `app/src/hooks/useReturnFlash.ts`:

```ts
/**
 * Returns true for ~RETURN_FLASH_MS if this event row is the one the user just
 * returned from. Captures the stored id once at mount (non-reactive) and
 * consumes it, so exactly one row flashes, once, on return (refs #213).
 */
import { useEffect, useState } from 'react';
import { useReturnHighlightStore } from '../stores/returnHighlight';
import { RETURN_FLASH_MS } from '../lib/zmninja-ng-constants';

export function useReturnFlash(eventId: string): boolean {
  const [flashId] = useState(() => useReturnHighlightStore.getState().lastViewedEventId);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (!flashId || flashId !== eventId) return;
    useReturnHighlightStore.getState().clear();
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), RETURN_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flashId, eventId]);

  return flash;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test -- useReturnFlash`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd app && npx tsc --noEmit
git add src/hooks/useReturnFlash.ts src/hooks/__tests__/useReturnFlash.test.tsx
git commit -m "feat: add useReturnFlash hook (refs #213)"
```

---

### Task 3: Blink animation + `ReturnFlashArrow`

**Files:**
- Modify: `app/tailwind.config.js` (blink keyframe + animation)
- Create: `app/src/components/events/ReturnFlashArrow.tsx`
- Create: `app/src/components/events/__tests__/ReturnFlashArrow.test.tsx`

**Interfaces:**
- Produces: `ReturnFlashArrow(props: { className?: string })` — an absolutely-positioned, `aria-hidden` blinking arrow with `data-testid="return-flash-indicator"`.

- [ ] **Step 1: Add the blink animation to Tailwind**

In `app/tailwind.config.js`, inside `theme.extend.keyframes` add:

```js
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.15" },
        },
```

and inside `theme.extend.animation` add:

```js
        blink: "blink 0.9s ease-in-out infinite",
```

- [ ] **Step 2: Write the failing test**

Create `app/src/components/events/__tests__/ReturnFlashArrow.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReturnFlashArrow } from '../ReturnFlashArrow';

describe('ReturnFlashArrow', () => {
  it('renders an aria-hidden, motion-safe blinking indicator', () => {
    render(<ReturnFlashArrow />);
    const el = screen.getByTestId('return-flash-indicator');
    expect(el).toBeTruthy();
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.className).toContain('motion-safe:animate-blink');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app && npm test -- ReturnFlashArrow`
Expected: FAIL — cannot resolve `../ReturnFlashArrow`.

- [ ] **Step 4: Write the implementation**

Create `app/src/components/events/ReturnFlashArrow.tsx`:

```tsx
/**
 * Blinking arrow pinned at the left edge of the event row a user just returned
 * from. Decorative (aria-hidden); the blink is gated motion-safe so reduced
 * motion shows it static (refs #213). The parent must be positioned (relative).
 */
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

export function ReturnFlashArrow({ className }: { className?: string }) {
  return (
    <ChevronRight
      aria-hidden
      data-testid="return-flash-indicator"
      className={cn(
        'pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 h-5 w-5 text-primary drop-shadow motion-safe:animate-blink',
        className
      )}
    />
  );
}
```

- [ ] **Step 5: Run test + build (verify the Tailwind class compiles)**

Run: `cd app && npm test -- ReturnFlashArrow && npm run build`
Expected: test PASS (1 test), build succeeds (confirms the `animate-blink` utility is generated). Then revert native build bumps:

```bash
cd /Users/arjun/fiddle/zmNinjaNg
git checkout -- app/android/app/build.gradle app/ios/App/App.xcodeproj/project.pbxproj
```

- [ ] **Step 6: Commit**

```bash
cd /Users/arjun/fiddle/zmNinjaNg/app && npx tsc --noEmit
git add tailwind.config.js src/components/events/ReturnFlashArrow.tsx src/components/events/__tests__/ReturnFlashArrow.test.tsx
git commit -m "feat: add blink animation and ReturnFlashArrow indicator (refs #213)"
```

---

### Task 4: Wire into `CompactEventRow`

**Files:**
- Modify: `app/src/components/events/CompactEventRow.tsx`
- Modify: `app/src/components/events/__tests__/CompactEventRow.test.tsx`

**Interfaces:**
- Consumes: `useReturnFlash` (Task 2), `useReturnHighlightStore` (Task 1), `ReturnFlashArrow` (Task 3).

- [ ] **Step 1: Update the failing test**

In `app/src/components/events/__tests__/CompactEventRow.test.tsx`, add an import at the top:

```tsx
import { useReturnHighlightStore } from '../../../stores/returnHighlight';
```

Then add a test inside the `describe('CompactEventRow', ...)` block:

```tsx
  it('shows the return-flash indicator when returning to this event', () => {
    useReturnHighlightStore.getState().markViewed('233228');
    render1();
    expect(screen.getByTestId('return-flash-indicator')).toBeTruthy();
    useReturnHighlightStore.getState().clear();
  });

  it('does not show the indicator normally', () => {
    useReturnHighlightStore.getState().clear();
    render1();
    expect(screen.queryByTestId('return-flash-indicator')).toBeNull();
  });
```

Note: the existing test file mocks `useDateTimeFormat` and `useDeleteEvent`; it does NOT mock the store, so the real `useReturnHighlightStore` is used here.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- CompactEventRow`
Expected: FAIL — no `return-flash-indicator` rendered yet.

- [ ] **Step 3: Wire the component**

In `app/src/components/events/CompactEventRow.tsx`:

Add imports:

```ts
import { cn } from '../../lib/utils';
import { ReturnFlashArrow } from './ReturnFlashArrow';
import { useReturnFlash } from '../../hooks/useReturnFlash';
import { useReturnHighlightStore } from '../../stores/returnHighlight';
```

Inside the component, add:

```ts
  const markViewed = useReturnHighlightStore((s) => s.markViewed);
  const flash = useReturnFlash(event.Id);
```

Change the `open` handler to record the view before navigating:

```ts
  const open = () => {
    markViewed(event.Id);
    navigate(`/events/${event.Id}`, { state: { from: `/monitors/${event.MonitorId}` } });
  };
```

Change the row container: add `relative` and the flash highlight to its
className, and render the arrow when flashing. Replace the container's static
`className="flex items-center gap-2.5 rounded-md p-1.5 cursor-pointer hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary"`
with:

```tsx
      className={cn(
        'relative flex items-center gap-2.5 rounded-md p-1.5 cursor-pointer hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary',
        flash && 'ring-2 ring-primary/60 bg-primary/5'
      )}
```

and add, as the first child inside that container (before the thumbnail `div`):

```tsx
      {flash && <ReturnFlashArrow />}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test -- CompactEventRow`
Expected: PASS (all tests, including the two new ones).

- [ ] **Step 5: Commit**

```bash
cd app && npx tsc --noEmit
git add src/components/events/CompactEventRow.tsx src/components/events/__tests__/CompactEventRow.test.tsx
git commit -m "feat: flash the returned-from row in the recent-events list (refs #213)"
```

---

### Task 5: Wire into `EventCard`

**Files:**
- Modify: `app/src/components/events/EventCard.tsx`

**Interfaces:**
- Consumes: `useReturnFlash` (Task 2), `useReturnHighlightStore` (Task 1), `ReturnFlashArrow` (Task 3).

- [ ] **Step 1: Add imports and hooks**

In `app/src/components/events/EventCard.tsx`, add imports (near the other event imports):

```ts
import { ReturnFlashArrow } from './ReturnFlashArrow';
import { useReturnFlash } from '../../hooks/useReturnFlash';
import { useReturnHighlightStore } from '../../stores/returnHighlight';
```

Inside `EventCardComponent`, near the other hooks, add:

```ts
  const markViewed = useReturnHighlightStore((s) => s.markViewed);
  const flash = useReturnFlash(event.Id);
  const openEvent = () => {
    markViewed(event.Id);
    navigate(`/events/${event.Id}`, { state: { from: '/events', eventFilters } });
  };
```

- [ ] **Step 2: Use the handler, add the highlight and arrow**

Replace the `Card`'s `onClick` and the `onKeyDown` body navigation with `openEvent()`:

```tsx
      onClick={openEvent}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openEvent();
        }
      }}
```

Change the `Card` className to be positioned and to add the flash highlight
(wrap the existing class string with `cn(...)`):

```tsx
      className={cn(
        'group relative overflow-hidden cursor-pointer hover:shadow-lg transition-all duration-200 hover:ring-2 hover:ring-primary/50 focus:outline-none focus:ring-2 focus:ring-primary',
        flash && 'ring-2 ring-primary/60 bg-primary/5'
      )}
```

(`cn` is already imported in this file.) Add the arrow as the first child inside
the `Card`, before the existing `<div className="flex gap-2 sm:gap-3 p-2 sm:p-3">`:

```tsx
      {flash && <ReturnFlashArrow />}
```

- [ ] **Step 3: Typecheck, build, regression tests**

Run: `cd app && npx tsc --noEmit && npm test -- EventCard events && npm run build`
Expected: pass. Then revert native build bumps:

```bash
cd /Users/arjun/fiddle/zmNinjaNg
git checkout -- app/android/app/build.gradle app/ios/App/App.xcodeproj/project.pbxproj
```

- [ ] **Step 4: Commit**

```bash
cd /Users/arjun/fiddle/zmNinjaNg/app
git add src/components/events/EventCard.tsx
git commit -m "feat: flash the returned-from card in the main event list (refs #213)"
```

---

### Task 6: E2e + docs

**Files:**
- Modify: `app/tests/features/monitor-detail.feature`
- Modify: `app/tests/steps/monitor-detail.steps.ts`
- Modify: `docs/developer-guide/05-component-architecture.rst`

**Interfaces:**
- Consumes: test ids `compact-event-row`, `return-flash-indicator`.

- [ ] **Step 1: Add the e2e scenario**

Append to `app/tests/features/monitor-detail.feature`:

```gherkin
@web
Scenario: Returning from a recent event flags the row I came from
  Given I am logged into zmNinjaNg
  When I open the first monitor's detail view
  Then the recent events list should be visible
  When I open the first recent event
  And I navigate back
  Then the returned-from recent event should be flagged
```

- [ ] **Step 2: Implement the step definitions**

In `app/tests/steps/monitor-detail.steps.ts`, add steps using the file's existing
raw-Playwright pattern. Reuse the existing "Given I am logged into zmNinjaNg",
"I open the first monitor's detail view", and "the recent events list should be
visible" steps — do not redefine them. Add:
- "I open the first recent event": click the first
  `[data-testid="monitor-recent-events-body"] [data-testid="compact-event-row"]`
  and wait for the URL to be an event detail (`/events/`).
- "I navigate back": `await page.goBack()`.
- "the returned-from recent event should be flagged": wait for
  `[data-testid="monitor-recent-events-body"]` visible, then assert a
  `[data-testid="return-flash-indicator"]` is visible (default expect timeout is
  under the 4s flash window).

- [ ] **Step 3: Run the e2e feature**

Run: `cd app && npm run test:e2e -- monitor-detail.feature`
Expected: all scenarios pass on `web-chromium`, including the new one. If no ZM
server is reachable, report that it compiles but needs a manual run; do not treat
that as a code failure.

- [ ] **Step 4: Update the developer guide**

In `docs/developer-guide/05-component-architecture.rst`, extend the recent-events
section to document the return highlight: the `useReturnHighlightStore` store, the
`useReturnFlash` hook (captures + consumes the stored id, 4s flash), the
`ReturnFlashArrow` indicator (decorative, `motion-safe` blink), and that both
`CompactEventRow` and `EventCard` set the stored id on open and highlight the row
on return. Factual tone; NO banned words, NO em-dashes. Verify (from repo root):

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
git commit -m "test: e2e for return highlight; docs (refs #213)"
```

---

## Notes for the implementer

- The flash must fire ONCE on return: `useReturnFlash` captures the stored id at mount and consumes it (`clear()`), so a later mount of the same row does not re-flash.
- `markViewed` is called on the row's open handler (click and keyboard), before `navigate`.
- The parent of `ReturnFlashArrow` must be `relative` (added to both the compact row container and the `Card`).
- The blink is `motion-safe:animate-blink`; do not remove the `motion-safe:` gate (reduced-motion users must get a static arrow).
- Do not run device (iOS/Android) e2e; those are manual-invoke only. The web e2e uses `page.goBack()` (a POP) which reuses the history key.
