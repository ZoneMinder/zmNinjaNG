/**
 * Per-profile session registry.
 *
 * A ServerSession bundles the pieces every request against one profile's
 * server needs: its API client and its timezone. Building for the current
 * profile only (today's single-profile model), this behaves identically to
 * the existing singleton apiClient; later tasks (All Profiles) build
 * sessions for non-current profiles too, and Task 6 upgrades
 * createStoreApiClient's gates to be per-profile.
 *
 * This module cannot import the profile store directly: stores/profile.ts
 * (and api modules it pulls in) would form a static import cycle back here.
 * A gate is injected instead; stores/profile.ts assembles the real
 * implementation and registers it at module load, next to its existing
 * setProfileSettingsGate registration. Refs #337.
 */

import { ALL_PROFILES_ID, PROBE_PROFILE_ID, type Profile, type ProfileId } from '../api/types';
import type { ApiClient } from '../api/client';
import { createStoreApiClient, resetAuthGates } from '../api/store-gates';
import { markSessionActive, markSessionInactive, markAllSessionsInactive } from './session-flags';
import { log, LogLevel } from '../lib/logger';

// Re-exported so consumers of the session registry (this module's real
// surface) don't need a separate import of the sentinel from api/types.ts
// just to compare a ProfileId against it.
export { ALL_PROFILES_ID };

export interface ServerSession {
  profileId: ProfileId;
  client: ApiClient;
  timezone: string;
}

export interface SessionsGate {
  getProfile(id: ProfileId): Profile | undefined;
  getCurrentProfileId(): ProfileId | null;
  reLoginFor(id: ProfileId): () => Promise<boolean>;
}

let gate: SessionsGate = {
  // Safe defaults before the store registers: no profiles, no current profile.
  getProfile: () => undefined,
  getCurrentProfileId: () => null,
  reLoginFor: () => async () => false,
};

export function registerSessionsGate(g: SessionsGate): void {
  gate = g;
}

const sessions = new Map<ProfileId, ServerSession>();

/**
 * Get (lazily building and caching) the session for a profile.
 *
 * ALL_PROFILES_ID is the virtual aggregate profile and PROBE_PROFILE_ID is
 * the anonymous pre-profile discovery id - neither is ever a real server, so
 * neither has a session (probe flows build their own client directly via
 * createStoreApiClient instead). An id with no matching profile is also
 * rejected rather than silently building a broken client.
 */
export function getSession(profileId: ProfileId): ServerSession {
  if (profileId === ALL_PROFILES_ID) {
    throw new Error('getSession: ALL_PROFILES_ID has no session');
  }
  if (profileId === PROBE_PROFILE_ID) {
    throw new Error('getSession: PROBE_PROFILE_ID has no session');
  }

  const cached = sessions.get(profileId);
  if (cached) return cached;

  const profile = gate.getProfile(profileId);
  if (!profile) {
    throw new Error(`getSession: unknown profile ${profileId}`);
  }

  const session: ServerSession = {
    profileId,
    client: createStoreApiClient(profile.apiUrl, gate.reLoginFor(profileId), profileId),
    timezone: profile.timezone ?? 'UTC',
  };
  sessions.set(profileId, session);
  markSessionActive(profileId);
  log.profileService('Session created', LogLevel.DEBUG, { profileId });
  return session;
}

/** Get the session for the current profile. Throws if there is none. */
export function getCurrentSession(): ServerSession {
  const currentProfileId = gate.getCurrentProfileId();
  if (!currentProfileId) {
    throw new Error('getCurrentSession: no current profile');
  }
  return getSession(currentProfileId);
}

export function hasSession(profileId: ProfileId): boolean {
  return sessions.has(profileId);
}

/**
 * Evict a profile's cached session so the next getSession rebuilds it. Must
 * be called whenever a profile's apiUrl or credentials change (wired in
 * Task 8's updateProfile). Also clears the profile's pending auth
 * single-flight gates (login/refresh/recovery) so a stale in-flight
 * operation for the dropped session's client never resolves into the next
 * one built for this profile.
 */
export function dropSession(profileId: ProfileId): void {
  sessions.delete(profileId);
  markSessionInactive(profileId);
  resetAuthGates(profileId);
  log.profileService('Session dropped', LogLevel.DEBUG, { profileId });
}

export function dropAllSessions(): void {
  sessions.clear();
  markAllSessionsInactive();
  resetAuthGates();
}
