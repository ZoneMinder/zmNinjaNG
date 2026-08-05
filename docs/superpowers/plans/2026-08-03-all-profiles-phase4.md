# All Profiles — Phase 4 (Montage/Live/Dashboard aggregation, pickers, closeout) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The remaining surfaces work in All mode — Montage and Live Activity aggregate with a global stream cap, Events' montage view un-gates, Dashboard widgets aggregate, server-scoped pages get profile pickers, the assistant declares its pinned profile — closing out the All Profiles feature.

**Architecture:** Spec `docs/superpowers/specs/2026-08-02-all-profiles-design.md` (UX spec + Phase 4 step list). Branch `feat/all-profiles-ui` continues (PR #339 grows). Established patterns to REUSE, not reinvent: scoped hooks via useQueries+combine (useScopedMonitors/useScopedEvents), per-row owning-profile resolution (EventListView's EventItem), composite keys via monitorCacheKey, per-profile stream URLs (useMonitorStream profileId), ErrorBanner strips with zero-data suppression, ALL-bucket view settings via mergeProfileSettings.

**Tech Stack:** unchanged.

## Global Constraints

Same as Phase 3's plan (TDD; gates per commit; full gates+e2e before final push; 5 locales together; kebab testids; contracts bind; never stage build.gradle/pbxproj; no --no-verify; reports via SendMessage to "main" fallback by name; e2e = two same-server profiles + unreachable third).

Carried debts this phase MUST close (from Phase 3 final review + re-reviews, ledgered):
- Scrubber-tap owning-profile threading (normal interaction; canvasEvents already carries profileId + realMonitorId — prop-type widening only).
- Preview popovers (EventPreviewPopover, TimelineScrubber thumbs, EventThumbnailHoverPreview) current-profile-only → blank in All mode; rewire per-row owning profile; scrubber previews must read realMonitorId + profileId off canvasEvents, never composite monitorId.
- EventMontageView per-tile wiring (EventItem pattern) + remove the All-mode gate.
- viewNameForPath blind to /all/... routes (entry banner suppressed).
- mergeProfileSettings reconciliation: persisted ProfileId lists (eventsServerFilter) drop ids whose profile no longer exists.
- "Showing X of Y" total vs active server filter mismatch; empty-server-filter hint.
Carried ride-items that stay ledgered (do NOT fix unless a task touches the exact code): I3 populate no-retry; drop-race husk; three composite-key definition sites (consolidate ONLY if a task edits them anyway); per-row subscriptions in non-virtualized EventListView; C2 sizes Events.tsx/Timeline.tsx; iOS trustedFingerprints dictionary race; useProfileById re-render breadth.

## Task 1: Aggregated Montage

**Files:** `pages/Montage.tsx` + its grid/group hooks (`useMontageGroupState`, group filter); Test alongside.
- Montage in All mode renders every profile's monitors via useScopedMonitors (SAME hook — Monitors page precedent), sections/groups per server when the existing group layout is active, profile chips on tiles, per-profile ErrorBanner strips (zero-data suppression semantics), per-tile streams via profileId prop (LiveMonitorPlayer already takes it).
- STREAM CAP (spec): the existing concurrent-stream limit applies to the TOTAL across servers — find the existing cap mechanism (bandwidth settings / montage grid logic) and make its accounting global over scoped tiles; test pins the cap with two profiles (cap N, 2 profiles, only N streams active total).
- Single mode byte-identical.
- [ ] Failing tests first (All-mode tiles for both profiles with chips; cap total; strip on failed profile) → implement → `npx vitest run src/pages/ src/hooks/` + build → commit `feat: aggregated montage with global stream cap (refs #337)`.

## Task 2: Events montage view un-gated + preview popovers

**Files:** `components/events/EventMontageView.tsx` (+ tile), `pages/Events.tsx` (remove gate + effectiveViewMode montage branch), `components/timeline/EventPreviewPopover.tsx`, `components/timeline/TimelineScrubber.tsx` (+ ScrubberThumbnail), `components/events/EventThumbnailHoverPreview.tsx`, `pages/Timeline.tsx` (scrubber tap owning-profile threading); locale removal of the gate notice if now unused.
- EventMontageView: per-tile owning-profile resolution exactly like EventListView's EventItem (per-row useProfileById/useFreshAccessToken/getPortalUrlForMonitor with profileId; tile props gain profileId/profileName chip). Remove the All-mode toggle gate + its locale keys IF fully unused after (all 5 locales together).
- Previews: each popover/thumb resolves the OWNING profile (props carry profileId; scrubber reads realMonitorId + profileId off the canvas event, never the composite monitorId).
- Scrubber tap: widen onTap to carry the owning profileId (or the event object) so colliding event ids open the right profile's event — the Phase 3 re-review's recorded recipe.
- [ ] Failing tests first (montage tile builds B's portal+token for B's event; scrubber tap on colliding ids opens B's route; preview renders owning profile's thumb in All mode) → implement → vitest + build → commit `feat: all-mode event montage and owning-profile previews (refs #337)`.

## Task 3: Aggregated Dashboard

**Files:** `components/dashboard/widgets/*` (EventsWidget, TimelineWidget, HeatmapWidget, MonitorWidget, others found by survey), `pages/Dashboard.tsx`/`DashboardLayout`; Tests alongside.
- Survey first: which widgets fetch server data with getCurrentSession()/useCurrentProfile — each aggregates via the scoped hooks (events widgets via useScopedEvents patterns with the widget's own key shapes; monitor widget via useScopedMonitors) OR, where a widget is intrinsically single-server (server load, disk), shows a compact profile picker chip (ALL-bucket setting per widget id: `dashboardWidgetProfile:<widgetId>` — keep it simpler if the existing widget-config store already has per-widget config: put the profile choice THERE, following its existing config pattern).
- Profile chips on single-server datum rows (spec).
- tryGetCurrentSession everywhere a widget could render under the sentinel (no throws).
- [ ] Failing tests per touched widget (aggregate values from two profiles or picker-scoped fetch; no crash in All mode) → implement → vitest + build → commit `feat: aggregated dashboard widgets (refs #337)`.

## Task 4: Server-scoped pages get pickers

**Files:** `pages/Server.tsx`, `pages/Logs.tsx`, `pages/NotificationSettings.tsx` (verify — ES registration is per profile), state-change UI (`useModeControl` consumers / run-state dialog), `pages/Settings.tsx` (server-scoped sections); shared `components/profile-picker.tsx` (new, small).
- In All mode these pages show a compact profile picker (shadcn Select, data-testid="page-profile-picker", localized label ×5) defaulting to the first profile; all queries/actions use the picked profile's session. Single mode: picker hidden, current profile used (byte-identical).
- Settings page: view-level (ALL bucket) sections stay editable; server-scoped sections render behind the picker (spec's two-tier rule).
- Run-state change: picker in the existing dialog when All mode.
- [ ] Failing tests (picker appears only in All mode; picked profile's client used — assert fetch via B after picking B; settings sections split correctly) → implement → vitest + build → commit `feat: profile pickers on server-scoped pages (refs #337)`.

## Task 5: Assistant banner + navigation polish

**Files:** assistant panel components (`AskPanel.tsx` banner area), `lib/navigation.ts` (viewNameForPath /all/... awareness), `stores/settings.ts` mergeProfileSettings (ProfileId-list reconciliation vs live profiles — coercion lives in the merge per Settings contract), Events.tsx "Showing X of Y" + empty-filter hint.
- Assistant in All mode: pinned to a picked profile (reuse Task 4's picker component) with a persistent localized banner naming it (spec; data-testid="assistant-pinned-banner"); tools context uses the picked profile id.
- viewNameForPath: /all/monitors/... and /all/events/... map to their view names (entry banner works on deep routes).
- mergeProfileSettings: eventsServerFilter (and any other ProfileId[] setting) drops ids not in the current profiles list (needs the profiles list — check what mergeProfileSettings can access without violating the store layering; if it can't, do the reconciliation at the read site in useProfileScope/Events with a comment, and note it).
- "Showing X of Y": Y reflects the active server filter; deselect-all-servers shows a localized "filter hides everything" hint.
- [ ] Failing tests each → implement → vitest + build → commit `feat: assistant pinning and all-mode polish (refs #337)`.

## Task 6: e2e + docs + acceptance + PR

**Files:** `tests/features/all-profiles.feature` + steps; `docs/user-guide/profiles.md` (+ montage/dashboard/live sections it references); `docs/developer-guide/call-flows.rst` per playbook.
- New scenarios (@web, outcome-based): All-mode Montage shows both profiles' tiles (chips, count 2x captured single); Events montage view now works in All mode (tiles render, no gate notice); Logs page picker switches data source (assert some per-profile-distinguishable outcome — server name/log source).
- User doc: montage/dashboard/live now aggregate; pickers on server pages; assistant pinning. Doc rules apply (no marketing prose).
- Acceptance: npx bddgen; targeted all-profiles.feature green; FULL npm run gates; FULL npm run test:e2e (documented pre-existing set tolerated: the 5 bisect-proven events-filter scenarios + the flaky pair + flaky-then-pass retries; ZERO new outright failures).
- Push; update PR #339 with the Phase 4 section; final whole-branch review (controller dispatches separately).
- [ ] Red→green e2e → gates → full e2e → commit `feat: all-profiles phase 4 e2e and docs (refs #337)` → push → PR edit.

## Self-review record

- Spec Phase 4 step list coverage: montage/live cap → T1; dashboard → T3; settings/logs/state pickers → T4; assistant banner → T5; stagger landed Phase 3. Carried-debt closures mapped: EventMontageView + previews + scrubber → T2; viewNameForPath + settings reconciliation + count polish → T5.
- Live Activity page: surveyed under T1's umbrella — if it consumes the same monitor/stream plumbing, aggregate it there; if it needs notification-store profile-tagging (the ledgered blocker), T1 notes it and it stays a documented gap with the ledger line (maintainer decision on notification-store rework — out of Phase 4 scope).
- Types/patterns all reuse Phase 2/3 primitives; no new architecture.
