/**
 * useFreshAccessToken
 *
 * Returns an access token only when it has at least
 * `ZM_INTEGRATION.accessTokenLeewayMs` of validity remaining. Otherwise
 * returns `{ token: null, isFresh: false }` and asks the auth store to
 * refresh in the background. Subscribers re-render once the new token
 * lands.
 *
 * Used by every callsite that builds a token-bearing URL the browser or
 * native runtime loads directly (ZMS streams, event images and videos,
 * push-notification image backfills). Construct the URL only when
 * `isFresh` is true; while not fresh, render the existing VideoOff
 * placeholder by emitting an empty URL.
 */

/* Freshness is a function of wall-clock time by definition, so the render below
 * reads the clock. Nothing re-renders on expiry alone, so the value is "as of
 * the last render" with or without the React Compiler; useTokenRefresh drives
 * the store update that re-renders us. The compiler lint rules only honour
 * file-scope disables, and this file holds exactly this one hook. */
/* eslint-disable react-hooks/purity */

import { useEffect } from 'react';
import { useAuthStore, useAuthSlice } from '../stores/auth';
import { useCurrentProfile } from './useCurrentProfile';
import { ZM_INTEGRATION } from '../lib/zmninja-ng-constants';

export interface FreshAccessToken {
  token: string | null;
  isFresh: boolean;
}

export function useFreshAccessToken(): FreshAccessToken {
  const { currentProfile } = useCurrentProfile();
  const profileId = currentProfile?.id ?? null;
  const { accessToken, accessTokenExpires, requiresAuth } = useAuthSlice(profileId);
  const getFreshAccessToken = useAuthStore((state) => state.getFreshAccessToken);

  const tokenValid =
    !!accessToken &&
    !!accessTokenExpires &&
    accessTokenExpires - Date.now() > ZM_INTEGRATION.accessTokenLeewayMs;

  // A no-auth server needs no token, so it is always "fresh". Only servers that
  // use auth gate on a valid token (and trigger a background refresh otherwise).
  const isFresh = !requiresAuth || tokenValid;

  useEffect(() => {
    if (profileId && requiresAuth && !tokenValid) {
      void getFreshAccessToken(profileId);
    }
  }, [profileId, requiresAuth, tokenValid, getFreshAccessToken]);

  return { token: tokenValid ? accessToken : null, isFresh };
}
