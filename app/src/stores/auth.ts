/**
 * Auth Store
 *
 * Manages authentication state per profile, keyed by ProfileId. Handles
 * login, logout, and token refresh operations for whichever profile a
 * caller names.
 *
 * Key features:
 * - Persists each profile's refresh token to localStorage (access tokens are
 *   memory-only for security)
 * - Automatically calculates token expiration times
 * - Provides actions for login and logout
 * - Integrates with API layer for authentication requests
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PersistStorage, StorageValue } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { login as apiLogin, refreshToken as apiRefreshToken } from '../api/auth';
import type { ApiClient } from '../api/client';
import { hasActiveSession } from '../services/session-flags';
import { PROBE_PROFILE_ID, type LoginResponse, type ProfileId } from '../api/types';
import { log, LogLevel } from '../lib/logger';
import { setSecureValue, getSecureValue, removeSecureValue } from '../lib/security/secureStorage';
import { ZM_INTEGRATION, STORAGE_KEYS } from '../lib/zmninja-ng-constants';

export interface AuthSlice {
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpires: number | null;
  refreshTokenExpires: number | null;
  version: string | null;
  apiVersion: string | null;
  isAuthenticated: boolean;
  /**
   * Whether the connected server uses authentication. False for servers with
   * auth disabled, which return login success but no tokens. When false the app
   * does not require or refresh an access token. Defaults to true until a login
   * response tells us otherwise.
   */
  requiresAuth: boolean;
}

const EMPTY_SLICE: AuthSlice = Object.freeze({
  accessToken: null,
  refreshToken: null,
  accessTokenExpires: null,
  refreshTokenExpires: null,
  version: null,
  apiVersion: null,
  isAuthenticated: false,
  requiresAuth: true,
});

export interface AuthState {
  slices: Record<ProfileId, AuthSlice>;

  // Actions
  /**
   * `client` is required only for a profile that doesn't exist in the
   * profile store yet (ProfileForm's connection test, before addProfile
   * saves it): services/sessions.ts's getSession can't resolve a session for
   * an unknown profile. Omitted for every other caller, which already has a
   * real session (existing profile, post-bootstrap reLogin).
   */
  login: (profileId: ProfileId, username: string, password: string, client?: ApiClient) => Promise<void>;
  logout: (profileId: ProfileId, opts?: { keepGates?: boolean }) => void;
  logoutAll: () => void;
  refreshAccessToken: (profileId: ProfileId) => Promise<void>;
  setTokens: (profileId: ProfileId, response: LoginResponse) => void;
  getFreshAccessToken: (profileId: ProfileId) => Promise<string | null>;
  proactiveLogin: (profileId: ProfileId, reLogin: () => Promise<boolean>) => Promise<boolean>;
  recoverFromAuthFailure: (profileId: ProfileId, reLogin?: () => Promise<boolean>) => Promise<boolean>;
  setReLoginCallback: (profileId: ProfileId, callback: () => Promise<boolean>) => void;
}

interface PersistedSlice {
  refreshToken: string | null;
  refreshTokenExpires: number | null;
  version: string | null;
  apiVersion: string | null;
  requiresAuth: boolean;
}

interface PersistedAuthState {
  slices: Record<ProfileId, PersistedSlice>;
}

function getStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Secure-storage key for refresh tokens. On native this resolves to the
 * Keychain/Keystore; on web/desktop it is AES-GCM in localStorage (which is
 * obfuscation, not confidentiality, against a local reader). Holds a single
 * JSON map of `{ [profileId]: refreshToken }` so every profile's token lives
 * behind one secure-storage entry rather than one per profile (simpler
 * cleanup: nothing to enumerate or leak when a profile is deleted).
 */
const AUTH_REFRESH_TOKEN_KEY = STORAGE_KEYS.authRefreshToken;

/**
 * Persistence adapter for the auth store. Refresh tokens are the only
 * sensitive field, so they are kept out of the persisted blob and stored
 * through secureStorage (native Keychain/Keystore, web AES-GCM) as one JSON
 * map keyed by profile id. Everything else (expiry, version, flags) is plain
 * localStorage, one entry per profile slice.
 *
 * If secure storage is unavailable, tokens are dropped rather than written in
 * plaintext, so the user re-authenticates.
 *
 * A persisted blob from before per-profile slices (a top-level `refreshToken`
 * key) is discarded entirely on read - no shape converter. Bootstrap
 * re-authenticates each profile from `Profile.refreshToken`/credentials the
 * same way cold start already does.
 */
export const encryptedAuthStorage: PersistStorage<PersistedAuthState> = {
  getItem: async (name: string): Promise<StorageValue<PersistedAuthState> | null> => {
    const storage = getStorage();
    if (!storage) return null;
    const raw = storage.getItem(name);
    if (!raw) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== 'object') return null;
    const parsedState = (parsed as { state?: Record<string, unknown> }).state;

    // Legacy single-slice shape: a top-level `refreshToken` key. Discard
    // entirely rather than converting; bootstrap re-auths from the profile's
    // stored refresh token/credentials exactly as cold start does today.
    if (parsedState && 'refreshToken' in parsedState) {
      log.auth('Discarding legacy single-slice auth persistence', LogLevel.INFO);
      return null;
    }

    const typed = parsed as StorageValue<PersistedAuthState>;
    const slices = typed.state?.slices ?? {};

    let tokenMap: Record<string, string> = {};
    try {
      const stored = await getSecureValue(AUTH_REFRESH_TOKEN_KEY);
      tokenMap = stored ? (JSON.parse(stored) as Record<string, string>) : {};
    } catch (err) {
      // A Keychain/Keystore read failure logs the user out on the next refresh.
      // Silence here made that look like "no token was stored".
      try {
        log.auth('Secure storage read failed for refresh tokens', LogLevel.ERROR, {
          error: err instanceof Error ? err.message : String(err),
        });
      } catch { /* logger unavailable during early startup */ }
      tokenMap = {};
    }

    const hydratedSlices: Record<string, PersistedSlice> = {};
    for (const [id, slice] of Object.entries(slices)) {
      hydratedSlices[id] = { ...slice, refreshToken: tokenMap[id] ?? null };
    }

    return { ...typed, state: { slices: hydratedSlices as Record<ProfileId, PersistedSlice> } };
  },
  setItem: async (name: string, value: StorageValue<PersistedAuthState>): Promise<void> => {
    const storage = getStorage();
    if (!storage) return;

    // Never persist refresh tokens inside the blob.
    const tokenMap: Record<string, string> = {};
    const strippedSlices: Record<string, PersistedSlice> = {};
    for (const [id, slice] of Object.entries(value.state.slices)) {
      if (slice.refreshToken) tokenMap[id] = slice.refreshToken;
      strippedSlices[id] = { ...slice, refreshToken: null };
    }

    const toStore: StorageValue<PersistedAuthState> = {
      ...value,
      state: { slices: strippedSlices as Record<ProfileId, PersistedSlice> },
    };

    try {
      if (Object.keys(tokenMap).length > 0) {
        await setSecureValue(AUTH_REFRESH_TOKEN_KEY, JSON.stringify(tokenMap));
      } else {
        await removeSecureValue(AUTH_REFRESH_TOKEN_KEY);
      }
    } catch {
      // Secure storage unavailable (e.g. no Web Crypto). Do not fall back to
      // plaintext: drop the tokens so the user re-authenticates.
      try { await removeSecureValue(AUTH_REFRESH_TOKEN_KEY); } catch { /* */ }
      try { log.auth('Secure storage unavailable: refresh tokens not persisted', LogLevel.ERROR); } catch { /* */ }
    }

    try {
      storage.setItem(name, JSON.stringify(toStore));
    } catch { /* */ }
  },
  removeItem: async (name: string): Promise<void> => {
    const storage = getStorage();
    if (storage) storage.removeItem(name);
    try { await removeSecureValue(AUTH_REFRESH_TOKEN_KEY); } catch { /* */ }
  },
};

/**
 * Module-level dedup for login(), keyed per profile. Multiple callers
 * (profile bootstrap + api/client.ts proactive auth) can race a fresh-start
 * login for the same profile; without this guard we'd POST /login.json
 * twice. The promise is shared across all entry points so any caller that
 * arrives mid-flight attaches to the same pending login.
 */
const pendingLogin = new Map<ProfileId, Promise<void>>();

/**
 * Module-level dedup for getFreshAccessToken(), keyed per profile.
 * Concurrent callers (multiple monitor tiles, hover previews, services)
 * share the same in-flight refresh so we only hit /host/login.json once per
 * stale window per profile.
 */
const pendingFreshToken = new Map<ProfileId, Promise<string | null>>();

/**
 * Module-level dedup for the refresh POST itself, keyed per profile. A
 * proactive refresh (getFreshAccessToken) and a 401 recovery
 * (recoverFromAuthFailure) for the same profile would otherwise issue two
 * concurrent refresh requests. Refs #184.
 */
const pendingRefresh = new Map<ProfileId, Promise<void>>();

/**
 * Module-level dedup for the API client's proactive login, keyed per
 * profile: when several requests for one profile start while
 * unauthenticated, the first invokes reLogin and the rest attach to the same
 * attempt. Refs #184.
 */
const pendingProactiveLogin = new Map<ProfileId, Promise<boolean>>();

/**
 * Single-flight 401 recovery shared by all in-flight requests for a profile.
 * When a token expires under a busy view (e.g. montage), every pending
 * request fails with 401 at once. Only the first caller runs
 * refresh-then-reLogin; the rest await the same outcome. Refs #182.
 */
const pendingAuthRecovery = new Map<ProfileId, Promise<boolean>>();

/**
 * Clear pending single-flight gates for a profile (or every profile when
 * called with no id). logout(profileId) and services/sessions.ts's
 * dropSession call this directly so a dropped or logged-out profile never
 * leaves a stale in-flight login/refresh/recovery for the next caller to
 * attach to. In-flight promises still settle for their original callers, but
 * each gate clears itself only when it is still the current one, so a stale
 * finally cannot release a newer gate.
 */
export function resetAuthGates(profileId?: ProfileId): void {
  if (profileId === undefined) {
    pendingLogin.clear();
    pendingFreshToken.clear();
    pendingRefresh.clear();
    pendingProactiveLogin.clear();
    pendingAuthRecovery.clear();
    return;
  }
  pendingLogin.delete(profileId);
  pendingFreshToken.delete(profileId);
  pendingRefresh.delete(profileId);
  pendingProactiveLogin.delete(profileId);
  pendingAuthRecovery.delete(profileId);
}

/**
 * Credentials-based re-login callbacks registered by the profile store at
 * app init, one per profile. Decoupled via a setter to avoid a circular
 * import between auth and profile stores.
 */
const reLoginCallbacks = new Map<ProfileId, () => Promise<boolean>>();

/**
 * Resolves a profile's API client for apiLogin/apiRefreshToken. Late-bound
 * the same way as reLoginCallbacks above: services/sessions.ts's getSession
 * can't be imported here directly (sessions -> api/store-gates -> this store
 * would cycle), so stores/profile.ts - which already imports both this store
 * and services/sessions.ts - registers the real implementation at app init.
 * Refs #337.
 */
let authClientResolver: ((profileId: ProfileId) => ApiClient) | null = null;

export function registerAuthClientResolver(resolver: (profileId: ProfileId) => ApiClient): void {
  authClientResolver = resolver;
}

function resolveAuthClient(profileId: ProfileId): ApiClient {
  if (!authClientResolver) {
    throw new Error('registerAuthClientResolver: no resolver registered');
  }
  return authClientResolver(profileId);
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => {
      const getSlice = (profileId: ProfileId): AuthSlice => get().slices[profileId] ?? EMPTY_SLICE;
      const setSlice = (profileId: ProfileId, patch: Partial<AuthSlice>): void => {
        set((s) => ({
          slices: { ...s.slices, [profileId]: { ...(s.slices[profileId] ?? EMPTY_SLICE), ...patch } },
        }));
      };

      return {
        slices: {},

        /**
         * Authenticate a profile with the ZoneMinder server.
         *
         * @param profileId - The profile to authenticate
         * @param username - The username
         * @param password - The password
         */
        login: async (profileId: ProfileId, username: string, password: string, client?: ApiClient) => {
          // If a login is already in flight for this profile, attach to it
          // instead of starting a new one.
          const existing = pendingLogin.get(profileId);
          if (existing) {
            log.auth('Login already in flight; attaching to pending request', LogLevel.DEBUG);
            return existing;
          }
          log.auth(`Login attempt for user: ${username}`);
          const attempt = (async () => {
            try {
              const resolvedClient = client ?? resolveAuthClient(profileId);
              const response = await apiLogin(resolvedClient, { user: username, pass: password });
              get().setTokens(profileId, response);
              const state = getSlice(profileId);
              log.auth('Login successful', LogLevel.INFO, {
                accessTokenExpires: state.accessTokenExpires ? new Date(state.accessTokenExpires).toLocaleString() : 'N/A',
                refreshTokenExpires: state.refreshTokenExpires ? new Date(state.refreshTokenExpires).toLocaleString() : 'N/A',
                zmVersion: response.version,
                apiVersion: response.apiversion,
              });
            } catch (error) {
              log.auth('Login failed', LogLevel.ERROR, error);
              throw error;
            }
          })();
          const gate: Promise<void> = attempt.finally(() => {
            // Clear only if still ours: resetAuthGates may have cleared it and a
            // newer login may already own the gate.
            if (pendingLogin.get(profileId) === gate) {
              pendingLogin.delete(profileId);
            }
          });
          pendingLogin.set(profileId, gate);
          return gate;
        },

        /**
         * Clear a profile's authentication state.
         * Removes its tokens and resets its authentication status.
         *
         * `keepGates` is for internal use only: a failure path inside
         * refreshAccessToken/recoverFromAuthFailure calls this while its own
         * single-flight gate is still open (the surrounding promise hasn't
         * settled yet). A full resetAuthGates there would clear that gate
         * (and every other pending gate for this profile) mid-flight, so a
         * concurrent caller arriving in that window would see no pending
         * gate and start a duplicate refresh/login instead of attaching to
         * the one already in progress. Explicit surfaces (user logout,
         * dropSession, profile delete) call with the default (full reset).
         */
        logout: (profileId: ProfileId, opts?: { keepGates?: boolean }) => {
          setSlice(profileId, {
            accessToken: null,
            refreshToken: null,
            accessTokenExpires: null,
            refreshTokenExpires: null,
            version: null,
            apiVersion: null,
            isAuthenticated: false,
            requiresAuth: true,
          });
          if (!opts?.keepGates) {
            resetAuthGates(profileId);
          }
          log.auth('Logged out, auth state cleared', LogLevel.INFO, { profileId });
        },

        /** Log out every profile with auth state. */
        logoutAll: () => {
          (Object.keys(get().slices) as ProfileId[]).forEach((profileId) => get().logout(profileId));
        },

        /**
         * Refresh a profile's access token using its stored refresh token.
         * If refresh fails, logs that profile out.
         *
         * Single-flight per profile: concurrent callers (proactive refresh, 401
         * recovery, the useTokenRefresh timer) attach to the same in-flight POST.
         */
        refreshAccessToken: async (profileId: ProfileId) => {
          const existing = pendingRefresh.get(profileId);
          if (existing) {
            return existing;
          }
          const refresh = (async () => {
            const { refreshToken, refreshTokenExpires } = getSlice(profileId);
            if (!refreshToken) {
              throw new Error('No refresh token available');
            }
            if (!refreshTokenExpires || refreshTokenExpires <= Date.now()) {
              log.auth('Refresh token expired or missing expiry; skipping network call', LogLevel.WARN);
              // keepGates: this runs while refreshAccessToken's own gate is
              // still open; a full reset here would let a concurrent caller
              // slip past it and start a duplicate attempt. See logout's doc.
              get().logout(profileId, { keepGates: true });
              throw new Error('Refresh token expired');
            }

            try {
              const response = await apiRefreshToken(resolveAuthClient(profileId), refreshToken);
              get().setTokens(profileId, response);
            } catch (error) {
              log.auth('Token refresh failed', LogLevel.ERROR, error);
              get().logout(profileId, { keepGates: true });
              throw error;
            }
          })();
          const gate: Promise<void> = refresh.finally(() => {
            if (pendingRefresh.get(profileId) === gate) {
              pendingRefresh.delete(profileId);
            }
          });
          pendingRefresh.set(profileId, gate);
          return gate;
        },

        /**
         * Update a profile's state with new tokens from an API response.
         * Calculates absolute expiration times based on relative seconds from response.
         */
        setTokens: (profileId: ProfileId, response: LoginResponse) => {
          const now = Date.now();
          const currentState = getSlice(profileId);

          // A server with auth disabled returns login success but no tokens. Mark
          // it as no-auth and clear any token state, including a stale refresh
          // token carried over from a previous session for this profile, so
          // nothing tries to refresh a token the server will never issue. Refs #153.
          const serverUsesAuth = !!(response.access_token || response.refresh_token);
          if (!serverUsesAuth) {
            setSlice(profileId, {
              accessToken: null,
              refreshToken: null,
              accessTokenExpires: null,
              refreshTokenExpires: null,
              version: response.version || currentState.version,
              apiVersion: response.apiversion || currentState.apiVersion,
              isAuthenticated: true,
              requiresAuth: false,
            });
            return;
          }

          const accessToken = response.access_token || null;
          const accessTokenExpires = response.access_token_expires
            ? now + response.access_token_expires * 1000
            : null;

          setSlice(profileId, {
            accessToken,
            refreshToken: response.refresh_token || currentState.refreshToken,
            accessTokenExpires,
            refreshTokenExpires: response.refresh_token_expires
              ? now + response.refresh_token_expires * 1000
              : currentState.refreshTokenExpires,
            version: response.version || currentState.version,
            apiVersion: response.apiversion || currentState.apiVersion,
            isAuthenticated: true,
            requiresAuth: true,
          });
        },

        setReLoginCallback: (profileId: ProfileId, callback: () => Promise<boolean>) => {
          reLoginCallbacks.set(profileId, callback);
        },

        getFreshAccessToken: async (profileId: ProfileId) => {
          // No-auth server: there is no token to fetch and nothing to refresh.
          // Returning null here stops the refresh/reLogin loop. Refs #153.
          if (!getSlice(profileId).requiresAuth) {
            return null;
          }
          // Cold start: the access token is never persisted, so a component that
          // builds a token-bearing URL (stream tile, event/notification image)
          // mounts with requiresAuth=true and no token and calls this immediately,
          // before profile bootstrap has created this profile's session/API
          // client. There is nothing to refresh against yet, and bootstrap will
          // re-authenticate from stored credentials regardless. Returning null
          // avoids a doomed refresh that would throw, log an error, and force a
          // spurious logout. Subscribers re-render once bootstrap lands a fresh
          // token. hasActiveSession reads services/sessions.ts's cache via a
          // dedicated flag module (services/session-flags.ts, no imports of its
          // own): services/sessions.ts pulls in api/store-gates.ts, which
          // imports this store, so a static import of sessions.ts here would
          // cycle.
          if (!hasActiveSession(profileId)) {
            return null;
          }
          const existing = pendingFreshToken.get(profileId);
          if (existing) {
            return existing;
          }

          const state = getSlice(profileId);
          const now = Date.now();
          const hasFresh =
            !!state.accessToken &&
            !!state.accessTokenExpires &&
            state.accessTokenExpires - now > ZM_INTEGRATION.accessTokenLeewayMs;
          if (hasFresh) {
            return state.accessToken;
          }

          const fetchFresh = (async (): Promise<string | null> => {
            try {
              await get().refreshAccessToken(profileId);
              return getSlice(profileId).accessToken;
            } catch (refreshError) {
              log.auth(
                'Refresh failed in getFreshAccessToken; falling through to reLogin',
                LogLevel.WARN,
                { error: refreshError },
              );
              const reLoginCallback = reLoginCallbacks.get(profileId);
              if (!reLoginCallback) {
                return null;
              }
              try {
                const ok = await reLoginCallback();
                if (!ok) return null;
                return getSlice(profileId).accessToken;
              } catch (reLoginError) {
                log.auth(
                  'reLogin failed in getFreshAccessToken',
                  LogLevel.ERROR,
                  { error: reLoginError },
                );
                return null;
              }
            }
          })();

          const gate: Promise<string | null> = fetchFresh.finally(() => {
            if (pendingFreshToken.get(profileId) === gate) {
              pendingFreshToken.delete(profileId);
            }
          });
          pendingFreshToken.set(profileId, gate);
          return gate;
        },

        /**
         * Run the API client's proactive login for a profile through a
         * single-flight gate. Several requests can start while unauthenticated
         * (cold start, busy montage); only the first invokes reLogin, the rest
         * share its outcome. Resolves to reLogin's result; rejects if reLogin
         * rejects.
         */
        proactiveLogin: (profileId: ProfileId, reLogin: () => Promise<boolean>) => {
          const existing = pendingProactiveLogin.get(profileId);
          if (existing) {
            return existing;
          }
          const attempt = (async () => reLogin())();
          const gate: Promise<boolean> = attempt.finally(() => {
            if (pendingProactiveLogin.get(profileId) === gate) {
              pendingProactiveLogin.delete(profileId);
            }
          });
          pendingProactiveLogin.set(profileId, gate);
          return gate;
        },

        /**
         * Single-flight recovery after a request failed with 401 for a profile:
         * refresh the access token, fall back to reLogin, log out once when both
         * fail. The refresh goes through refreshAccessToken, so a recovery that
         * starts while a proactive refresh is pending attaches to the same POST
         * instead of issuing a second one. Resolves true when recovery produced
         * a valid session, false otherwise. Never rejects. Refs #182, #184.
         */
        recoverFromAuthFailure: (profileId: ProfileId, reLogin?: () => Promise<boolean>) => {
          const existing = pendingAuthRecovery.get(profileId);
          if (existing) {
            return existing;
          }
          const recovery = (async (): Promise<boolean> => {
            try {
              if (!getSlice(profileId).refreshToken) {
                throw new Error('No refresh token available');
              }
              await get().refreshAccessToken(profileId);
              return true;
            } catch (refreshError) {
              if (reLogin) {
                try {
                  if (await reLogin()) {
                    return true;
                  }
                } catch (reLoginError) {
                  log.auth('Re-login failed during 401 recovery', LogLevel.ERROR, reLoginError);
                }
              }
              log.auth('401 recovery failed; logging out', LogLevel.WARN, { error: refreshError });
              // keepGates: recoverFromAuthFailure's own gate is still open here.
              get().logout(profileId, { keepGates: true });
              return false;
            }
          })();
          const gate: Promise<boolean> = recovery.finally(() => {
            if (pendingAuthRecovery.get(profileId) === gate) {
              pendingAuthRecovery.delete(profileId);
            }
          });
          pendingAuthRecovery.set(profileId, gate);
          return gate;
        },
      };
    },
    {
      name: STORAGE_KEYS.authStore,
      storage: encryptedAuthStorage,
      // Only persist refresh token and server version info per profile.
      // Access tokens are kept in memory for better security. PROBE_PROFILE_ID
      // (anonymous pre-profile discovery) is excluded - it never names a
      // saved profile, so nothing under it should survive a reload. Refs #337.
      partialize: (state) => ({
        slices: Object.fromEntries(
          Object.entries(state.slices)
            .filter(([id]) => id !== PROBE_PROFILE_ID)
            .map(([id, s]) => [id, {
              refreshToken: s.refreshToken,
              refreshTokenExpires: s.refreshTokenExpires,
              version: s.version,
              apiVersion: s.apiVersion,
              requiresAuth: s.requiresAuth,
            }])
        ) as Record<ProfileId, PersistedSlice>,
      }),
      onRehydrateStorage: () => (state) => {
        try {
          if (state) {
            log.auth('Auth store rehydrated from localStorage', LogLevel.INFO, {
              profileCount: Object.keys(state.slices).length,
            });
            log.auth('NOTE: These tokens may be stale and will be re-validated by profile initialization', LogLevel.INFO);
          } else {
            log.auth('No persisted auth state found');
          }
        } catch { /* log may be unavailable during test teardown */ }
      }, })
);

/**
 * Read a profile's auth slice outside React (services, store actions, module
 * init). Returns EMPTY_SLICE for a null id or a profile with no slice yet.
 */
export function getAuthSlice(profileId: ProfileId | null): AuthSlice {
  if (!profileId) return EMPTY_SLICE;
  return useAuthStore.getState().slices[profileId] ?? EMPTY_SLICE;
}

/**
 * React selector for a profile's auth slice. Returns EMPTY_SLICE for a null
 * id or a profile with no slice yet; re-renders only when that profile's
 * slice fields change (useShallow).
 */
export function useAuthSlice(profileId: ProfileId | null): AuthSlice {
  return useAuthStore(useShallow((s) => (profileId ? s.slices[profileId] ?? EMPTY_SLICE : EMPTY_SLICE)));
}

// NOTE: Token auto-refresh is now handled by the useTokenRefresh hook
// See app/src/hooks/useTokenRefresh.ts
