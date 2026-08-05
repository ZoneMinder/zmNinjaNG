# All Profiles — Phase 3 (aggregated Events/Timeline, /all routes, notifications) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All mode gains merged Events and Timeline, deep `/all/` routes that carry the owning profile (replacing switch-then-navigate), working new-event badges, and direct notification taps.

**Architecture:** Spec `docs/superpowers/specs/2026-08-02-all-profiles-design.md` sections 5-6 + UX spec + Phase 3 step list. Branch `feat/all-profiles-ui` continues (PR #339 grows; base #338). Phase 2's final review produced a watch-list; its items are folded into the tasks below and cited as (W1..W8).

**Tech Stack:** unchanged (React 18/TS, React Query v5, vitest, playwright-bdd).

## Global Constraints

Same as Phase 2's plan (TDD; gates per commit; full gates+e2e before push; 5 locales together; kebab data-testids; contracts bind — Sessions, Polling, Query UI states, Server queries, Stores, Localization, Date-time via useDateTimeFormat/formatAppDate only; never stage build.gradle/pbxproj; no --no-verify; reports via SendMessage). e2e: one real server from .env; two same-server profiles + unreachable third for failure cases.

Phase 2 facts the implementers need: `useProfileScope`/`useScopedMonitors` exist; server map is per-profile (`getServerMap(profileId)`, populated at bootstrap, empty map = safe fallback to profile URLs); `reLoginFor(id)` self-registers reLogin callbacks at getSession-time; aggregate queries enable without auth gating (client self-heals); `monitorSeen` is already (profileId, monitorId)-keyed; portal-url helpers take optional profileId defaulting to current.

## Task 1: Per-profile media plumbing (W4 + leftovers)

**Files:** `components/ui/secure-image.tsx` (profileId prop → `getSession(profileId).client` fallback current), `lib/event/thumbnail-chain.ts` (+ its callers as compiler ripples), `components/monitors/MonitorHoverPreview.tsx` (profileId prop, mirrors LiveMonitorPlayer), `stores/monitors.ts` connKeys + `LiveMonitorPlayer` go2rtcFailureCache keyed `${profileId}:${monitorId}` (W7). Tests beside each.
- [ ] Failing tests: secure-image fetches via profile B's client when given B's id; thumbnail chain builds B's portal URL; cache keys distinct for same monitorId across profiles.
- [ ] Implement (optional params default current; zero single-mode change); vitest touched dirs + build; commit `feat: per-profile media and cache keys (refs #337)`.

## Task 2: `useScopedEvents`

**Files:** create `hooks/useScopedEvents.ts`; test alongside. Mirror `useScopedMonitors` exactly: useQueries over scope.profiles, existing `queryKeys.eventsList(p.id, ...)`-compatible keys (REUSE the existing key factory shapes — read `useEventFilters`/Events page's current query to copy its key+queryFn signature per profile), combine for reference stability, `Scoped<EventItem>` wrapping, per-profile exclusions ride the API gate, errors per profile, refetchProfile.
- Merged ordering: sort by absolute instant. Events carry server-local timestamps; derive epoch using the OWNING profile's timezone (session.timezone / profile record) — helper `eventInstant(scoped)` in `lib/event/` with unit tests across two timezones (W: spec section 5). Paging v1: per-profile page N + client merge; "load more" advances profiles with exhausted slices (copy the plan sketch from the spec; keep simple — one shared page counter is acceptable v1 with a ponytail note).
- [ ] Failing tests: cross-tz ordering correct (A=UTC, B=America/New_York, interleaved); colliding event ids distinct; one profile failing → ProfileError + healthy data; reference stability under rerender.
- [ ] Implement; vitest hooks + build; commit `feat: scoped events aggregation hook (refs #337)`.

## Task 3: `/all/` deep routes + handler parameterization (W6, W2)

**Files:** `App.tsx` routes `/all/monitors/:profileId/:monitorId` + `/all/events/:profileId/:eventId`; `pages/MonitorDetail.tsx`, `pages/EventDetail.tsx` resolve profileId from route param (fallback current); their handler hooks (`usePTZControl`, `useModeControl`, `useAlarmControl`, `useBulkDeleteEvents`, `useEventNavigation`, `useEventTags`, `useMonitorRecentEvents`) gain optional profileId threaded to `getSession(profileId).client` + keys (defaults current — mechanical). `MonitorCard`: replace switch-then-navigate with direct `/all/...` navigation in All mode (keep switch-then-navigate ONLY for actions that genuinely need mode change; detail/events views use deep routes now). Add `tryGetCurrentSession(): ServerSession | null` to `services/sessions.ts` (returns null for sentinel/no-profile instead of throwing) and use it in UI-layer handlers that may render in All mode (W2) — getCurrentSession stays throwing for non-UI callers.
- [ ] Failing tests: detail page with route profileId B fetches via B's client/keys while current profile is A; MonitorCard All-mode click navigates to `/all/...` without switching (switchProfile NOT called).
- [ ] Implement; vitest pages/hooks + build; commit `feat: all-mode deep routes carry the owning profile (refs #337)`.

## Task 4: Events + Timeline pages aggregate

**Files:** `pages/Events.tsx`, `pages/Timeline.tsx` (+ `TimelineCanvas` data feed), `components/events/EventListView.tsx`/`EventCard` (profile chip, owning-profile portal URLs via the Task 1/((W: per-profile helpers)) params), filter row server chips (All settings bucket key `eventsServerFilter: ProfileId[] | null` via mergeProfileSettings default null=all), monitor filter grouped by server in All mode. Error strips + all-failed state per the Monitors pattern (suppression semantics identical: strip only for zero-data profiles). Event timestamps display with owning profile tz via formatAppDate parameterization (extend `useDateTimeFormat`/`formatAppDate` with optional timezone arg — Date-time contract: changes live in those modules only).
- [ ] Failing component tests: All mode renders both profiles' events with chips ordered cross-tz correctly; server filter hides a profile's slice; failed profile strip + healthy renders; single-mode unchanged snapshot-level.
- [ ] Implement; vitest + build; locales ×5 for new strings; commit `feat: aggregated events and timeline (refs #337)`.

## Task 5: New-event badges in All mode (W3)

**Files:** `hooks/useMonitorNewEvents.ts` → scoped variant (per-profile fan-out keyed by existing `monitorEventsSince` keys with profileId); `hooks/useOpenMonitorEvents` (or wherever markSeen closure lives — W3 says it captures pre-switch currentProfile): thread owning profileId explicitly so an All-mode card's navigate marks ITS profile's watermark; un-gate badges in `pages/Monitors.tsx` All mode.
- [ ] Failing tests: badges count per owning profile; markSeen writes B's watermark when B's card opened from All mode (assert store value).
- [ ] Implement; vitest + build; commit `feat: per-profile new-event badges in All mode (refs #337)`.

## Task 6: Notification taps in All mode (W5)

**Files:** `components/NotificationHandler.tsx`, `services/pushNotifications.ts`, `lib/profile/notification-profile.ts` (+ its test).
- In All mode (`currentProfileId === ALL_PROFILES_ID`): a notification for ANY known profile needs no switch — skip `requestProfileSwitch`, navigate directly to `/all/events/:profileId/:eventId`. Single-mode cross-profile prompt flow unchanged. `resolveProfileForNotification` gains the All-mode branch (isCrossProfile=false when in All mode and profile known).
- [ ] Failing tests (extend notification-profile.test.ts + handler tests): All-mode tap → no pending switch queued, direct navigation target; single-mode behavior unchanged.
- [ ] Implement; vitest + build; commit `feat: direct notification taps in All mode (refs #337)`.

## Task 7: Debt sweep (W8 + fix-wave minors)

**Files:** `hooks/useScopedMonitors.ts` + `useScopedEvents.ts` stagger: per-query `refetchInterval` offset scheduler (deterministic: base + (index/N)*base, capped; replaces the ponytail note — W8 says land WITH Phase 3's doubled query volume); delete dead `ProfileState.reLogin` + `profile-switch-relogin-guard.test.ts` (re-review: zero production callers; suppression no longer load-bearing) as `refactor:` commit; comment at the aggregate `enabled` line recording best-effort SSL-trust ordering; `useTokenRefresh` in All mode: proactively refresh EVERY scope profile's token (loop slices via getAuthSlice, per-profile timers or one timer iterating profiles — keep simple).
- [ ] Failing tests: stagger offsets distinct per index (assert computed intervals); token refresh timer touches both profiles' slices in All mode.
- [ ] Implement; vitest + build; two commits: `refactor: remove dead current-profile reLogin action (refs #337)`, `feat: staggered aggregate polling and all-mode token refresh (refs #337)`.

## Task 8: e2e + docs + acceptance

**Files:** extend `tests/features/all-profiles.feature` (+steps): scenario merged events list shows both profiles' events with chips (2x count outcome-based); scenario tap-through card → `/all/monitors/...` detail renders WITHOUT profile switch (assert switcher still shows All Servers); user doc section update (events/timeline now aggregate; badges; notification behavior); call-flows addition if playbook mandates (aggregated events flow).
- [ ] e2e red→green: `npm run test:e2e -- all-profiles.feature`; then FULL `npm run gates`; then FULL `npm run test:e2e` (known-flaky pair events.feature:149/live-activity.feature:16 tolerated if flaky-then-pass or matching the documented environmental pattern).
- [ ] Commit `feat: all-profiles events e2e and docs (refs #337)`; push; update PR #339 body (gh pr edit) to cover Phase 3 scope.

## Self-review record

- Spec coverage: section 5 events merge/tz/paging → T2/T4; routing section 6 → T3; UX events/timeline → T4; push handling → T6; watch-list W1 (portal-url per-profile) landed in Phase 2 fix wave, migration of the 7 call sites happens inside T1/T4 where those surfaces aggregate; W2→T3; W3→T5; W4→T1; W5→T6; W6→T3; W7→T1; W8→T7.
- Types: `Scoped<T>`/`ProfileError` reused from Phase 2; `eventInstant` defined T2, consumed T4.
- Montage/Live Activity/dashboard aggregation + settings/logs/state pickers + assistant banner remain Phase 4.
