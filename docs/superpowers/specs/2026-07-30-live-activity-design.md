# Live Activity page

A dedicated page that shows only the monitors currently in alarm, as live
montage tiles. A monitor appears when ZoneMinder reports it alarmed and
disappears a short while after the alarm clears.

## Why not the notification stream

The obvious source is the notification pipeline the app already runs, and it is
the wrong one. It reports alarm starts and never alarm ends, so it cannot tell
this page when to remove a tile. Beyond that:

- It is off by default (`DEFAULT_SETTINGS.enabled = false`,
  `stores/notifications.ts:120`) and auto-connect bails when disabled
  (`hooks/useNotificationAutoConnect.ts:85`). A page driven by it would show
  nothing for any user who never configured notifications.
- Each delivery path has a gap. ES mode needs zmeventnotification running.
  Direct mode polls with `limit: 5` globally across all monitors
  (`services/eventPoller.ts:140`), so one busy camera starves the rest. Direct
  mode on native mobile has no in-app poller at all, only FCM
  (`hooks/useNotificationAutoConnect.ts:104`).
- The stream is already narrowed by notification preferences: `allMonitors`,
  `monitorFilters`, `onlyDetectedEvents`. A monitor muted so a phone stops
  buzzing overnight would silently vanish from the live wall. Those are
  different intents and should not share a filter.
- `receivedAt` is local delivery time (`stores/notifications.ts:342`), not the
  time motion happened. A backgrounded app produces an arrival burst whose
  order does not match reality.
- The poller deliberately emits nothing on its first pass
  (`services/eventPoller.ts:151-160`), so a freshly opened app would report no
  activity anywhere until the next alarm lands.

The stream is still useful as an accelerant. See "Data sources" below.

## Data sources

**Truth: per-monitor alarm status.** Most of this already exists.
`getAlarmStatus(monitorId)` (`api/monitors.ts:244`) calls
`/monitors/alarm/id:{id}/command:status.json`; `queryKeys.monitorAlarmStatus`
is already defined; and `BANDWIDTH_SETTINGS` already carries an
`alarmStatusInterval` (5s normal, 10s low). `useAlarmControl`
(`pages/hooks/useAlarmControl.ts`) already polls that endpoint for a single
monitor and parses its response, including the fallback between the `status`
and `output` fields that ZoneMinder varies between versions. This page needs a
fanout across monitors and a state classification on top, not new plumbing.

The response reports the live alarm state
and therefore gives both entry and exit, which is the whole requirement. It is
also immune to recording-mode confusion: a `Mocord` monitor always has an open
event, so an events-based query would show it permanently active, and a
`Nodect` monitor alarms without writing an event at all, so it would never
appear.

A new `useAlarmStates(monitorIds)` hook fans one query per monitor through
`useQueries`. That is the same shape `useMonitorNewEvents` chose deliberately,
for the reason documented in its header: ZoneMinder ORs repeated `MonitorId`
segments, so a single combined query starves all but the busiest monitor.

The fanout runs only while the route is mounted and the document is visible.
There is no background cost when the user is elsewhere in the app.

**Accelerant: the websocket.** When the notification store receives an alarm
event for a monitor, that monitor is marked active immediately rather than
waiting for the next poll tick. The next poll confirms or clears it. This is
the same two-source split `MontageMonitor` already runs for its badge and pulse
(`components/monitors/MontageMonitor.tsx:105-135`). When notifications are off,
the page still works; it is just as fresh as the poll interval.

**Assumptions to confirm against a live server.** These are written as
assumptions rather than guesses, and the implementation verifies them before
the parse function is finalized:

1. The exact values `command:status.json` returns in
   `AlarmStatusResponse.status`. The type is a string, and the error path uses
   the literal `'false'` (`api/monitors.ts:204`). ZoneMinder's internal states
   are 0 IDLE, 1 PREALARM, 2 ALARM, 3 ALERT, 4 TAPE.
2. Whether ALERT (3) counts as active. Assumed yes: it is the post-alarm state
   and treating it as active smooths the tail. PREALARM (1) and TAPE (4) are
   assumed not active. Note that `useAlarmControl` currently disagrees about
   TAPE, giving states 3 and 4 the same red ring. That code answers a different
   question (is this monitor force-armed) so it is not necessarily wrong, but
   the two readings should be reconciled once the real values are known.
3. Whether monitors already excluded per profile
   (`lib/profile/profile-settings.ts:45`) are dropped by `getMonitors()` or
   only at the events API boundary. If only the latter, this page applies the
   exclusion explicitly.

## Churn control

Every tile that enters or leaves mounts or unmounts a `MontageMonitor`, which
means `useStreamLifecycle` mints a connection key on mount and sends CMD_QUIT
on unmount (`hooks/useStreamLifecycle.ts:148`). A monitor that flickers in and
out therefore thrashes `nph-zms` processes on the server. Damping is not
cosmetic here; it protects the server.

Four distinct failure modes, four rules, all implemented in one pure reducer:

**Flicker.** An alarm ends and restarts seconds later. A monitor leaves the
list only after `LIVE_ACTIVITY.dwellMs` of *continuous* idle. Any re-alarm
resets the timer.

**Reflow under the finger.** A new alarm inserted at the top pushes tiles down
while the user is tapping one. Order is first-entered ascending; new entries
append. The list is never re-sorted while it is non-empty.

**The chatty camera.** A road-facing monitor that alarms every ten seconds
holds one stable slot rather than churning, because dwell keeps it resident. It
shows a count that increments instead of re-running the entry animation.

**Alarm storm.** Rain, headlights, or an IR cutover fires everything at once,
at which point "show only active" degenerates into "show all". The list caps at
`LIVE_ACTIVITY.maxTiles` and the remainder collapses to a "+N more active" row.
This is deliberate and visible rather than a silent truncation.

The reducer is a pure function of `(alarmStates, previousList, now)`, so all of
the above is unit-testable without React.

## Components

**Route.** `/live-activity`, lazily imported in `App.tsx` alongside its
siblings, with a sidebar entry.

Because this is a page the user navigates to, the alarm is invisible until they
go there. The sidebar entry therefore carries a count badge sourced from the
notification store when the websocket happens to be connected. That costs
nothing extra and is simply absent when notifications are off. No polling is
added for the badge.

**Tiles.** `MontageMonitor` is reused unchanged except for one new optional
prop overriding the header label. Reusing it inherits `LiveMonitorPlayer`,
the events button and badge, the snapshot download, the kebab menu, and the
whole `useStreamLifecycle` connection-key and CMD_QUIT lifecycle including its
profile-switch teardown registration (`lib/monitor/active-streams.ts`). None of
that is rewritten.

The label reads `Front Door(3):Alarmed`, from a locale key
`live_activity.tile_title` of the form `{{name}}({{id}}):{{state}}`, with
`state_alarm`, `state_alert`, and `state_cooling` as separate keys. All five
locales are updated together.

While a monitor is in its dwell window after the alarm cleared, the tile dims
and its state reads as cooling, so the user watches it wind down instead of
having it vanish mid-glance.

**Grid.** `useEventMontageGrid` with `EventMontageGridControls`, the same
column-count grid the Monitors and Events pages use. Not `useMontageGrid`:
that one persists drag positions keyed by monitor id, which is meaningless for
a set that changes every few seconds.

**Query states.** `EmptyState` for the quiet case, "All quiet, N monitors
watching", which is the *common* state and must not read as a failure.
`ErrorBanner` with `resolveQueryError` for errors, and the shared query-state
skeleton for loading.

## Settings

A gear button in the page toolbar opens a dialog. All values are profile-scoped
through `getProfileSettings` / `updateProfileSettings`, with defaults declared
in `mergeProfileSettings` (`stores/settings.ts:391`). Because that function
spreads `DEFAULT_SETTINGS` first, existing profiles pick up the new keys
without a `SETTINGS_VERSION` bump.

| Setting | Purpose |
|---|---|
| Poll interval | How often alarm status is fetched |
| Ignored monitors | Monitors that never appear on this page |
| Linger after alarm clears | The dwell window |
| Maximum tiles | Where the overflow row starts |

**Poll interval and the Polling contract.** `AGENTS.project.md` states that
polling owns every recurring interval and that users tune bandwidth globally, so
a per-page interval knob looks like a contract violation. The existing
resolution is `resolvePollIntervalMs` (`stores/notifications.ts:684`): a user
value is accepted, but in low-bandwidth mode it is clamped up to the bandwidth
floor, so bandwidth stays authoritative. This page copies that pattern. Rather
than write a second copy, `resolvePollIntervalMs` is generalized to take the
bandwidth key it should floor against, since today it hardcodes
`eventPollerInterval`. The floor here is the existing `alarmStatusInterval`.

**Ignored monitors** is deliberately separate from the existing per-profile
monitor exclusion (`lib/profile/profile-settings.ts`). That one hides a monitor
everywhere; this one only stops it from pulling focus on this page. Global
exclusions still apply on top. The picker follows the shape of
`components/notifications/MonitorFilterSection.tsx`, reusing that component if
its props allow and copying its layout if they do not.

**Deferred:** a sensitivity control for whether ALERT counts as active. It only
makes sense as a user choice if ALERT turns out to mean something users would
reasonably disagree about, and that is not known until assumption 2 above is
verified. Verify first, hardcode the right answer, and add the control only if
the answer is genuinely a preference.

## Testing

Tests are written before the implementation, per P2.

Unit tests on the dwell reducer, which is where all the interesting logic
lives: a monitor enters on first active state; it stays through an idle gap
shorter than the dwell window; it leaves after the window elapses; a re-alarm
inside the window resets the timer; ordering stays stable when a new monitor
joins; the cap produces the right overflow count. Assertions are on the
resulting monitor list, not on element presence (C6).

Unit tests on the alarm-status parse, once the real response values are known.

An outcome-based e2e feature, `live-activity.feature`, with platform tags and
`data-testid` on tiles, the overflow row, the gear, and the empty state.

The contract gates in `app/src/tests/agents-contracts.test.ts` already cover
locale parity, the absence of literal poll intervals, and inline query keys.

## Implementation order

1. Open an issue (P1) and branch from it.
2. Verify the three server assumptions against a live ZoneMinder.
3. Extract the alarm-state parse out of `useAlarmControl` into a shared pure
   function, with tests, leaving that hook's behavior unchanged.
4. The dwell reducer plus its tests. This is the core.
5. `useAlarmStates` fanout hook.
6. Settings keys and defaults; generalize `resolvePollIntervalMs`.
7. The page, reusing `MontageMonitor` and `useEventMontageGrid`.
8. The gear dialog.
9. Locale keys across all five locales; sidebar entry and badge.
10. e2e feature, user docs, call-flow doc entry (P10).
