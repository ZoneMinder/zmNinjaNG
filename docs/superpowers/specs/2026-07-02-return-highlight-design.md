# Return highlight: flag the event row you came back from (#213)

## Problem

After the scroll position is restored on returning from an event, the row you
opened is on screen but not called out, so on a long list it's still work to
find where you were. Flash that row briefly so it's obvious.

## Decisions

- **Blinking arrow + soft highlight, 4 seconds.** On return, the originating row
  shows a blinking arrow pinned at its left edge plus a soft highlight ring/tint
  on the row itself. After `RETURN_FLASH_MS` (4000 ms) both clear.

- **Reduced motion.** The blink is gated with Tailwind's `motion-safe:`. Users
  with `prefers-reduced-motion` get a static arrow + highlight for the same 4 s,
  no blinking. The arrow is `aria-hidden` (decorative; scroll restoration already
  lands the user on the row). No new user-facing strings, so no i18n changes.

- **Trigger via a small store.** A zustand store `useReturnHighlightStore` holds
  `lastViewedEventId`. An event row records its id when clicked to open the event;
  the next matching list row to mount consumes it and flashes once. This flashes
  only on return, never on an ordinary mount, and only one row.

- **Both lists.** Applies to the recent-events list (`CompactEventRow`) and the
  main event list (`EventCard`).

- **Accepted edge.** If a user opens an event and then navigates elsewhere
  instead of going back, the stored id lingers until some list containing that
  event next mounts, which flashes it once. Rare and harmless; no extra machinery
  to prevent it.

## Components and data flow

### New: `stores/returnHighlight.ts`
Zustand store:
```
interface ReturnHighlightState {
  lastViewedEventId: string | null;
  markViewed: (eventId: string) => void;   // set on row click
  clear: () => void;                        // consume
}
```
Not persisted (session-only, like other transient UI stores).

### New: `hooks/useReturnFlash.ts`
```
export function useReturnFlash(eventId: string): boolean
```
- Captures `useReturnHighlightStore.getState().lastViewedEventId` once at mount
  (non-reactive, via `useState` initializer) into `flashId`.
- In an effect keyed on `[flashId, eventId]`: if `flashId && flashId === eventId`,
  call `clear()` (via `getState()`, non-reactive so it does not re-render this
  row), set a local `flash=true`, and `setTimeout(() => setFlash(false), RETURN_FLASH_MS)`.
  The effect returns a cleanup that clears the timer on unmount only; because
  `flashId` is captured (stable), the effect runs once and the timer is not
  cancelled by re-renders.
- Returns `flash`.

### New: `RETURN_FLASH_MS = 4000` in `lib/zmninja-ng-constants.ts`.

### Blink animation
Add a `blink` keyframe + `animate-blink` utility to the Tailwind config
(`tailwind.config.*`): opacity 1 → 0.15 → 1, ~1s steps, infinite. Applied as
`motion-safe:animate-blink` so it only animates when motion is allowed.

### Modified: `components/events/CompactEventRow.tsx`
- On row click (in the existing `open()`), call `markViewed(event.Id)` before
  navigating.
- `const flash = useReturnFlash(event.Id);`
- Make the row container `relative`; when `flash`, add highlight classes
  (`ring-2 ring-primary/60 bg-primary/5`) and render an absolutely-positioned
  arrow at the left edge (`ChevronRight`, `aria-hidden`, `motion-safe:animate-blink`,
  `data-testid="return-flash-indicator"`).

### Modified: `components/events/EventCard.tsx`
- On the Card's `onClick` (and keyboard open), call `markViewed(event.Id)` before
  navigating.
- `const flash = useReturnFlash(event.Id);`
- Add the same highlight ring/tint on the `Card` when `flash`, and the same
  absolutely-positioned blinking arrow with `data-testid="return-flash-indicator"`.
  The `Card` is already the positioned/relative container used for the thumbnail
  overlay, so the arrow anchors to it.

## Testing

Unit:
- `useReturnHighlightStore`: `markViewed` sets the id; `clear` nulls it.
- `useReturnFlash` (fake timers): returns `true` when the stored id matches, then
  `false` after 4000 ms; returns `false` for a non-matching id; consumes the id so
  a second mount with the same id does not flash; a fresh mount with no stored id
  returns `false`.

E2e (`app/tests/features/monitor-detail.feature`, `@web`):
- Open the first recent event, `page.goBack()`, and assert
  `[data-testid="return-flash-indicator"]` is visible on a `compact-event-row`
  after returning. (Timing-sensitive teardown of the flash is covered by the unit
  test; the e2e only asserts it appears on return.)

## Out of scope

- Persisting the highlight across full reloads.
- A screen-reader announcement (the arrow is decorative; scroll restoration
  handles landing position).
- Highlighting on forward navigation or deep-linking into an event.
