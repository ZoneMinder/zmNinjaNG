# All Profiles — Phase 0 (TLS multi-fingerprint) + Phase 1 (session layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the global API-client singleton with per-profile sessions (zero behavior change) and teach the native TLS layer to trust multiple servers' fingerprints concurrently — the prerequisites for All Profiles mode.

**Architecture:** Spec at `docs/superpowers/specs/2026-08-02-all-profiles-design.md` (read it first; decisions there are final). Phase 0 changes the SSLTrust plugin from one global fingerprint to a host→fingerprint map. Phase 1 adds `services/sessions.ts`, refactors the auth store from one token slice to a per-profile map, migrates every `api/*.ts` function to an explicit `client: ApiClient` first parameter, then deletes `getApiClient`/`setApiClient`.

**Tech Stack:** React 18 + TypeScript, Zustand (persist), React Query v5, Capacitor plugins (Swift/Java), vitest.

## Global Constraints

- Run all npm commands from `app/`.
- P2 test-first: every task writes its failing test before implementation.
- P3: gates for the touched area green before every commit; `npm run gates` (vitest + build + 3 lints) before the PR.
- Phase 1 is ZERO behavior change: the full e2e suite must pass with NO e2e file edits — that is the acceptance proof.
- One logical change per conventional commit (P5). No `fix:`/`feat:` mixing with refactor commits; Phase 1 commits are `refactor:`, Phase 0 commits are `feat:`.
- Never log credentials or tokens; never write the maintainer's test-server credentials to any file.
- Service boundary contract: files in `services/` must not statically import stores — use the gate-registration pattern (`lib/profile/profile-settings.ts` is the model, refs #217).
- Native contract: Capacitor plugins import dynamically behind a platform check; TS definitions and the test mock in `src/tests/setup.ts` update together.
- The repo pre-commit hook runs gates; do not use `--no-verify` on code commits.
- Existing single-profile behavior semantics that MUST survive verbatim: no-auth servers (`requiresAuth:false`, refs #153), cold-start null from `getFreshAccessToken` before bootstrap, single-flight dedup (now per profile), TOFU accept-when-no-fingerprint (self-signed onboarding).

## Preliminaries (before Task 1)

- [ ] Create the GitHub issue: `gh issue create --title "All Profiles mode: virtual profile aggregating every server" --label core --body "<summary from spec + link docs/superpowers/specs/2026-08-02-all-profiles-design.md; phases 0-4>"` — include the line `Claude assisting @pliablepixels`. Note the number; all commits reference it (no closing keywords).
- [ ] Branch: `git checkout -b feat/all-profiles-sessions`

---

## Phase 0 — TLS multi-fingerprint

### Task 1: TS plugin API — `setTrustedFingerprints` (map)

**Files:**
- Modify: `app/src/plugins/ssl-trust/definitions.ts`
- Modify: `app/src/plugins/ssl-trust/web.ts` (no-op web impl)
- Modify: `app/src/lib/security/ssl-trust.ts`
- Modify: `app/src/tests/setup.ts` (SSLTrust mock)
- Test: `app/src/lib/security/__tests__/ssl-trust.test.ts` (exists — extend)

**Interfaces:**
- Consumes: `Profile` (`api/types.ts:590`), `getProfileSettings` (settings store), fields `allowSelfSignedCerts` / `trustedCertFingerprint` (`stores/settings.ts:179`).
- Produces (later tasks and Phase 1 rely on these exact names):
  - `SSLTrustPlugin.setTrustedFingerprints(options: { entries: Array<{ host: string; fingerprint: string }> }): Promise<void>` — replaces `setTrustedFingerprint`, which is DELETED (no dual API).
  - `applyTrustedCertificates(): Promise<void>` in `lib/security/ssl-trust.ts` — computes the union over ALL profiles and applies it (native: enable + entries; Electron: boolean; web: no-op).
  - `collectTrustEntries(profiles: Profile[], getSettings: (id: ProfileId) => ProfileSettings): { enabled: boolean; entries: Array<{ host: string; fingerprint: string }> }` — pure, exported for tests.

**Semantics of `collectTrustEntries`:** for each profile whose settings have `allowSelfSignedCerts` enabled and a non-null `trustedCertFingerprint`, emit one entry per distinct hostname among that profile's `portalUrl`, `apiUrl`, `cgiUrl`, `go2rtcUrl` (skip unparseable/empty URLs — today's single fingerprint applies to all of a profile's hosts, so this preserves per-profile semantics). `enabled` is true when ANY profile has `allowSelfSignedCerts` on. Duplicate host from two profiles: last write wins, log a WARN via `log.sslTrust` (two ZM servers behind one host is a misconfiguration).

- [ ] **Step 1: Write the failing test** (extend `ssl-trust.test.ts`)

```ts
import { collectTrustEntries } from '../ssl-trust';
import { asProfileId } from '../../../api/types';

const profile = (id: string, urls: Partial<Profile>): Profile => ({
  id: asProfileId(id), name: id, portalUrl: '', apiUrl: '', cgiUrl: '',
  isDefault: false, createdAt: 0, ...urls,
} as Profile);

describe('collectTrustEntries', () => {
  it('emits one entry per distinct host of each trusting profile', () => {
    const profiles = [
      profile('a', { portalUrl: 'https://cam-a.local', apiUrl: 'https://cam-a.local/zm/api', cgiUrl: 'https://cam-a.local/cgi-bin' }),
      profile('b', { portalUrl: 'https://cam-b.local:8443', apiUrl: 'https://api-b.local/zm/api', cgiUrl: 'https://cam-b.local:8443/cgi-bin' }),
    ];
    const settings = (id: ProfileId) => ({
      allowSelfSignedCerts: true,
      trustedCertFingerprint: id === asProfileId('a') ? 'AA:11' : 'BB:22',
    }) as ProfileSettings;
    const { enabled, entries } = collectTrustEntries(profiles, settings);
    expect(enabled).toBe(true);
    expect(entries).toContainEqual({ host: 'cam-a.local', fingerprint: 'AA:11' });
    expect(entries).toContainEqual({ host: 'cam-b.local', fingerprint: 'BB:22' });
    expect(entries).toContainEqual({ host: 'api-b.local', fingerprint: 'BB:22' });
    expect(entries.filter(e => e.host === 'cam-a.local')).toHaveLength(1); // deduped
  });
  it('excludes profiles with trust off or no stored fingerprint, disabled when none trust', () => {
    const profiles = [profile('a', { portalUrl: 'https://cam-a.local' })];
    const off = () => ({ allowSelfSignedCerts: false, trustedCertFingerprint: 'AA:11' }) as ProfileSettings;
    expect(collectTrustEntries(profiles, off)).toEqual({ enabled: false, entries: [] });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/security/__tests__/ssl-trust.test.ts` → FAIL, `collectTrustEntries` not exported.
- [ ] **Step 3: Implement**
  - `definitions.ts`: replace `setTrustedFingerprint(options: { fingerprint: string | null })` with `setTrustedFingerprints(options: { entries: Array<{ host: string; fingerprint: string }> })`. Keep `CertInfo`, `enable/disable/isEnabled/getServerCertFingerprint` unchanged.
  - `web.ts`: no-op `setTrustedFingerprints`.
  - `tests/setup.ts`: update the SSLTrust mock method name/signature.
  - `ssl-trust.ts`: implement `collectTrustEntries` (pure; hostname via `new URL(u).hostname` in try/catch); implement `applyTrustedCertificates()` which reads all profiles from the profile store state and their settings, calls `collectTrustEntries`, then per platform: native → `SSLTrust.enable()/disable()` + `setTrustedFingerprints({ entries })`; Electron → `window.electronSsl.setTrustSelfSigned(enabled)`; web → no-op. Delete the old `applySSLTrustSetting(enabled, fingerprint)` and `setTrustedFingerprint` helper; migrate its 6 callers (`components/settings/AdvancedSection.tsx`, `components/layout/AppLayout.tsx`, `hooks/useCertTrustPrompt.ts`, `pages/ProfileForm.tsx`, `pages/Profiles.tsx`, `services/profile-bootstrap.ts`) to call `applyTrustedCertificates()` — the union recomputes from state. EXCEPTION (review ruling, fix round 1): pre-save flows (`ProfileForm.tsx` test-connection/TOFU-accept, `Profiles.tsx` edit test) pass a candidate override — `applyTrustedCertificates(candidate?: { urls: string[]; fingerprint: string | null; enabled: boolean })` — because the draft profile is not yet in the store; a null-fingerprint candidate with `enabled` contributes TOFU accept-any for its hosts, and both pages re-apply with no args after the save commits. (`ssl-trust.ts` is in `lib/`, not `services/`, so reading stores directly is allowed, matching `useCertTrustPrompt`'s existing pattern.)
- [ ] **Step 4: Run tests** — `npx vitest run src/lib/security/ src/tests/` → PASS; `npm run build` → clean.
- [ ] **Step 5: Commit** — `git commit -m "feat: multi-host TLS trust entries in JS layer (refs #<issue>)"`

### Task 2: iOS plugin — host-keyed fingerprints

**Files:**
- Modify: `app/ios/App/App/SSLTrustPlugin.swift`

**Interfaces:**
- Consumes: the `setTrustedFingerprints` call shape from Task 1.
- Produces: native validation that looks up the challenge's host in the map.

- [ ] **Step 1: Read `SSLTrustPlugin.swift` fully.** Locate: the stored `trustedFingerprint` (single optional String), the `setTrustedFingerprint` `@objc` plugin method, and the URLSession/challenge handler comparing the presented cert's SHA-256 to the stored value.
- [ ] **Step 2: Transform** (mechanical, keep all existing logging/fingerprint-computation code):
  - Replace the single stored value with `private var trustedFingerprints: [String: String] = [:]` (host → fingerprint, colon-separated uppercase hex as today).
  - Replace the `setTrustedFingerprint` method with `setTrustedFingerprints`: parse `entries` array of `{host, fingerprint}` objects from the call, rebuild the dictionary atomically, `call.resolve()`.
  - In the challenge handler: key the lookup by the challenge's host (`challenge.protectionSpace.host`). Entry present → compare fingerprints (mismatch rejects, exactly today's logic). No entry → accept (TOFU contract: no stored fingerprint means accept; this is the existing single-profile behavior generalized per host).
- [ ] **Step 3: Build** — `npx cap sync ios && xcodebuild -workspace ios/App/App.xcworkspace -scheme App -destination 'generic/platform=iOS' build 2>&1 | tail -5` → succeeds. (No unit-test target for plugins; device verification is manual-only, listed in Task 4.)
- [ ] **Step 4: Commit** — `git commit -m "feat: iOS host-keyed TLS fingerprint map (refs #<issue>)"`

### Task 3: Android plugin — host-keyed fingerprints

**Files:**
- Modify: `app/android/app/src/main/java/com/zoneminder/zmNinjaNG/SSLTrustPlugin.java`

Same transformation as Task 2: single stored fingerprint field → `Map<String, String> trustedFingerprints`; `@PluginMethod setTrustedFingerprints` parsing the `entries` JSArray; hostname-keyed lookup in the trust-manager/hostname-verifier check (host from the connection/session being verified); absent host → accept.

- [ ] **Step 1: Read the file fully; apply the transformation.**
- [ ] **Step 2: Build** — `cd android && ./gradlew assembleDebug 2>&1 | tail -5` → BUILD SUCCESSFUL.
- [ ] **Step 3: Commit** — `git commit -m "feat: Android host-keyed TLS fingerprint map (refs #<issue>)"`

### Task 4: Phase 0 wrap-up

- [ ] `npm run gates` → all green.
- [ ] Note in the PR description: manual two-server self-signed verification pending (device e2e is manual-only; the maintainer supplies two live profiles at test time — credentials are never written anywhere).

---

## Phase 1 — Session layer + big-bang migration

Order is dependency-driven; the repo builds and tests green after every task. The legacy singleton keeps working until Task 8 deletes it.

### Task 5: `services/sessions.ts`

**Files:**
- Create: `app/src/services/sessions.ts`
- Modify: `app/src/stores/profile.ts` (register the gate at module load, next to `setProfileSettingsGate`)
- Modify: `app/src/api/types.ts` (add `ALL_PROFILES_ID` beside `asProfileId`; review ruling round 1: zmninja-ng-constants.ts placement closes an import cycle via logger/stores/logs)
- Test: `app/src/services/__tests__/sessions.test.ts` (create)

**Interfaces:**
- Consumes: `createStoreApiClient(baseURL, reLogin?, profileId?)` (`api/store-gates.ts:36`) — Task 6 upgrades its gates to per-profile; until then sessions built for the current profile behave identically to today.
- Produces (exact, used by every later task):

```ts
export const ALL_PROFILES_ID: ProfileId; // = asProfileId('__all_profiles__'), defined in api/types.ts, re-exported by sessions.ts
export interface ServerSession { profileId: ProfileId; client: ApiClient; timezone: string }
export interface SessionsGate {
  getProfile(id: ProfileId): Profile | undefined;
  getCurrentProfileId(): ProfileId | null;
  reLoginFor(id: ProfileId): () => Promise<boolean>;
}
export function registerSessionsGate(gate: SessionsGate): void;
export function getSession(profileId: ProfileId): ServerSession; // lazy-create; throws on ALL_PROFILES_ID or unknown id
export function getCurrentSession(): ServerSession;              // getSession(currentProfileId); throws if none
export function hasSession(profileId: ProfileId): boolean;
export function dropSession(profileId: ProfileId): void;
export function dropAllSessions(): void;
```

- `getSession` builds `client` via `createStoreApiClient(profile.apiUrl, gate.reLoginFor(id), id)` and `timezone` from `profile.timezone ?? 'UTC'`; caches in a module `Map`. A later `updateProfile` that changes `apiUrl` or credentials must call `dropSession(id)` (wired in Task 8).
- `stores/profile.ts` registers the gate at module load: `getProfile` finds in `get().profiles`, `getCurrentProfileId` returns `get().currentProfileId`, `reLoginFor(id)` returns a closure running today's `reLogin` logic against that profile id (Phase 1: only ever called for the current profile).

- [ ] **Step 1: Write the failing test**

```ts
import { registerSessionsGate, getSession, hasSession, dropSession, ALL_PROFILES_ID } from '../sessions';
// mock createStoreApiClient to return a tagged stub: vi.mock('../../api/store-gates', ...)

describe('sessions', () => {
  beforeEach(() => { /* register gate with two fake profiles a, b; dropAllSessions() */ });
  it('lazily creates one session per profile and caches it', () => {
    const s1 = getSession(aId); const s2 = getSession(aId);
    expect(s1).toBe(s2);
    expect(getSession(bId)).not.toBe(s1);
    expect(s1.timezone).toBe('America/New_York'); // from fake profile record
  });
  it('throws for ALL_PROFILES_ID and unknown ids', () => {
    expect(() => getSession(ALL_PROFILES_ID)).toThrow();
    expect(() => getSession(asProfileId('nope'))).toThrow();
  });
  it('dropSession evicts so the next get rebuilds', () => {
    const s1 = getSession(aId); dropSession(aId);
    expect(hasSession(aId)).toBe(false);
    expect(getSession(aId)).not.toBe(s1);
  });
});
```

- [ ] **Step 2: Verify fail** — `npx vitest run src/services/__tests__/sessions.test.ts` → module not found.
- [ ] **Step 3: Implement** as specified above (≈80 lines; log via `log` helpers, LogLevel explicit).
- [ ] **Step 4: Verify pass**, `npm run build` clean.
- [ ] **Step 5: Commit** — `refactor: add per-profile session registry (refs #<issue>)`

### Task 6: Auth store — per-profile slices

**Files:**
- Modify: `app/src/stores/auth.ts` (whole-store refactor)
- Modify: `app/src/api/store-gates.ts`
- Modify: `app/src/hooks/useTokenRefresh.ts` and every `useAuthStore` consumer (compiler-driven; ~grep `useAuthStore` outside stores/tests first)
- Test: `app/src/stores/__tests__/auth.test.ts` (extend — this file is the Auth tokens contract gate)

**Interfaces:**
- Consumes: `hasSession` from Task 5 (replaces `isApiClientInitialized`).
- Produces (exact):

```ts
interface AuthSlice { accessToken: string | null; refreshToken: string | null;
  accessTokenExpires: number | null; refreshTokenExpires: number | null;
  version: string | null; apiVersion: string | null;
  isAuthenticated: boolean; requiresAuth: boolean }
interface AuthState {
  slices: Record<ProfileId, AuthSlice>;
  login(profileId: ProfileId, username: string, password: string): Promise<void>;
  logout(profileId: ProfileId): void;
  logoutAll(): void;
  setTokens(profileId: ProfileId, response: LoginResponse): void;
  refreshAccessToken(profileId: ProfileId): Promise<void>;
  getFreshAccessToken(profileId: ProfileId): Promise<string | null>;
  proactiveLogin(profileId: ProfileId, reLogin: () => Promise<boolean>): Promise<boolean>;
  recoverFromAuthFailure(profileId: ProfileId, reLogin?: () => Promise<boolean>): Promise<boolean>;
  setReLoginCallback(profileId: ProfileId, cb: () => Promise<boolean>): void;
}
export function getAuthSlice(profileId: ProfileId | null): AuthSlice;      // non-React, EMPTY_SLICE fallback
export function useAuthSlice(profileId: ProfileId | null): AuthSlice;      // React selector (useShallow)
export function resetAuthGates(profileId?: ProfileId): void;               // no arg = all
```

Transformation rules (logic inside each action is UNCHANGED — only slice addressing and gate maps change):
- Every `get().field` → `get().slices[profileId] ?? EMPTY_SLICE` reads; every `set({...})` → `set(s => ({ slices: { ...s.slices, [profileId]: {...} } }))`.
- The five module-level single-flight gates (`pendingLogin`, `pendingRefresh`, `pendingFreshToken`, `pendingProactiveLogin`, `pendingAuthRecovery`) each become `Map<ProfileId, Promise<...>>`; the guard/finally pattern is identical per key. `reLoginCallback` becomes a `Map`.
- `getFreshAccessToken`: the `isApiClientInitialized()` guard (line 409, cold-start comment) becomes `hasSession(profileId)`; keep the comment, semantics identical.
- Persist: `partialize` maps each slice to `{ refreshToken, refreshTokenExpires, version, apiVersion, requiresAuth }`. `onRehydrateStorage`: if the stored shape has a top-level `refreshToken` (legacy single-slice), discard it entirely — bootstrap re-auths from `Profile.refreshToken`/credentials (spec: no shape converter).
- `store-gates.ts`: `storeGates` const becomes `makeProfileGates(profileId: ProfileId): ApiClientGates` — each gate closure passes `profileId` through (`getFreshAccessToken: () => useAuthStore.getState().getFreshAccessToken(profileId)`, etc.). `createStoreApiClient` requires `profileId` (no longer optional) and uses `makeProfileGates(profileId)`. Delete the `registerApiClientResetHook(resetAuthGates)` wiring — replaced by `dropSession`/`logout(profileId)` calling `resetAuthGates(profileId)` directly.
- Consumers (compiler finds them): components/hooks reading `useAuthStore(s => s.isAuthenticated)` etc. become `useAuthSlice(currentProfile?.id ?? null).isAuthenticated` — the current profile id comes from `useCurrentProfile()`/`useProfileStore` already present in nearly all of them. Non-React readers use `getAuthSlice`.

- [ ] **Step 1: Write failing tests** (extend `auth.test.ts`; keep every existing test, updated to pass a profileId)

```ts
it('refreshes independently per profile: A and B do not share a gate', async () => {
  // seed slices for A and B with expired access tokens + valid refresh tokens
  const posts = trackRefreshPosts(); // mock apiRefreshToken, count per token
  await Promise.all([
    useAuthStore.getState().refreshAccessToken(aId),
    useAuthStore.getState().refreshAccessToken(bId),
  ]);
  expect(posts.forToken('refresh-a')).toBe(1);
  expect(posts.forToken('refresh-b')).toBe(1);
});
it('two concurrent refreshes for the same profile share one POST', async () => {
  const posts = trackRefreshPosts();
  await Promise.all([
    useAuthStore.getState().refreshAccessToken(aId),
    useAuthStore.getState().refreshAccessToken(aId),
  ]);
  expect(posts.forToken('refresh-a')).toBe(1);
});
it('logout(A) clears only A', () => {
  useAuthStore.getState().logout(aId);
  expect(getAuthSlice(aId).isAuthenticated).toBe(false);
  expect(getAuthSlice(bId).isAuthenticated).toBe(true);
});
it('discards legacy single-slice persisted shape on rehydrate', () => { /* feed legacy JSON, expect slices === {} */ });
```

- [ ] **Step 2: Verify new tests fail.**
- [ ] **Step 3: Implement** per transformation rules; fix all compiler errors across consumers (this is the bulk — mechanical, current profile id threaded in).
- [ ] **Step 4:** `npx vitest run src/stores/ src/hooks/ src/api/` → PASS; `npm run build` clean.
- [ ] **Step 5: Commit** — `refactor: per-profile auth token slices (refs #<issue>)`

### Task 7: API modules — explicit `client` parameter (11 sub-commits)

**Files (one sub-task each, in this order — earlier ones have fewest consumers):**
`api/time.ts` (1 site) → `api/zones.ts` (1) → `api/groups.ts` (1) → `api/logs.ts` (1) → `api/tags.ts` (2) → `api/states.ts` (2) → `api/notifications.ts` (4) → `api/auth.ts` (6) → `api/server.ts` (7) → `api/events.ts` (8) → `api/monitors.ts` (9)
plus `components/ui/secure-image.tsx` (1 direct `getApiClient()` use — fold into the monitors sub-task).

**Interfaces:**
- Consumes: `getSession`, `getCurrentSession` (Task 5).
- Produces: every exported function in each module gains `client: ApiClient` as FIRST parameter and drops its `getApiClient` import.

Per-module procedure (identical each time; consumer files per module are found by the compiler after the signature change — the full consumer list for the phase is in the spec's inventory and includes hooks/, pages/, components/, services/, stores/, lib/assistant/, lib/event/, lib/zm/):

- [ ] **Step 1:** In the module, change every exported function:

```ts
// before
export async function getMonitors(): Promise<MonitorsResponse> {
  const client = getApiClient();
// after
export async function getMonitors(client: ApiClient): Promise<MonitorsResponse> {
```

Import `type { ApiClient } from './client'`. Remove the `getApiClient` import.
- [ ] **Step 2:** `npm run build` → fix every red call site by passing a client:
  - React hooks/components: `getCurrentSession().client` inside the queryFn/handler (Phase 1 is single-mode everywhere; Phase 2 threads real per-profile ids into aggregate paths).
  - Services with a profile in hand (`profile-bootstrap.ts`): `getSession(profile.id).client`.
  - The module's own unit tests (`api/__tests__/*.test.ts`): pass the existing mock client directly — this REMOVES their `setApiClient` setup, an improvement the test files get for free.
- [ ] **Step 3:** `npx vitest run src/api/__tests__/<module>.test.ts` and the touched consumer test dirs → PASS.
- [ ] **Step 4: Commit** — `refactor: explicit client param in api/<module> (refs #<issue>)`

(11 commits. `api/auth.ts` note: `login`/`refreshToken` are called BY the auth store — the store passes `getSession(profileId).client`; `testConnection`/discovery flows take the probe client from Task 8's `ProfileForm`/`discovery` wiring, until then they still compile via `getCurrentSession()`.)

### Task 8: Delete the singleton; simplify `switchProfile`

**Files:**
- Modify: `app/src/api/client.ts` — delete module `apiClient` variable, `getApiClient`, `setApiClient`, `resetApiClient`, `registerApiClientResetHook`, the `resetHooks` set, and the `client-ready` import. `createApiClient` stays.
- Delete: `app/src/api/client-ready.ts` (auth now guards on `hasSession`, done in Task 6).
- Modify: `app/src/stores/profile.ts` — `switchProfile` becomes: quit outgoing profile's streams → `set({ currentProfileId: profile.id })` → `updateProfile(lastUsed)` → `performBootstrap(profile, ...)` (unchanged call). DELETE the `logout()`, `clearQueryCache()` stays (spec: removed only in Phase 2), DELETE `resetApiClient()` + `setApiClient(...)`. `deleteProfile`: add `dropSession(id)` + `logout(id)` + `resetAuthGates(id)`. `updateProfile`: `dropSession(id)` when `apiUrl`/`portalUrl`/`cgiUrl`/`username`/`password` changed.
- Modify: `app/src/services/discovery.ts`, `app/src/pages/ProfileForm.tsx`, `app/src/services/profile-initialization.ts`, `app/src/pages/Profiles.tsx` — replace `setApiClient(createStoreApiClient(...))` bootstrapping with direct probe clients: `createApiClient(candidateUrl, probeGates)` where `probeGates` is a tiny no-auth gates object (exported from `store-gates.ts` as `PROBE_GATES`: `getAccessToken: () => null, isAuthenticated: () => true, getFreshAccessToken: async () => null, proactiveLogin: async (f) => f(), recoverFromAuthFailure: async () => false`, settings timeout from defaults). Pass that client into the api-module functions they call (signatures from Task 7).
- Modify: `app/src/lib/profile/profile-settings.ts` — gate method becomes `getExcludedMonitorIds(profileId: ProfileId)`; `stores/profile.ts` registration and the `api/events.ts` callers pass the id they operate on (Phase 1: `getCurrentSession().profileId`).
- Test: existing suites; `app/src/api/__tests__/client.test.ts` drops its `setApiClient/resetApiClient` cases (they test deleted code) and keeps `createApiClient` cases.

- [ ] **Step 1:** Make the edits; `npm run build` until zero references to the deleted symbols remain (`grep -rn "getApiClient\|setApiClient\|resetApiClient\|isApiClientInitialized" src/ --include="*.ts" --include="*.tsx"` → empty).
- [ ] **Step 2:** `npx vitest run` (full unit suite) → PASS. Pay attention to `stores/__tests__/profile.test.ts` — update its singleton expectations to session expectations (assert `dropSession` on delete, no logout on switch).
- [ ] **Step 3: Commit** — `refactor: delete API client singleton; sessions are the only path (refs #<issue>)`

### Task 9: Sessions contract + gates

**Files:**
- Modify: `app/src/tests/agents-contracts.test.ts`
- Modify: `AGENTS.project.md`

- [ ] **Step 1: Write the failing gate tests**

```ts
describe('Sessions contract', () => {
  it('ApiClient is constructed only in sanctioned files', () => {
    const offenders = srcFiles().filter(f =>
      !['services/sessions.ts', 'api/store-gates.ts', 'services/discovery.ts', 'pages/ProfileForm.tsx'].some(ok => f.endsWith(ok))
      && read(f).match(/createApiClient\s*\(/) && !f.includes('__tests__') && !f.endsWith('api/client.ts'));
    expect(offenders).toEqual([]);
  });
  it('the deleted singleton stays deleted', () => {
    const offenders = srcFiles().filter(f => /\b(getApiClient|setApiClient)\b/.test(read(f)));
    expect(offenders).toEqual([]);
  });
  it('ALL_PROFILES_ID literal lives only beside the brand', () => {
    const offenders = srcFiles().filter(f => read(f).includes("'__all_profiles__'") && !f.endsWith('api/types.ts'));
    expect(offenders).toEqual([]);
  });
});
```

(Reuse the file-walking helpers this test file already has for the other contracts.)
- [ ] **Step 2:** Verify they pass already (post-Task 8) — these are ratchet guards; if any fails, fix the offender, not the test.
- [ ] **Step 3:** Add the Sessions contract to `AGENTS.project.md` under Architecture contracts, exactly as written in the spec's "Contracts and gates" section.
- [ ] **Step 4: Commit** — `refactor: sessions architecture contract and gates (refs #<issue>)`

### Task 10: Phase acceptance

- [ ] `npm run gates` → all green (vitest, build, lint:a11y, lint:correctness, lint:ratchet).
- [ ] `npm run test:e2e` (full suite, no e2e file modified) → green. This is the zero-behavior-change proof; ANY e2e failure is a Phase 1 regression — fix the code, never the test (P4).
- [ ] Push branch, open PR: title `refactor: per-profile session layer + multi-host TLS trust (all-profiles phase 0+1)`, body links the issue + spec, notes manual device TLS verification pending, label `refactor`, body line `Claude assisting @pliablepixels`, footer `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## Self-review record

- Spec coverage: Phase 0 → Tasks 1-4; Phase 1 spec sections 1-3 → Tasks 5-8; contracts → Task 9; acceptance → Task 10. ALL sentinel constant lands in Task 5 (used by gates in Task 9; UI arrives in Phase 2's plan). `useProfileScope`, aggregate hooks, routing, push handling, montage/dashboard = Phases 2-4, separate plans.
- Type consistency: `ServerSession`/`SessionsGate`/`AuthSlice` names match across Tasks 5-8; `setTrustedFingerprints` entries shape matches Tasks 1-3.
- No placeholders: native Tasks 2-3 specify exact data-structure and lookup transformations; the implementer reads the plugin file in-context (16KB Swift / Java) rather than this plan carrying stale copies.
