/**
 * Store-backed gates for the API client.
 *
 * api/client.ts takes narrow AuthGate/SettingsGate interfaces instead of
 * importing the zustand stores. That keeps the client testable with plain
 * mocks and breaks the client -> auth store -> api/auth -> client import
 * cycle. This module owns the wiring: it builds a profile-scoped gate set
 * from the real stores. Refs #184, #337.
 */

import { getAuthSlice, resetAuthGates, useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import type { ProfileId } from './types';
import {
  createApiClient,
  type ApiClient,
  type ApiClientGates,
} from './client';

// Re-exported so services/sessions.ts (which cannot statically import
// stores/auth.ts - that would cycle back through this module) can still
// reach resetAuthGates via the api/ import it already has.
export { resetAuthGates };

/** Build the ApiClientGates for one profile - every gate closure is bound to profileId. */
export function makeProfileGates(profileId: ProfileId): ApiClientGates {
  return {
    auth: {
      getAccessToken: () => getAuthSlice(profileId).accessToken,
      getAccessTokenExpires: () => getAuthSlice(profileId).accessTokenExpires,
      isAuthenticated: () => getAuthSlice(profileId).isAuthenticated,
      getFreshAccessToken: () => useAuthStore.getState().getFreshAccessToken(profileId),
      proactiveLogin: (reLogin) => useAuthStore.getState().proactiveLogin(profileId, reLogin),
      recoverFromAuthFailure: (reLogin) => useAuthStore.getState().recoverFromAuthFailure(profileId, reLogin),
    },
    settings: {
      getApiTimeoutSeconds: (id) => useSettingsStore.getState().getProfileSettings(id).apiTimeoutSeconds,
    },
  };
}

/** createApiClient with gates assembled from the app stores, scoped to one profile. */
export function createStoreApiClient(
  baseURL: string,
  reLogin: (() => Promise<boolean>) | undefined,
  profileId: ProfileId,
): ApiClient {
  return createApiClient(baseURL, makeProfileGates(profileId), reLogin, profileId);
}
