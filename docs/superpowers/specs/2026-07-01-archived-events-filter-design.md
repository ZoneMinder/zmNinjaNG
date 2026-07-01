# Archived-only events filter (#209)

## Problem

Users archive events they want to keep or show someone. There is no way to filter
the events list to only archived events. Issue #209 asks for an "Archived only"
filter, similar to the existing Favorites filter.

## Current state

- The archive mark/unmark action already exists: `EventDetail` has an archive
  toggle (`data-testid="event-detail-archive"`) backed by `setEventArchived` in
  `api/events.ts`. The issue's secondary ask is already met. No action UI work.
- `EventFilters.archived?: boolean` is declared in `api/events.ts` but is not used
  anywhere: the query builder never emits an `Archived` filter segment, and there
  is no filter state or UI for it. This is the gap.
- The Favorites filter is the model to mirror. It is a boolean toggle
  (`favoritesOnly`) in `useEventFilters`, persisted per profile, reflected in a
  URL param, surfaced in `EventsFilterPopover`, and counted in the active-filter
  badge. Favorites are a locally-stored ID set pushed to the server as `Id IN:`.

## Key difference from Favorites

Archived is a real ZoneMinder field (`Event.Archived`, 0 or 1), so it filters
server-side directly as a path segment, no local ID set. It composes with the
other segments (monitor, date, minAlarmFrames) via AND, and with the favorites
`Id IN:` variant and the tags `Tags.Id:` variants (both include the base filter
segments), so "archived AND favorite" and "archived AND tagged" work.

## Changes

### `app/src/api/events.ts` (query builder in `getEvents`)
Add, alongside the other segment builders (after the `cause` block):

```ts
if (filters.archived) {
  addFilterSegment('Archived:1');
}
```

`Archived:1` is ZM's equals form (same `Field:value` shape as `MonitorId:${id}`).
This lands in `filterSegments`, which is included in both the direct path and the
`fetchEventsByVariants` base, so it composes with favorites and tags.

### `app/src/hooks/useEventFilters.ts`
Add `archivedOnly` mirroring `favoritesOnly` everywhere the latter appears:
- state: `const [archivedOnly, _setArchivedOnly] = useState(false);`
- exposed in the hook's return type and object.
- setter `setArchivedOnly` that also calls
  `saveFilterField(profileIdRef.current, 'archivedOnly', enabled)`.
- load from saved profile filters (`_setArchivedOnly(saved.archivedOnly)`).
- URL param `archived`: read on init and on `searchParams` change
  (`archived === 'true'`), write in the params-sync effect
  (`set('archived','true')` / `delete('archived')`).
- include in `clearAllFilters` (`setArchivedOnly(false)` and
  `newParams.delete('archived')`).
- include in the active-filter count memo (`archivedOnly ? 1 : null`) and its
  dependency arrays.

Persistence: `archivedOnly` must be added to the saved-filters type/shape that
`saveFilterField` and the profile filter loader use (the same structure that
holds `favoritesOnly`). Follow that type so a stored value round-trips.

### `app/src/components/events/EventsFilterPopover.tsx`
Add props `archivedOnly: boolean` and `onArchivedOnlyChange: (v: boolean) => void`
(mirroring the favorites props). Render an "Archived only" toggle row directly
below the Favorites row, same `Label` + `Switch` structure, with
`id="archived-only"`, `data-testid="events-archived-toggle"`, and label
`t('events.archived_only')`.

### `app/src/pages/Events.tsx`
- Pull `archivedOnly` (and `setArchivedOnly`) from `useEventFilters()`.
- Add `archived: archivedOnly` to the `serverFilters` object (it flows straight
  into `EventFilters.archived`).
- Pass `archivedOnly` / `onArchivedOnlyChange={setArchivedOnly}` to
  `EventsFilterPopover`.

### i18n: `app/src/locales/{en,de,es,fr,zh}/translation.json`
Add `events.archived_only` next to `events.favorites_only`. Suggested values:
- en: "Archived only"
- de: "Nur archivierte"
- es: "Solo archivados"
- fr: "Archivés seulement"
- zh: "仅已存档"

## Testing

**Unit - `app/src/api/__tests__/events.test.ts`** (or the existing events API
test file; confirm the name):
- `getEvents({ archived: true })` issues a request whose URL contains the
  `Archived:1` segment (encoded). Mock the API client and assert the URL.
- `getEvents({ archived: true, monitorId: '3' })` includes both `MonitorId:3`
  and `Archived:1` segments (composition).
- `getEvents({})` (or `archived: false`) does not add an `Archived` segment.

**Unit - `useEventFilters` test** (if one exists; otherwise add focused coverage):
- toggling `archivedOnly` sets the `archived=true` URL param and persists via
  `saveFilterField`; clearing removes it. Mirror any existing `favoritesOnly`
  test.

**E2E - events feature**: open the filter popover, toggle "Archived only"
(`events-archived-toggle`), apply, and assert the list updates. Use the
conditional pattern since the test server may have no archived events (assert the
toggle reflects on and the request carries the filter, rather than asserting a
nonzero result).

## Docs

- Developer guide: note `EventFilters.archived` is now wired to the `Archived:1`
  segment and composes with other filters.
- User guide (events / filters section): "Archived only" shows just archived
  events, and events are archived from the event detail screen.

## Out of scope

- The archive action itself (already implemented on `EventDetail`).
- A card-level archive button in the list (not requested).
- Three-state filtering (all / archived / unarchived); this is a simple on/off
  like Favorites.
