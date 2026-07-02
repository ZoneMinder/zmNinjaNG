# Recent-events row detail + event delete (#213)

## Problem

The recent-events list on the monitor detail page (shipped for #213) shows only
cause, time, and score per row. It should also surface the detected objects, the
event id, and a relative time, in compact text. Separately, there is no way to
delete an event from the app; ZoneMinder's own UI has a per-row trash action.
Finally, the recent-events count setting accepts any typed number instead of
being bounded.

## Decisions

- **Cap the recent-events count at 50.** Raise `MONITOR_DETAIL_RECENT_EVENTS.maxCount`
  from 20 to 50. `clampRecentEventsCount` already derives from that constant, so
  the list respects it at read time. Also clamp the settings input `onChange` to
  `[minCount, maxCount]` so a typed 999 stores 50, and set `max={50}` on the input.

- **Compact row content (two-line, detection-first).** `CompactEventRow` renders:
  - Line 1: detected-object icon + detected object names (e.g. "person"), then
    ` · #<eventId>`. When the event has no detected objects, fall back to the
    `Cause` text. Right side: the score badge and the delete button.
  - Line 2: absolute time, then ` · ` and the relative time. The relative time is
    shown only when the event start is within the relative-time window
    (`isWithinDays(startTime, RELATIVE_TIME_LIST_WINDOW_DAYS)`), matching EventCard.
  - All secondary text is small and muted.

- **Shared detection parser.** Extract `parseDetectedObjects(notes: string | null): string[]`
  (currently a private copy in `EventPreviewPopover.tsx`) into `lib/event-detection.ts`
  and reuse it in both `EventPreviewPopover` and `CompactEventRow`.

- **Delete with confirmation, shared between both lists.** A new `EventDeleteButton`
  component: a trash icon that opens the existing `AlertDialog`, with Cancel /
  Delete. Delete calls a new `useDeleteEvent()` hook. The button stops click
  propagation so it does not trigger the row/card navigation. It is always
  visible (touch has no hover). It is placed in both `CompactEventRow` and
  `EventCard`.

- **Delete invalidates the right queries.** `useDeleteEvent()` wraps the existing
  `deleteEvent(id)` API. On success it invalidates `['events']`, `['event', id]`,
  and any query whose key includes `'monitorRecentEvents'` (so the recent list on
  the monitor detail page refreshes), then toasts success. On error it toasts
  failure and logs via `log.eventCard` (or a suitable `log.*` helper) at ERROR.

- **No automated e2e that deletes a real event.** ZM delete is permanent
  server-side. The e2e opens the confirm dialog from the recent list and cancels,
  asserting the event remains. The actual delete path is covered by unit tests
  with the API mocked; a real delete is a manual check.

## Components and data flow

### New: `lib/event-detection.ts`
```
export function parseDetectedObjects(notes: string | null): string[]
```
Same logic as the current private copy in `EventPreviewPopover.tsx`
(`/detected:(.*)/i`, split on `,`, take the part before `|`, trim, drop empties).
`EventPreviewPopover.tsx` is updated to import from here instead of its local copy.

### New: `hooks/useDeleteEvent.ts`
```
export function useDeleteEvent(): {
  deleteEvent: (eventId: string) => Promise<void>;
  isDeleting: boolean;
}
```
Uses `useMutation` (or local `isDeleting` state) calling `deleteEvent` from
`api/events.ts`. On success:
`queryClient.invalidateQueries({ queryKey: ['events'] })`,
`queryClient.invalidateQueries({ queryKey: ['event', eventId] })`,
`queryClient.invalidateQueries({ predicate: q => q.queryKey.includes('monitorRecentEvents') })`,
then `toast.success(t('events.delete_success'))`. On error:
`toast.error(t('events.delete_failed'))` and `log.*(..., LogLevel.ERROR, ...)`.

### New: `components/events/EventDeleteButton.tsx`
Props: `{ eventId: string; eventName: string; monitorName?: string; size?: 'sm' | 'md'; className?: string }`.
Renders a ghost trash icon button (`data-testid="event-delete-button"`) that, on
click (with `e.stopPropagation()`), opens an `AlertDialog`
(`data-testid="event-delete-dialog"`) with:
- Title: `t('events.delete_confirm_title')`
- Description: `t('events.delete_confirm_desc', { id: eventId, monitor: monitorName ?? eventName })`
- Cancel (`data-testid="event-delete-cancel"`, `t('common.cancel')`)
- Delete (`data-testid="event-delete-confirm"`, `t('common.delete')`, destructive styling),
  which calls `useDeleteEvent().deleteEvent(eventId)` and closes the dialog.

### Modified: `components/events/CompactEventRow.tsx`
- Add detected objects (icon via `getObjectClassIconFromList`, text via
  `parseDetectedObjects`), fallback to `Cause`.
- Add ` · #<eventId>`.
- Add relative time on line 2 (guarded by `isWithinDays`).
- Add `<EventDeleteButton eventId={event.Id} eventName={event.Name} monitorName={monitorName} size="sm" />`
  on the right, next to the score badge. Requires passing `monitorName` into the row
  (add it to props; `MonitorRecentEvents` already has the monitor and passes each
  event, so it supplies `monitorName={monitor.Name}`).

### Modified: `components/events/EventCard.tsx`
- Add `<EventDeleteButton eventId={event.Id} eventName={event.Name} monitorName={monitorName} />`
  next to the favorite/archive buttons.

### Modified: `components/settings/PlaybackSection.tsx`
- Clamp the recent-events count `onChange` to `[MONITOR_DETAIL_RECENT_EVENTS.minCount,
  MONITOR_DETAIL_RECENT_EVENTS.maxCount]` before writing; set `max={MONITOR_DETAIL_RECENT_EVENTS.maxCount}`.

### Modified: `lib/zmninja-ng-constants.ts`
- `MONITOR_DETAIL_RECENT_EVENTS.maxCount`: 20 → 50.

## i18n

New keys in the `events` namespace, all 5 locales (en/de/es/fr/zh), short:
- `delete_confirm_title` ("Delete event?")
- `delete_confirm_desc` ("Event #{{id}} ({{monitor}}) will be permanently deleted.")
- `delete_success` ("Event deleted")
- `delete_failed` ("Delete failed")
- `delete_aria` ("Delete event") for the button aria-label/title.

`common.delete` and `common.cancel` already exist; reuse them.

## Testing

Unit:
- `parseDetectedObjects`: detected list parsed, `null`/empty/no-match → `[]`.
- Count clamp: `clampRecentEventsCount(999) === 50` after the max bump; settings
  input onChange stores a clamped value. NOTE: the existing
  `lib/__tests__/monitor-recent-events.test.ts` asserts `999 → 20`; update that
  assertion to `50` in the same change that bumps `maxCount`.
- `useDeleteEvent`: mock `deleteEvent`; assert it is called, the three
  invalidations fire (including the `monitorRecentEvents` predicate), success
  toast on resolve, error toast on reject.
- `EventDeleteButton`: clicking trash opens the dialog; Delete calls the mutation
  with the right id; Cancel closes without calling it; click does not bubble to a
  parent onClick.
- `CompactEventRow`: renders detection text + `#eid` + relative time, falls back
  to Cause when no detection, and renders the delete button.

E2E (`app/tests/features/monitor-detail.feature`):
- From the recent-events list, tap the delete button on the first row, see the
  confirm dialog, tap Cancel, and assert the row is still present (no real delete).

## Out of scope

- Bulk/multi-select delete.
- Undo after delete (ZM delete is permanent server-side).
- Deleting a real event in automated e2e.
