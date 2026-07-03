# Bulk delete events via a floating action bubble (#213)

## Problem

Deleting events is one at a time through a per-event confirm dialog. Clearing
several events is tedious. Let a user queue multiple events for deletion and
confirm them all at once.

## Decisions

- **Trash toggles a batch, not a per-event dialog.** Tapping the trash icon on an
  event adds it to a delete batch (tap again to remove it). The old per-event
  confirm `AlertDialog` is removed; the floating bubble is the confirmation.

- **Queued row look.** A queued event's row gets a red tint/ring
  (`ring-2 ring-destructive/60 bg-destructive/5`) and its trash icon fills solid
  red (`fill-destructive text-destructive`).

- **Floating bubble is the confirm.** A `DeleteBatchBar` floats near the top-center
  while the batch is non-empty, showing "Delete N events" (pluralized), a
  **Cancel** button, and a destructive **Delete** button. Delete removes all
  queued events then clears the batch; Cancel clears it. No second dialog.

- **Batch persists across navigation.** The selection is a session store cleared
  only on Cancel or after a successful Delete, so it survives opening an event and
  returning. To avoid a queue lingering out of sight, the bubble is rendered once
  app-wide (in `AppLayout`), visible on any page while the batch is non-empty.

## Components and data flow

### New: `stores/deleteSelection.ts`
Zustand store (session-only, not persisted to disk):
```
interface DeleteSelectionState {
  selectedIds: string[];
  toggle: (eventId: string) => void;   // add if absent, remove if present
  clear: () => void;
}
```
Selectors used by consumers: `selectedIds` (for count and membership).

### New: `hooks/useBulkDeleteEvents.ts`
```
export function useBulkDeleteEvents(): {
  deleteEvents: (eventIds: string[]) => Promise<void>;
  isDeleting: boolean;
}
```
Deletes each id via the existing `deleteEvent` from `api/events.ts` with
`Promise.allSettled` (one failure does not abort the rest). After settling it
invalidates `['events']`, `['event', <each id>]`, and any query whose key
includes `'monitorRecentEvents'`, then toasts. On all-success:
`toast.success(t('events.delete_selected_success', { count }))`. If some failed:
`toast.error(t('events.delete_failed'))` and `log.eventCard(..., LogLevel.ERROR, { failed })`.

### New: `components/events/DeleteBatchBar.tsx`
Reads `selectedIds` from the store. Returns `null` when empty. Otherwise renders
a fixed, top-center floating bar (`data-testid="delete-batch-bar"`), above app
chrome (`z-50`), respecting the top safe-area inset. Contents:
- Label: `t('events.delete_selected', { count })` (pluralized).
- Cancel button (`data-testid="delete-batch-cancel"`, `t('common.cancel')`) →
  `clear()`.
- Delete button (`data-testid="delete-batch-confirm"`, destructive styling,
  disabled while `isDeleting`) → `useBulkDeleteEvents().deleteEvents(selectedIds)`,
  then `clear()`.

### Modified: `components/layout/AppLayout.tsx`
Render `<DeleteBatchBar />` once inside the layout (a fixed-position element, so
placement in the tree does not matter for layout), so it floats above every page
while the batch is non-empty.

### Modified: `components/events/EventDeleteButton.tsx`
Becomes a batch toggle. Remove the `AlertDialog`, `useDeleteEvent`, and the
`open` dialog state. New behavior:
- `const selected = useDeleteSelectionStore((s) => s.selectedIds.includes(eventId));`
- `const toggle = useDeleteSelectionStore((s) => s.toggle);`
- On click (`e.stopPropagation()`), call `toggle(eventId)`.
- Trash icon: `fill-destructive text-destructive` when `selected`, else the
  current muted/hover-destructive style.
- Keep `data-testid="event-delete-button"`, aria-label, size prop.
- `monitorName`/`eventName` props are no longer needed by the button (the dialog
  used them); drop them and update both call sites.

### Modified: `components/events/CompactEventRow.tsx` and `EventCard.tsx`
Read selection and apply the queued-row highlight:
- `const selected = useDeleteSelectionStore((s) => s.selectedIds.includes(event.Id));`
- When `selected`, add `ring-2 ring-destructive/60 bg-destructive/5` to the
  row/card (via `cn`, alongside the existing return-flash highlight; the two do
  not co-occur in practice, but destructive should win if both apply).

## i18n

New keys in the `events` namespace, all 5 locales, pluralized via i18next:
- `delete_selected_one` ("Delete {{count}} event"), `delete_selected_other`
  ("Delete {{count}} events")
- `delete_selected_success_one` ("Deleted {{count}} event"),
  `delete_selected_success_other` ("Deleted {{count}} events")

Reuse `common.cancel` and the existing `events.delete_failed`. The old
per-event keys (`delete_confirm_title`, `delete_confirm_desc`, `delete_aria`)
are removed; `delete_aria` is replaced by a batch aria-label
`events.delete_toggle_aria` ("Select event for deletion").

## Removed

- The per-event confirm `AlertDialog` in `EventDeleteButton`.
- `useDeleteEvent` (single-event hook) if it has no remaining callers after the
  change. Confirm with a grep; if unused, delete it and its test.
- The existing e2e scenario "Delete confirm dialog on a recent event can be
  cancelled" (asserts `event-delete-dialog` / `event-delete-cancel`) and its
  steps, replaced by the batch-bar cancel scenario.
- The old `EventDeleteButton` dialog tests (open dialog / confirm / cancel),
  rewritten to the toggle behavior.

## Testing

Unit:
- `useDeleteSelectionStore`: `toggle` adds then removes; `clear` empties.
- `useBulkDeleteEvents`: mock `deleteEvent`; asserts each id deleted, the three
  invalidations fire (including the `monitorRecentEvents` predicate), success
  toast with the count; a rejected id yields the failure toast and does not stop
  the others.
- `EventDeleteButton`: click toggles the id in the store; the icon reflects
  selected state; click does not bubble to the row.
- `DeleteBatchBar`: hidden when empty; shows the count when non-empty; Cancel
  clears; Delete calls bulk delete with the selected ids.
- `CompactEventRow`: applies the destructive ring when its event is selected.

E2e (`app/tests/features/monitor-detail.feature`, `@web`):
- Tap the trash on the first two recent events; the batch bar shows a
  "Delete 2 events" label and both rows show the queued highlight; tap **Cancel**
  and assert the bar disappears and the rows return to normal. No real deletion
  in automated e2e (Cancel path).

## Out of scope

- Select-all / range select.
- Undo after a bulk delete (ZM delete is permanent).
- A confirm step on the bubble's Delete (the batch bar is itself the confirm).
