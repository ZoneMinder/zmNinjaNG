/**
 * Auth Store
 * 
 * Manages authentication state including access and refresh tokens.
 * Handles login, logout, and token refresh operations.
 * 
 * Key features:
 * - Persists refresh tokens to localStorage (access tokens are memory-only for security)
 * - Automatically calculates token expiration times
 * - Provides actions for login and logout
 * - Integrates with API layer for authentication requests
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PersistStorage, StorageValue } from 'zustand/middleware';
import { login as apiLogin, refreshToken as apiRefreshToken } from '../api/auth';
import { isApiClientInitialized } from '../api/client-ready';
import type { LoginResponse } from '../api/types';
import { log, LogLevel } from '../lib/logger';
import { decrypt, isCryptoAvailable } from '../lib/security/crypto';
import { setSecureValue, getSecureValue, removeSecureValue } from '../lib/security/secureStorage';
import { ZM_INTEGRATION, STORAGE_KEYS } from '../lib/zmninja-ng-constants';

interface AuthState {
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

  // Actions
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refreshAccessToken: () => Promise<void>;
  setTokens: (response: LoginResponse) => void;
  getFreshAccessToken: () => Promise<string | null>;
  proactiveLogin: (reLogin: () => Promise<boolean>) => Promise<boolean>;
  recoverFromAuthFailure: (reLogin?: () => Promise<boolean>) => Promise<boolean>;
  setReLoginCallback: (callback: (() => Promise<boolean>) | null) => void;
}

interface PersistedAuthState {
  refreshToken: string | null;
  refreshTokenExpires: number | null;
  version: string | null;
  apiVersion: string | null;
  requiresAuth: boolean;
}

function getStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Secure-storage key for the refresh token. On native this resolves to the
 * Keychain/Keystore; on web/desktop it is AES-GCM in localStorage (which is
 * obfuscation, not confidentiality, against a local reader).
 */
const AUTH_REFRESH_TOKEN_KEY = STORAGE_KEYS.authRefreshToken;

/**
 * Persistence adapter for the auth store. The refresh token is the only
 * sensitive field, so it is kept out of the persisted blob and stored through
 * secureStorage (native Keychain/Keystore, web AES-GCM). Everything else
 * (expiry, version, flags) is plain localStorage.
 *
 * If secure storage is unavailable, the token is dropped rather than written in
 * plaintext, so the user re-authenticates. Older builds stored the token
 * encrypted inside the blob; getItem recovers that once and the next write
 * moves it into secure storage.
 */
export const encryptedAuthStorage: PersistStorage<PersistedAuthState> = {
  getItem: async (name: string): Promise<StorageValue<PersistedAuthState> | null> => {
    const storage = getStorage();
    if (!storage) return null;
    const raw = storage.getItem(name);
    if (!raw) return null;

    let parsed: StorageValue<PersistedAuthState>;
    try {
      parsed = JSON.parse(raw) as StorageValue<PersistedAuthState>;
    } catch {
      return null;
    }

    // Preferred location: secure storage.
    let token: string | null = null;
    try {
      token = await getSecureValue(AUTH_REFRESH_TOKEN_KEY);
    } catch {
      token = null;
    }
    if (token) {
      parsed.state.refreshToken = token;
      return parsed;
    }

    // Migration: older builds stored the refresh token encrypted in the blob.
    const legacy = parsed.state.refreshToken;
    if (legacy) {
      if (isCryptoAvailable()) {
        try {
          const recovered = await decrypt(legacy);
          parsed.state.refreshToken = recovered;
          // Best effort: move it into secure storage now so the blob copy can be
          // dropped on the next write.
          try { await setSecureValue(AUTH_REFRESH_TOKEN_KEY, recovered); } catch { /* migrates on next write */ }
          return parsed;
        } catch {
          try { log.auth('Failed to recover legacy refresh token: clearing', LogLevel.ERROR); } catch { /* */ }
        }
      }
      parsed.state.refreshToken = null;
    }
    return parsed;
  },
  setItem: async (name: string, value: StorageValue<PersistedAuthState>): Promise<void> => {
    const storage = getStorage();
    if (!storage) return;

    // Never persist the refresh token inside the blob.
    const toStore: StorageValue<PersistedAuthState> = {
      ...value,
      state: { ...value.state, refreshToken: null },
    };

    const token = value.state.refreshToken;
    if (token) {
      try {
        await setSecureValue(AUTH_REFRESH_TOKEN_KEY, token);
      } catch {
        // Secure storage unavailable (e.g. no Web Crypto). Do not fall back to
        // plaintext: drop the token so the user re-authenticates.
        try { await removeSecureValue(AUTH_REFRESH_TOKEN_KEY); } catch { /* */ }
        try { log.auth('Secure storage unavailable: refresh token not persisted', LogLevel.ERROR); } catch { /* */ }
      }
    } else {
      // No token in state (e.g. logout): make sure none lingers.
      try { await removeSecureValue(AUTH_REFRESH_TOKEN_KEY); } catch { /* */ }
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
 * Module-level dedup for login(). Multiple callers (profile bootstrap +
 * api/client.ts proactive auth) can race a fresh-start login; without this
 * guard we'd POST /login.json twice. The promise is shared across all
 * entry points so any caller that arrives mid-flight attaches to the same
 * pending login.
 */
let pendingLogin: Promise<void> | null = null;

/**
 * Module-level dedup for getFreshAccessToken(). Concurrent callers (multiple
 * monitor tiles, hover previews, services) share the same in-flight refresh
 * so we only hit /host/login.json once per stale window.
 */
let pendingFreshToken: Promise<string | null> | null = null;

/**
 * Module-level dedup for the refresh POST itself. A proactive refresh
 * (getFreshAccessToken) and a 401 recovery (recoverFromAuthFailure) would
 * otherwise issue two concurrent refresh requests. Refs #184.
 */
let pendingRefresh: Promise<void> | null = null;

/**
 * Module-level dedup for the API client's proactive login: when several
 * requests start while unauthenticated, the first invokes reLogin and the
 * rest attach to the same attempt. Refs #184.
 */
let pendingProactiveLogin: Promise<boolean> | null = null;

/**
 * Single-flight 401 recovery shared by all in-flight requests. When a token
 * expires under a busy view (e.g. montage), every pending request fails with
 * 401 at once. Only the first caller runs refresh-then-reLogin; the rest await
 * the same outcome. Refs #182.
 */
let pendingAuthRecovery: Promise<boolean> | null = null;

/**
 * Clear all pending single-flight gates. resetApiClient calls this on profile
 * switch (via the reset hook registered in api/store-gates.ts) so the new
 * profile never attaches to a login, refresh, or recovery started for the old
 * one. In-flight promises still settle for their original callers, but each
 * gate clears itself only when it is still the current one, so a stale finally
 * cannot release a newer gate.
 */
export function resetAuthGates(): void {
  pendingLogin = null;
  pendingFreshToken = null;
  pendingRefresh = null;
  pendingProactiveLogin = null;
  pendingAuthRecovery = null;
}

/**
 * Credentials-based re-login callback registered by the profile store at app
 * init. Decoupled via a setter to avoid a circular import between auth and
 * profile stores.
 */
let reLoginCallback: (() => Promise<boolean>) | null = null;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      accessTokenExpires: null,
      refreshTokenExpires: null,
      version: null,
      apiVersion: null,
      isAuthenticated: false,
      requiresAuth: true,

      /**
       * Authenticate with the ZoneMinder server.
       * 
       * @param username - The username
       * @param password - The password
       */
      login: async (username: string, password: string) => {
        // If a login is already in flight, attach to it instead of starting a new one.
        if (pendingLogin) {
          log.auth('Login already in flight; attaching to pending request', LogLevel.DEBUG);
          return pendingLogin;
        }
        log.auth(`Login attempt for user: ${username}`);
        const attempt = (async () => {
          try {
            const response = await apiLogin({ user: username, pass: password });
            get().setTokens(response);
            const state = get();
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
          if (pendingLogin === gate) {
            pendingLogin = null;
          }
        });
        pendingLogin = gate;
        return gate;
      },

      /**
       * Clear all authentication state.
       * Removes tokens and resets authentication status.
       */
      logout: () => {
        set({
          accessToken: null,
          refreshToken: null,
          accessTokenExpires: null,
          refreshTokenExpires: null,
          version: null,
          apiVersion: null,
          isAuthenticated: false,
          requiresAuth: true,
        });
        log.auth('Logged out, auth state cleared');
      },

      /**
       * Refresh the access token using the stored refresh token.
       * If refresh fails, logs the user out.
       *
       * Single-flight: concurrent callers (proactive refresh, 401 recovery,
       * the useTokenRefresh timer) attach to the same in-flight POST.
       */
      refreshAccessToken: async () => {
        if (pendingRefresh) {
          return pendingRefresh;
        }
        const refresh = (async () => {
          const { refreshToken, refreshTokenExpires } = get();
          if (!refreshToken) {
            throw new Error('No refresh token available');
          }
          if (!refreshTokenExpires || refreshTokenExpires <= Date.now()) {
            log.auth('Refresh token expired or missing expiry; skipping network call', LogLevel.WARN);
            get().logout();
            throw new Error('Refresh token expired');
          }

          try {
            const response = await apiRefreshToken(refreshToken);
            get().setTokens(response);
          } catch (error) {
            log.auth('Token refresh failed', LogLevel.ERROR, error);
            get().logout();
            throw error;
          }
        })();
        const gate: Promise<void> = refresh.finally(() => {
          if (pendingRefresh === gate) {
            pendingRefresh = null;
          }
        });
        pendingRefresh = gate;
        return gate;
      },

      /**
       * Update state with new tokens from API response.
       * Calculates absolute expiration times based on relative seconds from response.
       */
      setTokens: (response: LoginResponse) => {
        const now = Date.now();
        const currentState = get();

        // A server with auth disabled returns login success but no tokens. Mark
        // it as no-auth and clear any token state, including a stale refresh
        // token carried over from a previously authed profile, so nothing tries
        // to refresh a token the server will never issue. Refs #153.
        const serverUsesAuth = !!(response.access_token || response.refresh_token);
        if (!serverUsesAuth) {
          set({
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

        set({
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

      setReLoginCallback: (callback) => {
        reLoginCallback = callback;
      },

      getFreshAccessToken: async () => {
        // No-auth server: there is no token to fetch and nothing to refresh.
        // Returning null here stops the refresh/reLogin loop. Refs #153.
        if (!get().requiresAuth) {
          return null;
        }
        // Cold start: the access token is never persisted, so a component that
        // builds a token-bearing URL (stream tile, event/notification image)
        // mounts with requiresAuth=true and no token and calls this immediately,
        // before profile bootstrap has created the API client. There is nothing
        // to refresh against yet, and bootstrap will re-authenticate from stored
        // credentials regardless. Returning null avoids a doomed refresh that
        // would throw, log an error, and force a spurious logout. Subscribers
        // re-render once bootstrap lands a fresh token.
        if (!isApiClientInitialized()) {
          return null;
        }
        if (pendingFreshToken) {
          return pendingFreshToken;
        }

        const state = get();
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
            await get().refreshAccessToken();
            return get().accessToken;
          } catch (refreshError) {
            log.auth(
              'Refresh failed in getFreshAccessToken; falling through to reLogin',
              LogLevel.WARN,
              { error: refreshError },
            );
            if (!reLoginCallback) {
              return null;
            }
            try {
              const ok = await reLoginCallback();
              if (!ok) return null;
              return get().accessToken;
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
          if (pendingFreshToken === gate) {
            pendingFreshToken = null;
          }
        });
        pendingFreshToken = gate;
        return gate;
      },

      /**
       * Run the API client's proactive login through a single-flight gate.
       * Several requests can start while unauthenticated (cold start, busy
       * montage); only the first invokes reLogin, the rest share its outcome.
       * Resolves to reLogin's result; rejects if reLogin rejects.
       */
      proactiveLogin: (reLogin: () => Promise<boolean>) => {
        if (pendingProactiveLogin) {
          return pendingProactiveLogin;
        }
        const attempt = (async () => reLogin())();
        const gate: Promise<boolean> = attempt.finally(() => {
          if (pendingProactiveLogin === gate) {
            pendingProactiveLogin = null;
          }
        });
        pendingProactiveLogin = gate;
        return gate;
      },

      /**
       * Single-flight recovery after a request failed with 401: refresh the
       * access token, fall back to reLogin, log out once when both fail.
       * The refresh goes through refreshAccessToken, so a recovery that starts
       * while a proactive refresh is pending attaches to the same POST instead
       * of issuing a second one. Resolves true when recovery produced a valid
       * session, false otherwise. Never rejects. Refs #182, #184.
       */
      recoverFromAuthFailure: (reLogin?: () => Promise<boolean>) => {
        if (pendingAuthRecovery) {
          return pendingAuthRecovery;
        }
        const recovery = (async (): Promise<boolean> => {
          try {
            if (!get().refreshToken) {
              throw new Error('No refresh token available');
            }
            await get().refreshAccessToken();
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
            get().logout();
            return false;
          }
        })();
        const gate: Promise<boolean> = recovery.finally(() => {
          if (pendingAuthRecovery === gate) {
            pendingAuthRecovery = null;
          }
        });
        pendingAuthRecovery = gate;
        return gate;
      },
    }),
    {
      name: STORAGE_KEYS.authStore,
      storage: encryptedAuthStorage,
      // Only persist refresh token and server version info
      // Access token is kept in memory for better security
      partialize: (state) => ({
        refreshToken: state.refreshToken,
        refreshTokenExpires: state.refreshTokenExpires,
        version: state.version,
        apiVersion: state.apiVersion,
        requiresAuth: state.requiresAuth,
      }),
      onRehydrateStorage: () => (state) => {
        try {
          if (state) {
            log.auth('Auth store rehydrated from localStorage', LogLevel.INFO, {
              hasRefreshToken: !!state.refreshToken,
              refreshTokenExpires: state.refreshTokenExpires
                ? new Date(state.refreshTokenExpires).toLocaleString()
                : 'N/A',
              version: state.version,
              apiVersion: state.apiVersion,
            });
            log.auth('NOTE: These tokens may be from previous profile and will be cleared by profile initialization', LogLevel.INFO);
          } else {
            log.auth('No persisted auth state found');
          }
        } catch { /* log may be unavailable during test teardown */ }
      }, })
);

// NOTE: Token auto-refresh is now handled by the useTokenRefresh hook
// See app/src/hooks/useTokenRefresh.ts
