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
import { useAuthStore, useAuthSlice } from '../stores/auth';
import { useCurrentProfile } from './useCurrentProfile';
import { ZM_INTEGRATION } from '../lib/zmninja-ng-constants';
import { log, LogLevel } from '../lib/logger';

/**
 * Custom hook to handle automatic token refresh for the current profile.
 * Should be mounted once at the root of the application (e.g., in App.tsx).
 */
export function useTokenRefresh(): void {
  const { currentProfile } = useCurrentProfile();
  const profileId = currentProfile?.id ?? null;
  const { isAuthenticated, accessTokenExpires } = useAuthSlice(profileId);
  const getFreshAccessToken = useAuthStore((state) => state.getFreshAccessToken);
  const isRefreshingRef = useRef(false);

  useEffect(() => {
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
  }, [profileId, isAuthenticated, accessTokenExpires, getFreshAccessToken]);
}
