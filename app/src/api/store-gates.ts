/**
 * Store-backed gates for the API client.
 *
 * api/client.ts takes narrow AuthGate/SettingsGate interfaces instead of
 * importing the zustand stores. That keeps the client testable with plain
 * mocks and breaks the client -> auth store -> api/auth -> client import
 * cycle. This module owns the wiring: it builds the gates from the real
 * stores and registers the auth gate reset with resetApiClient. Refs #184.
 */

import { resetAuthGates, useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import {
  createApiClient,
  registerApiClientResetHook,
  type ApiClient,
  type ApiClientGates,
} from './client';

export const storeGates: ApiClientGates = {
  auth: {
    getAccessToken: () => useAuthStore.getState().accessToken,
    getAccessTokenExpires: () => useAuthStore.getState().accessTokenExpires,
    isAuthenticated: () => useAuthStore.getState().isAuthenticated,
    getFreshAccessToken: () => useAuthStore.getState().getFreshAccessToken(),
    proactiveLogin: (reLogin) => useAuthStore.getState().proactiveLogin(reLogin),
    recoverFromAuthFailure: (reLogin) => useAuthStore.getState().recoverFromAuthFailure(reLogin),
  },
  settings: {
    getApiTimeoutSeconds: (profileId) =>
      useSettingsStore.getState().getProfileSettings(profileId).apiTimeoutSeconds,
  },
};

/** createApiClient with gates assembled from the app stores. */
export function createStoreApiClient(
  baseURL: string,
  reLogin?: () => Promise<boolean>,
  profileId?: string,
): ApiClient {
  // A profile switch (resetApiClient) must also clear the auth store's pending
  // single-flight gates so the new profile never attaches to an old login,
  // refresh, or 401 recovery. Registered here, not at module load, so tests
  // that mock the stores can import modules depending on this one. Duplicate
  // registrations are deduplicated. No gate can be pending before the first
  // client exists: every auth call needs the client.
  registerApiClientResetHook(resetAuthGates);
  return createApiClient(baseURL, storeGates, reLogin, profileId);
}
