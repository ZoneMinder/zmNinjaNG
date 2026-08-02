# All Profiles — Phase 2 (All mode + aggregated Monitors) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The virtual "All Servers" profile becomes selectable and the Monitors page aggregates every profile's monitors with live per-profile streams, actions, and partial-failure strips.

**Architecture:** Spec `docs/superpowers/specs/2026-08-02-all-profiles-design.md` sections 4-6 + UX spec (decisions final; the Phase 2 step list there names the mandatory reLoginFor fix). Branch `feat/all-profiles-ui`, based on `feat/all-profiles-sessions` (PR #338). Sessions/auth-slices/explicit clients all exist; this phase adds the ALL sentinel UX, the aggregation data layer, and the first aggregated surface.

**Tech Stack:** React 18 + TS, React Query v5 `useQueries`, Zustand, vitest, playwright-bdd e2e.

## Global Constraints

- Run npm from `app/`. TDD (P2): failing test before implementation, every task.
- P3: touched-area gates before each commit; full `npm run gates` + e2e before PR. Commits `feat:` (behavior) or `refactor:` as fits, `refs #337`, no `--no-verify`, never stage `app/android/app/build.gradle` / `app/ios/App/App.xcodeproj/project.pbxproj`.
- Single-profile mode must behave identically except where this plan says otherwise (clearQueryCache removal). Existing e2e must stay green unmodified except features this plan adds.
- Every new user-facing string lands in all five locales (de,en,es,fr,zh) in the same commit. New interactive elements get kebab-case `data-testid`. Labels fit 320px; flex text `min-w-0`+`truncate`+`title`.
- Contracts bind: Sessions (no ApiClient outside sanctioned files; no session for ALL/PROBE), Polling (intervals via `useBandwidthSettings`), Query UI states (`ErrorBanner`+`resolveQueryError`), Server queries (keys via `queryKeys`, `asProfileId`), Stores (selector subscriptions), Localization, Constants.
- e2e reality: ONE real ZM server from `app/.env`. All-mode e2e uses two profiles pointing at that same server (aggregation, chips, counts = 2x) and a third profile with an unreachable URL (partial-failure strip). No new mock infra.
- The reviewer-verified fact base from Phase 1 final review applies; do not re-verify (e.g. reLoginFor latency is the ONLY known aggregate blocker).

## Task 1: Per-profile reLogin (the mandatory Phase 2 fix)

**Files:** Modify `app/src/stores/profile.ts` (reLoginFor + the underlying reLogin logic); Test `app/src/stores/__tests__/profile.test.ts` (extend).

**Why first:** aggregate readers poll non-current profiles; today `reLoginFor(id)` ignores `id` and re-logs the CURRENT profile (spec Phase 2 step 5; code comment at the registration site). A 401 on profile B while A is current must re-auth B against B's server with B's credentials.

**Interfaces:** `reLoginFor(id)` returns a closure that: looks up profile `id` (fresh from state at call time), decrypts its stored password via the store's existing `getDecryptedPassword` mechanism (read how `performBootstrap` gets credentials), calls `useAuthStore.getState().login(id, username, password)` with `getSession(id).client` routing (login already resolves client per profile via the auth client resolver — verify it resolves by the profileId ARGUMENT, not currentProfileId; fix resolver if it doesn't), returns true on success. Profile gone or no credentials → return false, WARN log.

- [ ] Failing test: two fake profiles A (current) + B; invoke the registered `reLoginFor(B.id)` closure; assert the login POST went to B's client and B's slice authenticated while A's slice untouched; assert closure returns false for a deleted id.
- [ ] Implement; `npx vitest run src/stores/`; `npm run build`.
- [ ] Commit `fix: per-profile reLogin closure for non-current profiles (refs #337)`.

## Task 2: `useProfileScope` + `isAllMode`

**Files:** Create `app/src/hooks/useProfileScope.ts`; Modify `app/src/hooks/useCurrentProfile.ts` (add `isAllMode`); Test `app/src/hooks/__tests__/useProfileScope.test.tsx` (create).

**Interfaces (verbatim, later tasks depend on these):**

```ts
export type ProfileScope =
  | { mode: 'single'; profile: Profile; profiles: [Profile]; settings: ProfileSettings }
  | { mode: 'all'; profile: null; profiles: Profile[]; settings: ProfileSettings };
export function useProfileScope(): ProfileScope | null; // null = no profile selected at all
```

- `mode: 'all'` when `currentProfileId === ALL_PROFILES_ID`; `profiles` = all real profiles; `settings` = `mergeProfileSettings(profileSettings[ALL_PROFILES_ID])` (the existing machinery keys it for free — mirror useCurrentProfile's selector discipline: primitives + useShallow, merge in useMemo).
- `mode: 'single'`: `profiles` is a one-element array so consumers fan out over `scope.profiles` in BOTH modes with no branches.
- `useCurrentProfile` gains `isAllMode: boolean` (true when currentProfileId is the sentinel); its `currentProfile` stays null in All mode and `hasProfile` stays false — single-mode-only surfaces keep working; route guards use `isAllMode` (Task 6) to stop redirecting to setup.

- [ ] Failing tests: single mode returns the profile + its settings; ALL sentinel returns mode 'all' with every profile and the ALL settings bucket; no profiles returns null; `isAllMode` flag both ways. Assert setting VALUES (e.g. a grid-cols number written to the ALL bucket comes back).
- [ ] Implement; `npx vitest run src/hooks/`; build; commit `feat: profile scope hook and all-mode flag (refs #337)`.

## Task 3: switchProfile(ALL) + cache scoping

**Files:** Modify `app/src/stores/profile.ts`, `app/src/stores/query-cache.ts`, `app/src/stores/monitorSeen.ts` (verify keying only); Test extend `profile.test.ts` + `app/src/stores/__tests__/query-cache.test.ts` (create if absent).

- `switchProfile(ALL_PROFILES_ID)`: quits outgoing profile's streams, sets `currentProfileId`, SKIPS getSession/bootstrap/lastUsed (no server behind ALL). Selecting a real profile from ALL behaves like today.
- REMOVE `clearQueryCache()` from `switchProfile` entirely (spec: profile-scoped keys become the isolation primary; enables warm cache for All mode). Keep the function; `deleteProfile` now calls a new `removeProfileQueries(profileId)` in `query-cache.ts`: `queryClient.removeQueries({ predicate: q => q.queryKey.includes(profileId) })` (keys carry profileId at index 1; `includes` is the robust form). `deleteAllProfiles` keeps full `clearQueryCache()`.
- `monitorSeen`: read the store; it is per-profile keyed (clearProfile exists). Stop clearing it on SWITCH if any switch path still does; keep `clearProfile(id)` on profile DELETE only.

- [ ] Failing tests: switch does NOT clear other-profile cache entries (seed queryClient with keys for A and B, switch A→B, both remain); deleteProfile removes ONLY that profile's keys; switch to ALL sets the sentinel without bootstrap (assert no session created for ALL).
- [ ] Implement; `npx vitest run src/stores/`; build; commit `feat: warm cross-profile cache; scope eviction to deleted profile (refs #337)`.

## Task 4: `useScopedMonitors` aggregation hook

**Files:** Create `app/src/hooks/useScopedMonitors.ts`; Create `app/src/api/scoped-types.ts` (`Scoped<T>`); Test `app/src/hooks/__tests__/useScopedMonitors.test.tsx`.

**Interfaces (verbatim):**

```ts
// api/scoped-types.ts
export interface Scoped<T> { profileId: ProfileId; profileName: string; item: T }
export interface ProfileError { profileId: ProfileId; profileName: string; error: unknown }
// hooks/useScopedMonitors.ts
export interface UseScopedMonitorsReturn {
  monitors: Scoped<MonitorData>[];      // enabled monitors, all profiles, profile order then server order
  errors: ProfileError[];               // one entry per failed profile
  isLoading: boolean;                   // true only while NO profile has data yet
  refetchProfile: (id: ProfileId) => void;
}
export function useScopedMonitors(options?: { enabled?: boolean }): UseScopedMonitorsReturn;
```

- Built on `useQueries` over `scope.profiles` (works in both modes; single mode = 1 query, IDENTICAL key `queryKeys.monitors(id)` to today so cache is shared with existing surfaces).
- Per query: `queryFn: () => getMonitors(getSession(p.id).client, p.id)`; `enabled` gated on that profile's `getAuthSlice(p.id)` NOT being required-but-locked — copy the enablement semantics of `useMonitors` per profile (React hooks can't call useAuthSlice in a loop: select the whole `slices` map with useShallow once, derive per-profile).
- Stagger: `refetchInterval: bandwidth.monitorStatusInterval` plus per-index initial offset via `refetchIntervalInBackground`-safe approach: set each query's `refetchInterval` to the SAME interval but delay first fetch with `initialDataUpdatedAt`? No — simplest deterministic stagger: `refetchInterval: (q) => interval + index * (interval / profiles.length)` is wrong (drifts). ponytail: v1 uses the plain shared interval, and a `// ponytail:` comment noting stagger upgrade path (per-query offset scheduler) if synchronized bursts show up. Bandwidth contract still holds (interval from useBandwidthSettings, ALL bucket via scope.settings).
- `filterEnabledMonitors` per slice; wrap with profileId + profileName.

- [ ] Failing tests (fake sessions module + two profiles): merged list carries correct profileId per item and colliding monitor Ids stay distinct entries; one profile's queryFn rejecting yields its ProfileError while the other's data renders; single-mode returns exactly the same data as `useMonitors` would (same key).
- [ ] Implement; `npx vitest run src/hooks/`; build; commit `feat: scoped monitors aggregation hook (refs #337)`.

## Task 5: Per-profile stream URLs

**Files:** Modify `app/src/lib/zm/server-resolver.ts`, `app/src/lib/monitor/*` (min streaming port + stream URL builders), `app/src/hooks/useMonitorStream.ts`; Tests: extend `server-resolver.test.ts`, `useMonitorStream.test.ts`.

- Every function in the stream-URL chain that reads `useProfileStore.getState().currentProfileId` (or current profile record) gains an explicit `profileId`/profile parameter, defaulted to the current profile so existing single-mode callers stay source-compatible: `getEffectiveMinStreamingPort(profileId?: ProfileId)`, server-resolver's profile-record reads, cgi/go2rtc URL resolution.
- `useMonitorStream(options)` gains optional `profileId` in its options; token attachment uses `getFreshAccessToken(profileId)` / `useAuthSlice(profileId)` (it already threads the current id post-Phase 1 — make the id injectable).
- Zero behavior change for existing callers (default = current).

- [ ] Failing tests: stream URL built for an explicit non-current profileId uses THAT profile's cgi base + minStreamingPort + token slice (fake two profiles with different cgiUrl); defaulted call unchanged against existing snapshots.
- [ ] Implement; `npx vitest run src/lib/ src/hooks/`; build; commit `feat: profile-parameterized stream URLs (refs #337)`.

## Task 6: All-mode UI

**Files:** Modify `app/src/pages/Profiles.tsx`, `app/src/components/profile-switcher.tsx`, `app/src/pages/Monitors.tsx`, `app/src/components/monitors/MonitorCard.tsx` (profile chip prop), route guards (find via `hasProfile` redirect consumers — `AppLayout`/`ProtectedRoute`), `app/src/locales/{de,en,es,fr,zh}/translation.json`; Test: component tests for the card entry + Monitors branching.

- Profiles page: "All Servers" card ABOVE the profile list, visible only when ≥2 profiles, `data-testid="profile-card-all"`, distinct `Layers` icon, active-state indicator when in All mode; click → `switchProfile(ALL_PROFILES_ID)` → navigate `/monitors` (reuse `handleSwitchProfile`, which must skip the per-profile toast name lookup gracefully — pass the localized "All Servers" name).
- ProfileSwitcher: "All Servers" entry with same ≥2 rule, `data-testid="profile-switcher-all"`.
- Route guards: wherever `!hasProfile` redirects to setup, treat `isAllMode` as having a profile.
- Monitors page: replace its inline `useQuery` with `useScopedMonitors` (single mode included — one code path, cache key identical). In All mode: each card shows a profile chip (name, `truncate`+`title`); one `ErrorBanner` strip per `errors` entry above the grid (message via `resolveQueryError`, retry = `refetchProfile(id)`, `data-testid="profile-error-strip-${profileId}"`); card actions (settings save, PTZ nav, events nav) use `getSession(item.profileId).client` and routes that carry the owning profileId (detail-page routing stays single-profile in this phase: navigating a card in All mode first switches to that profile via existing switchProfile then navigates — spec's `/all/...` deep routes are Phase 3 with events; note this explicitly in code comment).
- Grouping toggle (flat vs by-server sections) stored in ALL settings bucket key `monitorsGroupByServer: boolean` (default false) — section headers = profile names.
- Locales: all new strings (`profiles.all_servers`, `profiles.all_servers_subtitle`, `monitors.group_by_server`, error-strip retry reuses existing keys) ×5, same commit.
- MonitorCard `data-testid` unchanged; chip `data-testid="monitor-profile-chip"`.

- [ ] Failing component tests first (Profiles card visibility rules; Monitors renders both profiles' cards with chips in All mode; error strip renders on one failed profile). Outcome-based assertions.
- [ ] Implement; `npx vitest run src/pages/ src/components/ src/hooks/ src/tests/`; build; commit `feat: All Servers mode with aggregated monitors (refs #337)`.

## Task 7: e2e + docs + gates

**Files:** Create `app/tests/features/all-profiles.feature` + `app/tests/steps/all-profiles.steps.ts`; user doc page (`docs/user-guide/` — follow documentation playbook `agents/project/documentation.md`); Modify `docs/developer-guide/call-flows.rst` IF the playbook's structure calls for it (read it first).

- Feature (platform tag `@web`, outcome-based): Background creates profile 1 via existing login step, then adds profile 2 pointing at the SAME `.env` server (name "Second"), then: "All Servers card appears; selecting it shows monitors from both profiles (count equals 2x single-profile count, chips visible)"; scenario 2: add a third profile with unreachable URL `http://127.0.0.1:9` (no credentials needed beyond stub), enter All mode, assert the error strip for that profile renders AND both healthy profiles' monitors still render. Steps use existing helpers/config; every Then asserts (e2e-steps gate).
- User doc: what All Servers is, the ≥2 rule, what works in v1 (monitors), preferences two-tier note.
- [ ] e2e red first (feature written, steps stubbed failing), then green: `npm run test:e2e -- all-profiles.feature`.
- [ ] Full `npm run gates` + full `npm run test:e2e`.
- [ ] Commit `feat: all-profiles e2e and user docs (refs #337)`; push branch; open PR base `feat/all-profiles-sessions`, label `core`, body links #337 + spec, line `Claude assisting @pliablepixels`, footer `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## Self-review record

- Spec coverage: spec section 4 (ALL sentinel/useProfileScope) → T2; section 5 (aggregation/Scoped/stagger/failure) → T4; UX spec Monitors/Profiles/switcher → T6; cache inversion → T3; reLoginFor mandate → T1; streams parameterization (pulled forward from Phase 4 because Monitors cards stream live) → T5; e2e/docs → T7. Deep `/all/` routes + events explicitly deferred to Phase 3 (noted in T6).
- Types consistent: `Scoped<T>`/`ProfileError`/`ProfileScope` defined once (T2/T4), consumed by name in T6.
- No placeholders; each task carries its failing-test definition and exact commands.
