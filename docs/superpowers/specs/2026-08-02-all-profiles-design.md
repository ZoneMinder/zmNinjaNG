# All Profiles Mode — Design

Date: 2026-08-02
Status: approved (brainstormed with maintainer; approach chosen explicitly)

## Summary

A virtual "All Servers" profile that shows every configured profile's
monitors and events together in one UI, with actions auto-routed to the
owning server. Prerequisite: replace the app's single global API client with
an explicit per-profile session layer, migrated in one refactor pass
("big-bang", the maintainer's explicit choice over an incremental facade).

This spec is self-contained: it records the current state with file
references, every decision made, the target architecture, and a phased
implementation plan with tests. It is written for an implementer with no
access to the design conversation.

## Decisions (made by maintainer, do not re-litigate)

| Decision | Choice |
|---|---|
| Scope | Whole app becomes multi-profile capable, delivered in phases |
| UX model | Virtual "All Servers" profile entry; selecting a real profile returns to exactly today's behavior |
| Preferences | Two-tier: data-scoping prefs (excluded monitors, event filters, API timeout) come from each real profile and apply to that profile's slice; view prefs (layout, sort, refresh cadence) come from a settings bucket owned by the virtual ALL profile |
| Actions | Fully enabled in All mode, auto-routed to the owning profile's session; server-wide ops (run-state change) prompt with a profile picker |
| Architecture | Option 3 "big-bang": every API function takes an explicit session/client; the `getApiClient()` singleton is deleted, not kept as a facade. Migration lands as pure-refactor PR(s) BEFORE any All-mode feature code |
| Failure model | Partial failure is normal: healthy profiles render, failed ones show per-profile `ErrorBanner` strips with retry |

## Current state (verified 2026-08-02)

- `app/src/api/client.ts:81` — module-level `let apiClient: ApiClient | null`.
  `getApiClient()` (line 299) has ~63 call sites across 12 files
  (`api/auth.ts`, `api/groups.ts`, `api/logs.ts`, `api/monitors.ts`,
  `api/events.ts`, etc.). `setApiClient()` (line 306) has 14 callers
  (`stores/profile.ts`, `services/discovery.ts`,
  `services/profile-initialization.ts`, `pages/ProfileForm.tsx`,
  `pages/Profiles.tsx`). `createApiClient(baseURL, gates, reLogin?,
  profileId?)` (line 106) already accepts a per-profile URL and gates —
  the construction machinery is per-profile-ready; only the storage is a
  singleton.
- `app/src/api/store-gates.ts:36` — `createStoreApiClient(apiUrl, reLogin,
  profileId)` builds the gates object wired to the auth/settings stores.
- `app/src/stores/auth.ts` — single-profile token state
  (`accessToken`, `refreshToken`, `accessTokenExpires`,
  `refreshTokenExpires`, `version`, `apiVersion`, `isAuthenticated`,
  `requiresAuth`). Five module-level single-flight gates: `pendingLogin`,
  `pendingRefresh`, `pendingFreshToken`, `pendingProactiveLogin`,
  `pendingAuthRecovery`, plus module-level `reLoginCallback`. Persisted via
  `encryptedAuthStorage`, partialized to refresh token + server versions.
  `getFreshAccessToken` (line 395) guards on `isApiClientInitialized()`.
  No-auth servers: `requiresAuth: false` (refs #153).
- `app/src/stores/profile.ts` — `switchProfile` (line 260) performs a
  6-step teardown: quit streams (refs #188), `logout()`,
  `clearQueryCache()`, `resetApiClient()`, set `currentProfileId`,
  `setApiClient(createStoreApiClient(...))`, `performBootstrap(...)`
  (auth, timezone, zms path, multi-port).
- `app/src/api/types.ts:590` — `Profile` already carries per-server facts:
  `portalUrl`, `apiUrl`, `cgiUrl`, `refreshToken` (for auto-login),
  `timezone`, `minStreamingPort`, `go2rtcUrl`.
- `app/src/lib/query/query-keys.ts` — every server-data key is already
  profile-scoped: `[domain, profileId, ...rest]`. Header comment calls the
  global `queryClient.clear()` on switch "the primary cross-profile safety
  net" and the scoped keys "defense-in-depth"; this spec inverts that
  (scoped keys become primary, the clear-on-switch is removed in Phase 2).
- `app/src/hooks/useCurrentProfile.ts` — returns `{ currentProfile,
  settings, hasProfile }`; settings resolved through
  `mergeProfileSettings` (refs #246, reactive-path coercions).
- `app/src/lib/security/ssl-trust.ts` — native SSLTrust plugin holds ONE
  trusted fingerprint globally (`setTrustedFingerprint({ fingerprint })`).
  Electron trust is a boolean (`window.electronSsl.setTrustSelfSigned`).
  TOFU contract: with no stored fingerprint, accept any certificate
  (self-signed onboarding, see Native contract in `AGENTS.project.md`).
- `app/src/lib/profile/profile-settings.ts` — non-React settings access via
  an injected gate (`getExcludedMonitorIds`), registered by
  `stores/profile.ts` (refs #217).
- `app/src/lib/profile/notification-profile.ts` — push notifications carry
  a `profile` name; cross-profile taps queue a `PendingProfileSwitch`
  confirmation dialog handled in `components/NotificationHandler.tsx`.
- `app/src/hooks/useBandwidthSettings.ts` — the polling contract: every
  recurring interval derives from it (32 callers).
- No existing multi-profile/aggregate feature exists (grepped).

## Target architecture

### 1. `ServerSession` and the session manager

New module `app/src/services/sessions.ts` (service layer; reaches stores
only through gates, per the Service boundary contract):

```ts
interface ServerSession {
  profileId: ProfileId;
  client: ApiClient;        // createApiClient(profile.apiUrl, gates, reLogin, profileId)
  timezone: string;         // profile.timezone ?? fallback; kept fresh by bootstrap
}

getSession(profileId: ProfileId): ServerSession   // lazy-create from profile record; throws on unknown id
hasSession(profileId: ProfileId): boolean
dropSession(profileId: ProfileId): void           // on profile delete/edit (URL or credential change)
dropAllSessions(): void                           // full reset (e.g. delete-all)
```

- Sessions are NOT torn down on profile switch. Switching only changes
  `currentProfileId` and quits the outgoing profile's streams.
- The registry is a plain `Map<ProfileId, ServerSession>` in module scope.
- `ALL` is never a session. `getSession(ALL_PROFILES_ID)` throws — callers
  in All mode must fan out over real profile ids.
- Auth state does not live in the session object; it stays in the auth
  store (below), keyed by profile id. The session's gates read it by id,
  exactly as `createStoreApiClient` wires gates today.

### 2. Auth store: single slice → per-profile map

`app/src/stores/auth.ts` refactor. Public entry-point names survive; every
one gains a leading `profileId: ProfileId` parameter.

- State: `slices: Record<ProfileId, AuthSlice>` where `AuthSlice` is
  today's eight fields. `logout(profileId)` clears one slice;
  `logoutAll()` replaces today's global logout where genuinely global
  (delete-all-profiles).
- The five single-flight gates become per-profile:
  `Map<ProfileId, Promise<...>>` each. The dedup contract
  (`stores/__tests__/auth.test.ts`) now holds per profile: two concurrent
  refreshes for profile A share one POST; a refresh for A and one for B
  proceed independently.
- `reLoginCallback` becomes `Map<ProfileId, () => Promise<boolean>>`,
  registered when a session is created.
- Persistence: same `encryptedAuthStorage`, partialized per slice
  (refresh token, expiries, versions, `requiresAuth`). Migration: on
  rehydrate, if the legacy single-slice shape is found, discard it
  (bootstrap re-auths from `Profile.refreshToken` / stored credentials
  regardless — same recovery path as today's cold start; do NOT write a
  shape converter).
- `isApiClientInitialized()` guard in `getFreshAccessToken` becomes
  `hasSession(profileId)`.
- The no-auth-server behavior (refs #153) and the cold-start null return
  in `getFreshAccessToken` are preserved per slice, verbatim semantics.

### 3. API module migration (the big-bang)

Every function in `app/src/api/*.ts` that calls `getApiClient()` changes
to take the client explicitly as its FIRST parameter:

```ts
// before
export async function getMonitors(): Promise<...> { const client = getApiClient(); ... }
// after
export async function getMonitors(client: ApiClient): Promise<...> { ... }
```

- Parameter is `client: ApiClient`, not the whole session: API modules
  need nothing else, and it keeps them trivially testable (pass a stub).
- All call sites updated to pass `getSession(pid).client` where `pid` is
  the profile the caller is operating on (in single mode, the current
  profile id; hooks receive it from `useProfileScope`, below).
- `getApiClient`, `setApiClient`, `resetApiClient`,
  `isApiClientInitialized`, `registerApiClientResetHook` and the
  module-level `apiClient` variable in `api/client.ts` are DELETED in the
  same PR. `createApiClient` remains (sessions call it).
- `services/discovery.ts` and `pages/ProfileForm.tsx` construct probe
  clients during profile setup (before a profile exists); they call
  `createApiClient` directly with throwaway gates — this is the sanctioned
  exception, confined to those two files plus `sessions.ts` and enforced by
  the contract gate (below).
- `switchProfile` in `stores/profile.ts` shrinks to: quit outgoing
  profile's streams → set `currentProfileId` → ensure session exists →
  `performBootstrap(profile, ...)` exactly as today (bootstrap is
  idempotent per switch; it refreshes auth, timezone, zms path,
  multi-port). No logout, no client reset. (`clearQueryCache()` stays in
  Phase 1 to keep behavior identical; removed in Phase 2.)

### 4. The virtual ALL profile

- `ALL_PROFILES_ID: ProfileId` = `asProfileId('__all_profiles__')` in
  `app/src/lib/zmninja-ng-constants.ts`. Real profile ids are UUIDs; no
  collision. Never sent to a server, never gets a session.
- `currentProfileId === ALL_PROFILES_ID` ⇒ aggregate mode.
- Settings: the existing profile-scoped settings machinery
  (`getProfileSettings` / `updateProfileSettings` /
  `mergeProfileSettings`) works unchanged with `ALL_PROFILES_ID` as the
  key — the ALL view-settings bucket costs zero new code.
- New hook `app/src/hooks/useProfileScope.ts`:

```ts
type ProfileScope =
  | { mode: 'single'; profile: Profile; settings: ProfileSettings }
  | { mode: 'all'; profiles: Profile[]; settings: ProfileSettings };
      // settings = the ALL bucket; profiles = all real profiles
```

- `useCurrentProfile` remains for single-mode-only surfaces (settings
  forms, profile editing) and is amended: in All mode it returns
  `hasProfile: false` plus a new `isAllMode: true` flag so those surfaces
  can redirect to a profile picker instead of the setup page. Every
  data-displaying page/hook migrates to `useProfileScope`.
- Two-tier preference resolution, concretely: inside each per-profile
  queryFn, data-scoping reads use that profile's id
  (`getProfileSettings(p.id)` → excluded monitors, API timeout via the
  client's own gates); view-level reads in components use
  `scope.settings` (the ALL bucket in All mode, the profile's own bucket
  in single mode). `useBandwidthSettings` resolves from `scope.settings`
  — one implementation, both modes.
- Non-React data-pref access: `profile-settings.ts` gate gains
  `getExcludedMonitorIds(profileId)`; the no-arg form is deleted with its
  callers updated (compiler-driven).

### 5. Aggregation data layer

New hooks in `app/src/hooks/` (names indicative): `useScopedMonitors`,
`useScopedEvents`, built on React Query `useQueries`:

- One query per profile in scope (single mode: array of one — SAME code
  path, no `if (allMode)` forks in data hooks).
- Each query uses the EXISTING key factory with that profile's id
  (`queryKeys.monitors(p.id)` etc.). Keys and invalidation shapes do not
  change. Cache entries for different profiles coexist by construction.
- Results are tagged, never merged raw:

```ts
interface Scoped<T> { profileId: ProfileId; profileName: string; item: T }
// ScopedMonitor = Scoped<Monitor>, ScopedEvent = Scoped<Event>
```

  No unwrapped monitor/event crosses an aggregate boundary; IDs collide
  across servers (both servers have a Monitor "1"), so the type system
  carries the disambiguation.
- Merged event ordering: sort by absolute UTC instant (derive from event
  timestamp + owning server timezone via the session). Display formatting
  goes through the existing `useDateTimeFormat` / `formatAppDate` path,
  parameterized with the owning profile's timezone (small extension:
  these currently assume the current profile's tz).
- Pagination in All mode: fetch page N per profile, merge client-side,
  sort; "load more" advances only the profile slices that are exhausted
  in the merged window. ZoneMinder has no cross-server pagination; this
  client-side merge is the only option and is an accepted v1 cost.
- Per-profile refetch staggering: offset each profile's `refetchInterval`
  start by `index * (interval / N)` to avoid synchronized bursts.
- Failure: each profile's queries fail independently. Aggregate hooks
  return `errors: { profileId, error }[]` alongside data; pages render
  one `ErrorBanner` strip per failed profile (message via
  `resolveQueryError`, retry invalidates only that profile's keys).
  Auth failure in one profile's slice must not touch other slices (the
  per-profile auth gates guarantee this).

### 6. Routing

All-mode detail navigation embeds the owning profile:
`/all/events/:profileId/:eventId`, `/all/monitors/:profileId/:monitorId`.
Detail pages resolve their session from the route param, NOT from
`currentProfileId`. Single-mode routes unchanged.

### 7. Native: TLS trust multi-fingerprint

SSLTrust plugin API change (breaking, replaced in one PR — no dual API):

- `setTrustedFingerprint({ fingerprint })` → `setTrustedFingerprints({
  entries: Array<{ host: string; fingerprint: string }> })`.
- Native side (iOS Swift plugin in `app/ios/`, Android plugin) stores a
  host→fingerprint map; certificate validation looks up by the request's
  host. Host with no entry: TOFU behavior unchanged (accept, surface
  fingerprint to JS as today via `cert-trust-event.ts`).
- `applySSLTrustSetting` in `lib/security/ssl-trust.ts` becomes
  "apply the union of all profiles' stored fingerprints", called on app
  start and whenever any profile's trust changes (not just on switch).
- Electron: unchanged mechanism; enable trust-self-signed if ANY profile
  requires it.
- Web: no-op, unchanged.
- TS definitions in `app/src/plugins/ssl-trust/definitions.ts` + the test
  mock in `tests/setup.ts` update together (Native contract).

### 8. Streams and montage

- Stream URL builders (`lib/monitor/*`, `getEffectiveMinStreamingPort`,
  cgi/go2rtc resolution) currently read the current profile from the
  store; they gain an explicit `profileId`/profile parameter and read
  from the profile record (all needed fields already on `Profile`).
- `lib/monitor/active-streams` registry entries gain `profileId`;
  `quitAllActiveStreams(profileId?)` — no arg quits everything (delete-all),
  with arg quits one profile's (used by `switchProfile` for the outgoing
  profile, and by All-mode montage teardown per profile).
- All-mode montage: existing concurrent-stream cap applies to the TOTAL
  across servers, not per server.

### 9. Push notifications in All mode

In `NotificationHandler.tsx` / `pushNotifications.ts` tap handling: when
`currentProfileId === ALL_PROFILES_ID`, skip the `PendingProfileSwitch`
confirmation entirely and navigate to
`/all/events/:resolvedProfileId/:eventId`. Single-mode cross-profile flow
unchanged. ES registration per profile is already in place; no change.

## UX specification

- **Profiles page** (`pages/Profiles.tsx`): "All Servers" card, shown only
  when ≥2 profiles exist. `data-testid="profile-card-all"`. Selecting it
  calls `switchProfile(ALL_PROFILES_ID)` (which skips bootstrap/session
  work) and navigates to `/monitors`.
- **Profile switcher** (`components/profile-switcher.tsx`): "All Servers"
  entry with a distinct icon (e.g. lucide `Layers`), same ≥2 condition.
- **Monitors / Montage / Live**: one grid of all profiles' monitors. Each
  tile gets a profile chip (name, `truncate` + `title`, must fit 320px
  layouts). Toggle in the ALL view settings: flat vs grouped-by-server
  sections.
- **Events / Timeline**: merged chronological list; profile chip per row;
  filter row gains server chips; monitor filter groups monitors by server.
- **Dashboard**: widgets aggregate over all profiles; items carrying a
  single-server datum show the profile chip.
- **Settings in All mode**: view-level settings only (the ALL bucket).
  Server-scoped sections (connection, auth, monitor exclusions,
  notifications) first show a profile picker.
- **Logs / State control / server admin**: profile picker at top.
- **Assistant in All mode**: pinned to one picked profile, persistent
  banner names it. Aggregate assistant tools are out of scope (the session
  layer enables them later).
- **Run-state change from All mode**: profile picker dialog before the
  existing state UI.
- All new user-facing strings land in all five locales (de, en, es, fr,
  zh) in the same commit (Localization contract).

## Contracts and gates

Phase 1's PR adds a **Sessions** architecture contract to
`AGENTS.project.md` (via the self-improvement protocol):

> Owns: per-profile server connections.
> Path: `getSession(profileId)` (`app/src/services/sessions.ts`); auth
> state per profile via the auth store entry points.
> Never: constructing `ApiClient` outside `sessions.ts` /
> `services/discovery.ts` / `pages/ProfileForm.tsx`; per-profile token
> state outside the auth store; a session for `ALL_PROFILES_ID`.
> Gate: `app/src/tests/agents-contracts.test.ts`.

Contract gate additions in `agents-contracts.test.ts`:
- No file imports `createApiClient` except the three sanctioned files.
- `getApiClient` does not exist in the codebase (grep the source, expect
  zero hits after Phase 1).
- No literal `'__all_profiles__'` outside `zmninja-ng-constants.ts`.

## Implementation phases

Each phase = one issue + one PR train (P1), test-first (P2), gates green
before every commit (P3), full `npm run gates` + full e2e before each PR.

### Phase 0 — Native TLS multi-fingerprint (independent, ships first)
1. Failing unit tests: host-keyed fingerprint lookup in the TS layer +
   plugin mock behavior.
2. Update `definitions.ts`, iOS plugin, Android plugin, `ssl-trust.ts`
   (union-of-profiles application), `cert-trust-event` flow, test mock.
3. Manual device verification with two self-signed servers (device e2e is
   manual-only; agents never auto-run it).

### Phase 1 — Session layer + big-bang migration (pure refactor, ZERO behavior change)
1. Failing tests first: `services/__tests__/sessions.test.ts` (lazy
   create, throw on ALL/unknown, drop on delete/edit); extend
   `stores/__tests__/auth.test.ts` for per-profile slices and per-profile
   single-flight (A and B refresh independently; two A-refreshes share one
   POST).
2. `sessions.ts`; auth store map refactor; every `api/*.ts` function
   signature; all ~63 call sites; delete the singleton and its helpers;
   `switchProfile` simplification (keep `clearQueryCache()` this phase);
   `profile-settings.ts` gate gains the `profileId` parameter.
3. Contract gate additions + `AGENTS.project.md` Sessions contract.
4. Acceptance: full unit suite + full e2e green with NO e2e changes —
   that is the "zero behavior change" proof. Single-profile app behaves
   identically.

### Phase 2 — All mode, first surface (Monitors)
1. Failing tests first: `useProfileScope` union; monitors aggregation
   (two mock profiles, merged list, per-profile exclusion honored,
   one-profile-failure partial render). New e2e
   `all-profiles.feature` (platform tags; outcome-based: two mock
   servers, both servers' monitors visible; kill one server, other still
   renders + error strip visible).
2. `ALL_PROFILES_ID`; `useProfileScope`; `useCurrentProfile.isAllMode`;
   Profiles page card + switcher entry; aggregated Monitors page with
   profile chips; per-profile `ErrorBanner` strips; remove
   `clearQueryCache()` from `switchProfile` (scoped keys become the
   primary isolation; profile DELETE still removes that profile's cache
   entries by key predicate + drops its session and auth slice).
3. `monitorSeen` store: verify per-profile keying; stop clearing on
   switch if it is (implementer verifies; fix keying if not).
4. Locales ×5. User doc page for All mode (P10).

### Phase 3 — Events + Timeline + notifications
1. Failing tests first: merge/sort across timezones and colliding event
   ids; All-mode routes resolve session from route param; push tap in All
   mode navigates directly (extend `notification-profile.test.ts` /
   NotificationHandler tests). e2e: merged events list, cross-server
   ordering, tap-through to detail.
2. `useScopedEvents`, Events + Timeline pages, `/all/...` routes, event
   detail via route-param session, All-mode push handling, per-profile
   timezone rendering via `formatAppDate` extension.

### Phase 4 — Montage/Live, Dashboard, remaining surfaces
1. Failing tests first per surface; e2e for montage aggregate + stream
   cap; refetch staggering unit test.
2. Montage/Live aggregation with total stream cap; active-streams
   profileId; dashboard widget aggregation; settings/logs/state profile
   pickers; assistant pinned-profile banner; run-state profile picker.
3. Developer call-flow doc for session layer + aggregation
   (`docs/developer-guide/call-flows.rst` narrative style) (P10).

## Testing notes

- Unit/e2e mock strategy: e2e already runs against a mock ZM server;
  extend the harness to serve two profiles (second instance or second
  base path). See `agents/project/testing.md` before writing any of it.
- Manual live verification: the maintainer will supply two real profiles
  at test time. Credentials are entered interactively and MUST NOT be
  written to the repo, spec, tests, fixtures, logs, or agent memory.
- Perf sanity check in Phase 4: All-mode montage with both live profiles;
  confirm request stagger in the network log and that per-profile API
  timeouts are honored (slow server does not delay the fast one).

## Non-goals (v1)

- Aggregate assistant tools (enabled-by, not included).
- Cross-server event correlation/dedup.
- Server-side merged pagination (ZM has no such API).
- Any change to ES/push registration.

## Risks

- Phase 1 is the risk concentration: every data path edited at once.
  Mitigation: mechanical signature change only, no logic edits; the
  unchanged e2e suite is the acceptance gate; nothing else rides in that
  PR.
- Auth persistence shape change discards legacy tokens once on upgrade;
  bootstrap re-auths from stored credentials (existing cold-start path).
  One extra login per profile after the update, by design.
- SSLTrust plugin API replaced, not versioned: app and plugin ship
  together, so no compatibility window is needed.
