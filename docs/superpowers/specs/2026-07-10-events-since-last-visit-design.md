# Events since last visit (refs #239)

The badge on each monitor card's Events button counts events from the last 7 days. The window is invisible, not configurable, and the number never responds to anything the user does. Replace it with a count of events recorded since the user last looked at that monitor.

## Behavior

The badge shows how many events a monitor has recorded since the user last looked at that monitor's events. No badge when the count is zero.

Four rules define it:

1. **The watermark is per monitor.** Looking at one camera's events does not clear another's.
2. **Two actions clear it.** Clicking a card's Events button, and opening the monitor's detail page when the recent-events list is actually rendered. The list can be collapsed per monitor (`monitorDetailRecentEventsHidden`), and opening the page for the live stream alone must not mark events seen.
3. **First sight seeds, it does not alarm.** A monitor with no stored watermark records the current newest event and shows no badge. A fresh install does not greet the user with a week of backlog. This matches `eventPoller`'s `isFirstPoll` seeding and `MontageMonitor`'s `lastSeenRef`.
4. **The watermark is a server `StartDateTime`, never a local `Date.now()`.** Clock skew between the app and the ZoneMinder server would otherwise hide or duplicate events.

Display caps at `99+`, matching `MontageMonitor`. The underlying count stays exact.

## Data model

New store, `stores/monitorSeen.ts`, following the `stores/developerNotices.ts` persist pattern:

```ts
profileWatermarks: Record<string, Record<string, string | null>>
```

Profile ID to monitor ID to the `StartDateTime` of the newest event the user had seen.

The absent-versus-null distinction carries meaning:

| State | Meaning | Count query |
|---|---|---|
| key absent | never seeded | seed on first response, show no badge |
| value `null` | seeded when the monitor had no events at all | unfiltered: every event is new |
| value string | seeded or cleared at that event | `StartDateTime >:<value>` |

A monitor that has never recorded an event seeds to `null`. When its first event arrives, the unfiltered count returns 1 and the badge appears, which is correct: the user has never seen it.

Storage key `STORAGE_KEYS.monitorSeenStore = 'zmng-monitor-seen'`. Actions `seed`, `markSeen`, and a `getWatermark` selector. State changes only through actions (rule 30); subscriptions use field selectors (rule 30).

## Fetching

One function in `api/events.ts`:

```ts
getMonitorEventsSince(monitorId: string, since: string | null)
  : Promise<{ count: number; newest: string | null }>
```

Requests `/events/index/MonitorId:<id>[/StartDateTime >:<since>].json` with `limit=1&sort=StartDateTime&direction=desc`.

Sorting descending and taking one row makes a single request yield both values: `count` from `pagination.count`, and `newest` from `events[0].Event.StartDateTime`. That is what lets clearing stamp the watermark without issuing a request of its own, since the newest timestamp is already in the query cache when the user clicks.

`getEvents` cannot be reused. It hardcodes `params.limit = 100` per page and loops until it satisfies the caller's limit, so asking it for one event still transfers a hundred.

### Verified against a live server

The strict `>` operator was the one unknown, since the existing builder only ever emits `>=` and ZoneMinder's filter operators have surprised us before. Checked directly against ZM 1.39.1 (API 2.0), `api/events/index/MonitorId:1/...`:

| Filter | `pagination.count` |
|---|---|
| `StartDateTime >=:<newest>` | 1 (counts the watermark event itself) |
| `StartDateTime >:<newest>` | 0 |
| `StartDateTime >:<older ts>` | 31, one event returned, newest present |
| `StartDateTime >:2099-01-01 00:00:00` | 0, empty events array |

`>` parses and excludes the boundary. `>=` would have counted the watermark event as new forever.

### Query wiring

`pages/Monitors.tsx` drives one query per monitor through `useQueries`, keyed `queryKeys.monitorEventsSince(profileId, monitorId, watermark)` (rule 29). Including the watermark in the key means a monitor whose watermark has not moved serves from cache, and clearing the badge invalidates precisely one monitor's entry.

New `BandwidthSettings.monitorNewEventsInterval`: 60000 normal, 120000 low (rule 8).

Cost is one request per monitor per interval, against one request total today. Accepted deliberately. The alternative, a single OR'd query counted client side, starves: repeated `MonitorId:` segments are OR'd by ZM, so one busy camera consumes the entire page limit and every other monitor silently reads zero. A counter that lies when one camera gets busy is worse than N small requests.

## Clearing

`markSeen(profileId, monitorId, newest)` fires from exactly two places, both reading `newest` from the cached query:

- `components/monitors/MonitorCard.tsx`, in the Events button `onClick`, before `navigate`.
- `components/monitors/MonitorRecentEvents.tsx`, in an effect gated on `!hidden && !isLoading && events.length > 0`. The component already destructures `hidden` from `useMonitorRecentEvents`, so "the list was on screen" is a field read, not a DOM query.

A monitor whose count is zero has nothing to stamp; `markSeen` with a `null` newest is a no-op.

## Removals

`getConsoleEvents` loses its only caller. Deleted along with everything that exists solely to serve it (rule 12):

- `api/events.ts` `getConsoleEvents`
- `api/types.ts` `ConsoleEventsResponseSchema`
- `lib/query/query-keys.ts` `consoleEvents`, `consoleEventsList`
- `lib/zmninja-ng-constants.ts` `BandwidthSettings.consoleEventsInterval` and both mode objects
- `api/__tests__/events.test.ts` the two `getConsoleEvents` tests

`components/settings/HiddenMonitorsSection.tsx:65` repoints its invalidation from `queryKeys.consoleEvents` to the new key.

This lands as its own `chore:` commit after the feature works, not mixed into it (rule 20).

## Testing

Unit:

- `stores/__tests__/monitorSeen.test.ts`: seeding an absent key, the `null` versus string distinction, `markSeen` overwriting, per-profile isolation (no cross-profile leak).
- `api/__tests__/events.test.ts`: `getMonitorEventsSince` builds the `>` segment, extracts count and newest, handles the `since: null` path and the empty-events response.
- `pages/__tests__` or a hook test: a monitor with an absent watermark renders no badge on first response and seeds.

E2e, `tests/features/monitors.feature`:

```gherkin
@all
Scenario: Opening a monitor's events clears its new-event badge
  Given I am logged into zmNinjaNg
  And I know the event counts from the API
  When I navigate to the "Monitors" page
  And I open the first monitor's events
  And I navigate to the "Monitors" page
  Then the first monitor should have no new-event badge
  And a monitor I did not open should keep its badge
```

The guard comes from `getEventCount()` in `tests/helpers/zm-api.ts`, not from the badge's own visibility (rule 34). Events cannot be created on demand, so "the badge appears when a new event arrives" is unit-tested rather than e2e.

`data-testid="monitor-new-events-badge"`.

## i18n

The badge renders a number, but its `aria-label` needs all five languages: `monitors.new_events_count` = "{{count}} new events". Keep it short (rule 22); it is assistive text, not a visible label.

## Documentation

The badge is a user journey with a counterintuitive core, so it earns a trace (rule 37):

- `call-flows.rst`: a new flow, "Seeing what happened while you were away". The pivotal moment is that one query answers two questions, which is why clearing costs no request. States the negative: an absent watermark seeds silently rather than showing backlog.
- `05-component-architecture.rst`: the `MonitorCard` badge.
- `07-api-and-data-fetching.rst`: `getMonitorEventsSince`, including the `>` versus `>=` finding.
- `12-shared-services-and-components.rst`: `stores/monitorSeen.ts`.

## Out of scope

- No user setting for the window. The window is "since you last looked"; there is nothing to configure.
- No badge on the Montage view. `MontageMonitor` has its own notification-derived count with different semantics.
- No cross-device sync of watermarks. Storage is local, like every other persisted store here. Looking at events on your phone will not clear the badge on your desktop.
