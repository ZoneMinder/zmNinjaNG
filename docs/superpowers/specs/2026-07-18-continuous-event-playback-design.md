# Continuous event playback (#250)

## Problem

The legacy zmNinja app had an on-screen toggle to play events back-to-back. A user
scanning camera events for something specific could click one event and let the app
advance through the rest without manual clicking. zmNinjaNg has prev/next buttons on
the event detail page but no auto-advance. Issue #250 requests the continuous mode back.

## Behavior

- A toggle on the event detail page turns continuous playback on or off.
- When on, reaching the end of a video automatically advances to the next event.
- "Next" means the newer event by `StartDateTime`, honoring the same filters as the
  prev/next buttons. This matches the issue example (10th-oldest → 9th → …).
- Advancing uses the existing slide animation: the new video enters from the right as
  the old one leaves to the left.
- When there is no next event, a toast says "No more videos to play" and playback stops
  on the current event.
- The toggle setting persists per profile: once enabled it stays enabled for future use.
- Playback speed is honored across the run. A single speed multiplier drives both the
  MP4 and the ZMS/JPEG player, persists per profile, and is reused for every video in a
  continuous run.

## What already exists (reused, not rebuilt)

- Filter-aware next/prev navigation: `getAdjacentEvent('next' | 'prev', …)` in
  `app/src/api/events.ts` and the `useEventNavigation` hook. Filters are threaded through
  React Router state from the Events page. Continuous play adds no filter logic.
- Slide animation: `.event-slide-left` / `.event-slide-right` in `app/src/index.css`,
  driven by `location.state.slideDirection`. `goToNextEvent` already navigates with
  direction `'left'` (new content enters from the right).
- Completion detection: `ZmsEventPlayer` already pauses and marks the event finished when
  the stream fraction reaches `>= 0.99`. `Mp4EventPlayer` (video.js) fires a native
  `ended` event.
- Profile-scoped persisted settings: the `eventVideoAutoplay` pattern in
  `stores/settings.ts` (`getProfileSettings` / `updateProfileSettings`).

## New pieces

### 1. Settings and constants

`app/src/stores/settings.ts` — add to `ProfileSettings`, `DEFAULT_SETTINGS`:

- `eventContinuousPlay: boolean` — default `false`.
- `eventPlaybackRate: number` — default `1`. Speed multiplier honored by both players.

`app/src/lib/zmninja-ng-constants.ts` (rule 25):

- `EVENT_PLAYBACK_RATES = [0.25, 0.5, 1, 2, 4]` — shared preset list.
- `DEFAULT_EVENT_PLAYBACK_RATE = 1`.

The persisted rate is the single source of truth. The MP4 speed menu uses it directly.
ZMS converts to its percentage convention (`rate × 100`).

### 2. Toggle button

`app/src/pages/EventDetail.tsx` header, between the "All Events" and "Archive" buttons:

- `ListVideo` icon from lucide-react.
- Button `variant` reflects on (`default`) / off (`outline`).
- `data-testid="event-detail-continuous-play"`.
- i18n label and tooltip.
- onClick: `updateProfileSettings(profileId, { eventContinuousPlay: !settings.eventContinuousPlay })`.

### 3. `onEnded` wiring

`Mp4EventPlayer` (`app/src/components/events/Mp4EventPlayer.tsx`):

- Add `onEnded?: () => void` prop; wire `player.on('ended', …)` calling the latest value
  via a ref (same pattern as the existing `onError` / `onReady` refs).
- Enable video.js built-in speed menu: `playbackRates: EVENT_PLAYBACK_RATES` in the player
  config. This renders a rate menu button in the control bar (no custom UI).
- Apply the persisted rate on init and whenever `src` changes (video.js resets
  `playbackRate` to `defaultPlaybackRate` on `src()`), inside the existing update effect.
- Persist on `ratechange`: write the new multiplier back through `updateProfileSettings`.
  The rate is passed in as a prop so `EventDetail` owns the persistence call.

`ZmsEventPlayer` (`app/src/components/events/ZmsEventPlayer.tsx`):

- Add `onEnded?: () => void` prop; fire it where completion is already detected
  (`fraction >= 0.99`), guarded so it fires once per event.
- Initialize the local `playbackSpeed` state from `eventPlaybackRate × 100`.
- On `changeSpeed`, write the multiplier back through the parent so ZMS speed persists too.
- Speed presets derive from `EVENT_PLAYBACK_RATES`.

### 4. Auto-advance

`useEventNavigation` (`app/src/hooks/useEventNavigation.ts`):

- `goToNextEvent` returns `Promise<boolean>`: `true` if it navigated to a next event,
  `false` if `getAdjacentEvent` returned nothing.

`EventDetail`:

- `handleVideoEnded` passed as `onEnded` to both players.
- If `settings.eventContinuousPlay`: `const advanced = await goToNextEvent();`
  if `!advanced`, `toast(t('event_detail.no_more_videos'))`.
- A ref guard prevents a second advance firing during navigation/teardown.
- Continuous play implies autoplay: player `autoplay = eventVideoAutoplay || eventContinuousPlay`.

### 5. i18n

All five locales (en, de, es, fr, zh), concise per rule 22:

- `event_detail.continuous_play` — toggle label / tooltip.
- `event_detail.no_more_videos` — end-of-list toast.
- `event_detail.playback_speed` already exists (ZMS reuses it).

## Testing

### Unit

- `stores/settings` defaults include `eventContinuousPlay: false`, `eventPlaybackRate: 1`.
- `useEventNavigation.goToNextEvent` resolves `true` when `getAdjacentEvent` yields an
  event and `false` when it yields `null` (mock the api).
- `Mp4EventPlayer` applies the rate prop to the player and fires `onEnded` on the video.js
  `ended` event. Extend the existing player test and its video.js mock.
- `EventDetail` end handler: with continuous play on and `goToNextEvent` resolving `false`,
  the "no more videos" toast is shown; with it resolving `true`, no toast.

### E2e

`app/tests/features/continuous-playback.feature`:

- The continuous-play toggle is visible on the event detail page.
- Enabling it and reloading leaves it enabled (persistence is a real, reliable outcome).

The end-of-video → advance transition is asserted at unit/component level (invoke the
ended handler, assert navigation), because driving a real MP4 to its natural end in a
headless browser is slow and flaky. The feature file notes this so a later reader does not
mistake the gap for missing coverage.

## Docs

- `docs/user-guide/events.md` Video Player section: document the continuous-play toggle,
  the persistence, and the speed control.
- `docs/developer-guide/`: if `call-flows.rst` has an event prev/next trace, extend it with
  the auto-advance step (rule 4). Otherwise add the `onEnded` / `goToNextEvent` return
  change to the hook's chapter, connected to the user-visible auto-advance behavior
  (rule 37).

## Out of scope

- Spacebar-to-pause keyboard shortcut (issue #250 "bonus"). Filed as a separate follow-up
  issue.

## Verification

Per AGENTS.md: `npm test`, `npx tsc -b`, `npm run build`, and
`npm run test:e2e -- continuous-playback.feature`. UI change requires `data-testid` on the
toggle, e2e coverage, and all five locale files updated. No native plugin change, so no
device pass is required for the core feature (video.js speed menu and toggle are web paths).
