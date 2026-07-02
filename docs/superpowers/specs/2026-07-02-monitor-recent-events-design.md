# Recent events list on monitor detail (#213)

## Problem

The monitor detail view shows only the live feed. To see recent events for that
monitor a user must leave the screen via an events/history button that jumps to
the Events page. There is no at-a-glance view of what just happened on the
monitor being watched. ZoneMinder's own web UI answers this with a dense
multi-column table, which does not fit a phone.

## Goal

Below the live view, show a compact list of the last X events for the current
monitor with thumbnails, auto-refreshing on an interval, with a single entry
point to the full Events page filtered to this monitor.

## Decisions

- **Layout: vertical compact rows.** Each row is a small thumbnail + cause/name +
  time + score badge. Tapping a row opens the event detail (`/events/<eventId>`),
  matching `EventCard` behavior. A new lightweight `CompactEventRow` reuses
  `EventThumbnail`; the full `EventCard` (favorite/archive/tags/full stats) is not
  used here to keep the list dense.

- **Section header always rendered.** A thin header row sits directly below the
  video controls bar and holds: the "Recent Events" title, a manual refresh icon,
  a collapse/expand chevron, and an "All events →" link. The header renders
  whether or not the body is expanded, so "All events" and the expand toggle stay
  reachable when the list is collapsed/hidden for that monitor.

- **Single entry point.** The two existing events buttons in `MonitorDetail.tsx`
  (the header button and the controls-bar button) are removed. The section
  header's "All events →" is the only navigation into the filtered Events page
  (`/events?monitorId=<id>`). It always works, including when the recent-events
  body is hidden for that monitor.

- **Configurable count X.** New profile setting `monitorDetailRecentEventsCount`,
  default 5, clamped to `[1, 20]`. A numeric input plus quick-pick buttons in the
  settings UI following the `PlaybackSection` pattern.

- **Auto-refresh Y via bandwidth settings.** New `BandwidthSettings` property
  `monitorRecentEventsInterval`: 30s normal, 60s low. Per rule 8 the list must not
  hardcode a polling interval.

- **Manual refresh.** A refresh icon in the header calls the query's `refetch()`
  on demand, showing a brief spinning state while fetching. Shown/enabled only
  when the list is expanded.

- **Hideable per monitor.** Persisted as a set of hidden monitor IDs in profile
  settings (`monitorDetailRecentEventsHidden: string[]`), default empty (shown for
  all monitors). Collapsing hides the body and disables the query
  (`enabled: !hidden`), so no events request and no refresh fire while hidden.

## Components and data flow

### New component: `MonitorRecentEvents`

Location: `app/src/components/monitors/MonitorRecentEvents.tsx` (new). Props:
`monitorId: string`, `monitorName: string`.

Responsibilities:

- Read `monitorDetailRecentEventsCount` and `monitorDetailRecentEventsHidden` from
  `getProfileSettings`. Derive `hidden = hiddenList.includes(monitorId)`.
- Read `monitorRecentEventsInterval` from `useBandwidthSettings()`.
- Fetch via `useQuery`:
  - key: `[profileId, 'monitorRecentEvents', monitorId, count]`
  - fn: `getEvents({ monitorId, limit: count, sort: 'StartTime', direction: 'desc' })`
  - `enabled: !hidden`
  - `refetchInterval: hidden ? false : monitorRecentEventsInterval * 1000`
- Render the always-visible header (title, refresh, chevron, "All events →").
- When expanded: render body states — loading skeleton rows, error inline
  message, empty ("No recent events"), or the list of `CompactEventRow`.
- Toggle collapse: add/remove `monitorId` from `monitorDetailRecentEventsHidden`
  via `updateProfileSettings`.

### New component: `CompactEventRow`

Location: `app/src/components/events/CompactEventRow.tsx` (new). Props: the event
object, `monitorName`. Renders `EventThumbnail` + cause/name + time (via
`useDateTimeFormat`) + score badge. `onClick` navigates to `/events/<eventId>`
(same state shape `EventCard` passes). `data-testid="compact-event-row"`.

### Integration in `MonitorDetail.tsx`

- Insert `<MonitorRecentEvents monitorId={...} monitorName={...} />` between the
  video controls bar (ends ~line 489) and the PTZ controls section (~line 491).
- Remove the header events button (~lines 294-299) and the controls-bar events
  button (~lines 454-463).

## Settings changes

`app/src/stores/settings.ts`:
- Add `monitorDetailRecentEventsCount: number` to `ProfileSettings`; default `5`
  in `DEFAULT_SETTINGS`.
- Add `monitorDetailRecentEventsHidden: string[]` to `ProfileSettings`; default
  `[]` in `DEFAULT_SETTINGS`.

`app/src/lib/zmninja-ng-constants.ts`:
- Add `MONITOR_DETAIL_RECENT_EVENTS = { defaultCount: 5, minCount: 1, maxCount: 20 } as const`.
- Add `monitorRecentEventsInterval` to the `BandwidthSettings` interface and to
  both `normal` (30) and `low` (60) objects in `BANDWIDTH_SETTINGS`.

Settings UI: add a numeric input + quick-pick (e.g. 3 / 5 / 10) for the event
count, in the section that already covers monitor detail / playback options,
following `PlaybackSection.tsx`. `data-testid="settings-monitor-recent-events-count"`.

## i18n

New keys across en/de/es/fr/zh, short labels:
- `monitor_detail.recent_events` ("Recent Events")
- `monitor_detail.all_events` ("All events")
- `monitor_detail.no_recent_events` ("No recent events")
- `monitor_detail.refresh_events` (refresh icon tooltip)
- `settings.monitor_recent_events_count` (+ `_desc`)

## Testing

Unit:
- Count clamping to `[1, 20]`.
- `hidden` derivation from `monitorDetailRecentEventsHidden` and that toggling
  adds/removes the monitor ID.
- Query `enabled`/`refetchInterval` are false/off when hidden.

E2E (`app/tests/features/`):
- Recent events list renders under the live view with real event data.
- Tapping a row navigates to the event detail.
- "All events →" navigates to the Events page filtered to the monitor, including
  when the body is hidden for that monitor.
- Collapse toggle hides the body and persists across a page refresh.
- Manual refresh reloads the list.

Platform tags: `@all` for the core scenario, phone tags for layout.

## Out of scope

- Favorite/archive/tags actions inside the compact list (use the full Events page).
- Per-monitor override of the count (count is a single global profile setting).
