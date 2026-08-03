/**
 * Token Refresh Hook
 *
 * Automatically manages the lifecycle of authentication tokens.
 * Checks token expiration periodically and refreshes the access token
 * before it expires to ensure uninterrupted session validity.
 *
 * Features:
 * - Proactive refreshing (refreshes 5 minutes before expiry)
 * - Handles already-expired tokens (e.g., after returning from background)
 * - Listens for visibility changes to refresh immediately when app regains focus
 * - Guards against concurrent refresh attempts
 * - Automatic logout on refresh failure
 * - Lifecycle-aware (stops checking when component unmounts or user logs out)
 */

import { useEffect, useRef } from 'react';
import { useAuthStore, useAuthSlice, getAuthSlice } from '../stores/auth';
import { useCurrentProfile } from './useCurrentProfile';
import { useProfileScope } from './useProfileScope';
import { ZM_INTEGRATION } from '../lib/zmninja-ng-constants';
import { log, LogLevel } from '../lib/logger';

/**
 * Custom hook to handle automatic token refresh for the current profile.
 * Should be mounted once at the root of the application (e.g., in App.tsx).
 *
 * In All mode there is no single current profile to gate on, so this
 * proactively refreshes EVERY profile in scope instead: each tick reads
 * each profile's own auth slice via getAuthSlice (not reactively - a scope
 * can hold many profiles and their token expiries change without needing a
 * re-render) and calls getFreshAccessToken(id) for any within the leeway.
 * getFreshAccessToken already dedupes concurrent calls per profile
 * (stores/auth.ts), so this needs no refresh-in-flight guard of its own.
 * Single mode is unchanged.
 */
export function useTokenRefresh(): void {
  const { currentProfile, isAllMode } = useCurrentProfile();
  const profileId = currentProfile?.id ?? null;
  const { isAuthenticated, accessTokenExpires } = useAuthSlice(profileId);
  const getFreshAccessToken = useAuthStore((state) => state.getFreshAccessToken);
  const scope = useProfileScope();
  const isRefreshingRef = useRef(false);

  useEffect(() => {
    if (isAllMode) {
      const scopeProfileIds = (scope?.profiles ?? []).map((p) => p.id);
      if (scopeProfileIds.length === 0) return;

      const checkAndRefreshAll = async () => {
        for (const id of scopeProfileIds) {
          const slice = getAuthSlice(id);
          if (!slice.isAuthenticated || !slice.accessTokenExpires) continue;

          const timeUntilExpiry = slice.accessTokenExpires - Date.now();
          if (timeUntilExpiry < ZM_INTEGRATION.accessTokenLeewayMs) {
            try {
              if (timeUntilExpiry <= 0) {
                log.auth('Access token already expired, refreshing... (All mode)', LogLevel.WARN, { profileId: id });
              } else {
                log.auth('Access token expiring soon, refreshing... (All mode)', LogLevel.DEBUG, { profileId: id });
              }
              await getFreshAccessToken(id);
            } catch (error) {
              log.auth('Failed to refresh access token (All mode)', LogLevel.ERROR, { profileId: id, error });
            }
          }
        }
      };

      checkAndRefreshAll();
      const interval = setInterval(checkAndRefreshAll, ZM_INTEGRATION.tokenCheckInterval);
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          checkAndRefreshAll();
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        clearInterval(interval);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }

    if (!profileId || !isAuthenticated) return;

    const checkAndRefresh = async () => {
      if (accessTokenExpires && !isRefreshingRef.current) {
        const timeUntilExpiry = accessTokenExpires - Date.now();
        // Refresh if token is expiring soon OR already expired.
        // Already-expired tokens can occur when the app returns from background
        // (mobile sleep, tab throttling) where timers were paused.
        if (timeUntilExpiry < ZM_INTEGRATION.accessTokenLeewayMs) {
          isRefreshingRef.current = true;
          try {
            if (timeUntilExpiry <= 0) {
              log.auth('Access token already expired, refreshing...', LogLevel.WARN);
            } else {
              log.auth('Access token expiring soon, refreshing...');
            }
            // Route through getFreshAccessToken so concurrent component-driven
            // refreshes share one network call via the auth-store dedup.
            await getFreshAccessToken(profileId);
            log.auth('Access token refreshed successfully');
          } catch (error) {
            log.auth('Failed to refresh access token', LogLevel.ERROR, error);
          } finally {
            isRefreshingRef.current = false;
          }
        }
      }
    };

    // Check immediately
    checkAndRefresh();

    // Then check every minute
    const interval = setInterval(checkAndRefresh, ZM_INTEGRATION.tokenCheckInterval);

    // Also check when the page becomes visible again (handles returning from
    // background on mobile or after tab was throttled by the browser).
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkAndRefresh();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isAllMode, scope, profileId, isAuthenticated, accessTokenExpires, getFreshAccessToken]);
}
