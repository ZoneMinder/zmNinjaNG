/**
 * Profile Store
 * 
 * Manages the list of ZoneMinder server profiles and the current active profile.
 * Handles secure storage of passwords and profile switching logic.
 * 
 * Key features:
 * - Persists profiles to localStorage (excluding passwords)
 * - Stores passwords in secure storage (native Keychain/Keystore or encrypted in localStorage)
 * - Handles profile switching (session bootstrap); each profile's session,
 *   auth state, and query cache entries persist independently across a switch
 * - Manages app initialization state
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Profile, ProfileId } from '../api/types';
import { asProfileId, ALL_PROFILES_ID } from '../api/types';
import { getServerTimeZone } from '../api/time';
import { ProfileService } from '../services/profile';
import { log, LogLevel } from '../lib/logger';
import { setLogRedactionGate } from '../lib/log-sanitizer';
import { setProfileSettingsGate } from '../lib/profile/profile-settings';
import { getSession, dropSession, dropAllSessions, registerSessionsGate } from '../services/sessions';
import { registerServerResolverGate } from '../lib/zm/server-resolver';
import { STORAGE_KEYS } from '../lib/zmninja-ng-constants';
import { useAuthStore, getAuthSlice, registerAuthClientResolver } from './auth';
import { useSettingsStore } from './settings';
import { useMonitorSeenStore } from './monitorSeen';
import { performBootstrap } from '../services/profile-bootstrap';
import { handleProfileRehydration } from '../services/profile-initialization';

interface ProfileState {
  profiles: Profile[];
  currentProfileId: ProfileId | null;
  isInitialized: boolean;
  isBootstrapping: boolean;
  bootstrapStep: 'start' | 'auth' | 'timezone' | 'zms' | 'finalize' | null;

  // Computed
  profileExists: (name: string, excludeId?: string) => boolean;


  // Actions
  addProfile: (profile: Omit<Profile, 'id' | 'createdAt'>, id?: ProfileId) => Promise<string>;
  updateProfile: (id: string, updates: Partial<Profile>) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
  deleteAllProfiles: () => Promise<void>;
  switchProfile: (id: string) => Promise<void>;
  setDefaultProfile: (id: string) => void;
  cancelBootstrap: () => void;

  // Helpers
  getDecryptedPassword: (profileId: string) => Promise<string | undefined>;
}

let storeSet: ((partial: Partial<ProfileState>) => void) | null = null;
let storeGet: (() => ProfileState) | null = null;

export const useProfileStore = create<ProfileState>()(
  persist(
    (set, get) => {
      storeSet = set;
      storeGet = get;
      return {
        profiles: [],
        currentProfileId: null,
        isInitialized: false,
        isBootstrapping: false,
        bootstrapStep: null,

        /**
         * Check if a profile with the given name already exists.
         * Case-insensitive.
         */
        profileExists: (name, excludeId) => {
          const { profiles } = get();
          return profiles.some(
            (p) => p.name.toLowerCase() === name.toLowerCase() && p.id !== excludeId
          );
        },

        /**
         * Add a new profile.
         * 
         * Generates a UUID, encrypts the password (if provided), and adds to the list.
         * If it's the first profile, it becomes the default and current profile.
         */
        addProfile: async (profileData, id) => {
          // Check for duplicate names
          if (!ProfileService.validateNameAvailability(profileData.name, get().profiles)) {
            throw new Error(`Profile "${profileData.name}" already exists`);
          }

          // Boundary: this is where a profile id is minted, unless the caller
          // already minted one (e.g. ProfileForm testing the connection - and
          // therefore building the auth session - before this profile is
          // saved). Every ProfileId downstream (currentProfileId, query-key
          // cache scoping) traces back to this cast or the id passed in.
          // Refs #217, #337.
          const newProfileId = id ?? asProfileId(crypto.randomUUID());

          // Store password in secure storage (native keystore on mobile, encrypted on web)
          if (profileData.password) {
            await ProfileService.savePassword(newProfileId, profileData.password);
          }

          // Don't store password in Zustand state - it's in secure storage
          const newProfile: Profile = {
            ...profileData,
            password: profileData.password ? 'stored-securely' : undefined, // Flag indicating password exists
            id: newProfileId,
            createdAt: Date.now(),
          };

          set((state) => {
            // If this is the first profile, make it default
            const isFirst = state.profiles.length === 0;
            const profiles = [...state.profiles, newProfile];

            return {
              profiles,
              currentProfileId: isFirst ? newProfile.id : state.currentProfileId,
            };
          });

          // If this is now the current profile, ensure its session exists
          if (get().currentProfileId === newProfile.id) {
            // Fetch timezone for new profile
            try {
              // Get token from auth store state
              const { accessToken } = getAuthSlice(newProfile.id);
              const timezone = await getServerTimeZone(getSession(newProfile.id).client, accessToken || undefined);
              get().updateProfile(newProfile.id, { timezone });
            } catch (e) {
              log.profileService('Failed to fetch timezone for new profile', LogLevel.WARN, { error: e });
            }
          }

          return newProfileId;
        },

        /**
         * Update an existing profile.
         * 
         * Handles password updates by re-encrypting and storing in secure storage.
         * Drops the profile's cached session if its connection details changed.
         */
        updateProfile: async (id, updates) => {
          log.profileService(`updateProfile called for profile ID: ${id}`, LogLevel.INFO, updates);

          // Check for duplicate names if name is being updated
          if (updates.name && !ProfileService.validateNameAvailability(updates.name, get().profiles, id)) {
            throw new Error(`Profile "${updates.name}" already exists`);
          }

          // Store password in secure storage if provided
          const processedUpdates = { ...updates };
          if (updates.password) {
            await ProfileService.savePassword(id, updates.password);
            // Set flag instead of actual password
            processedUpdates.password = 'stored-securely';
          }

          set((state) => ({
            profiles: state.profiles.map((p) => (p.id === id ? { ...p, ...processedUpdates } : p)),
          }));

          // Connection details changed: evict the cached session so the next
          // getSession rebuilds it against the new URL/credentials. Refs #337.
          if (
            updates.apiUrl !== undefined ||
            updates.portalUrl !== undefined ||
            updates.cgiUrl !== undefined ||
            updates.username !== undefined ||
            updates.password !== undefined
          ) {
            dropSession(asProfileId(id));
          }

          log.profileService('updateProfile complete', LogLevel.INFO);
        },

        /**
         * Delete a profile.
         * 
         * Removes the profile from the list and deletes its password from secure storage.
         * If the current profile is deleted, switches to another available profile or null.
         */
        deleteProfile: async (id) => {
          // Remove password from secure storage
          await ProfileService.deletePassword(id);

          // Drop this profile's per-monitor seen-watermarks (refs #239)
          useMonitorSeenStore.getState().clearProfile(id);

          // Drop its cached session and clear its auth slice/persisted
          // refresh token - otherwise all three survive the profile's own
          // deletion. Refs #337.
          dropSession(asProfileId(id));
          useAuthStore.getState().logout(asProfileId(id));

          // Evict its query cache entries. Profile-scoped keys are the sole
          // cross-profile isolation now that switchProfile no longer clears
          // the whole cache (refs #337).
          const { removeProfileQueries } = await import('./query-cache');
          removeProfileQueries(asProfileId(id));

          set((state) => {
            const profiles = state.profiles.filter((p) => p.id !== id);
            const currentProfileId =
              state.currentProfileId === id
                ? profiles.length > 0
                  ? profiles[0].id
                  : null
                : state.currentProfileId;

            return { profiles, currentProfileId };
          });
        },

        /**
         * Delete all profiles.
         *
         * Clears all profiles and removes all passwords from secure storage.
         * Drops every cached session.
         */
        deleteAllProfiles: async () => {
          const { profiles } = get();

          // Remove all passwords from secure storage, and each profile's
          // per-monitor seen-watermarks (refs #239)
          for (const profile of profiles) {
            await ProfileService.deletePassword(profile.id);
            useMonitorSeenStore.getState().clearProfile(profile.id);
          }

          // Clear all profiles and reset state
          set({ profiles: [], currentProfileId: null });

          // Drop every cached session and clear every profile's auth slice
          // and persisted refresh token. Refs #337.
          dropAllSessions();
          useAuthStore.getState().logoutAll();

          log.profileService('All profiles deleted', LogLevel.INFO);
        },

        /**
         * Switch to a different profile.
         *
         * Performs a context switch:
         * 1. Quits the outgoing profile's active streams
         * 2. Sets new profile as current
         * 3. Ensures the new profile's session exists
         * 4. Runs bootstrap (auth, timezone, zms path, multi-port)
         *
         * Sessions are per-profile and persist across a switch: the outgoing
         * profile's auth state is left untouched (refs #337). The query
         * cache also survives a switch - profile-scoped query keys are the
         * isolation primitive, which keeps other profiles' data warm for
         * All mode. Includes rollback logic if switching fails.
         *
         * ALL_PROFILES_ID is a virtual aggregate, not a real server: it
         * skips the lookup below along with session/bootstrap/lastUsed.
         * Leaving ALL mode for a real profile has no single outgoing
         * profile to target, so it quits every stream via the same no-arg
         * call (refs #337).
         */
        switchProfile: async (id) => {
          if (id === ALL_PROFILES_ID) {
            log.profileService('Switching to All mode', LogLevel.INFO);
            const { quitAllActiveStreams } = await import('../lib/monitor/active-streams');
            await quitAllActiveStreams();
            set({ currentProfileId: ALL_PROFILES_ID });
            log.profileService('Switched to All mode', LogLevel.INFO);
            return;
          }

          const profile = get().profiles.find((p) => p.id === id);
          if (!profile) {
            throw new Error(`Profile ${id} not found`);
          }

          // Save previous profile for rollback
          const previousProfileId = get().currentProfileId;
          const previousProfile = previousProfileId
            ? get().profiles.find((p) => p.id === previousProfileId)
            : null;

          log.profileService('Starting profile switch', LogLevel.INFO, {
            from: previousProfile?.name || 'None',
            to: profile.name,
            targetPortal: profile.portalUrl,
            targetAPI: profile.apiUrl,
          });

          try {
            // STEP 0: Quit the previous profile's active streams while its SSL
            // trust and access token are still in effect, before the new
            // profile's SSL-trust flip, so a self-signed old server's
            // CMD_QUIT is not rejected, which would orphan its nph-zms. refs #188
            log.profileService('Step 0: Quitting previous profile streams', LogLevel.INFO);
            const { quitAllActiveStreams } = await import('../lib/monitor/active-streams');
            await quitAllActiveStreams();

            // STEP 1: Update current profile ID
            // Use profile.id (already a ProfileId) rather than the raw `id`
            // param so this assignment needs no cast.
            log.profileService('Step 1: Setting new profile as current', LogLevel.INFO);
            set({ currentProfileId: profile.id });

            // Update last used timestamp (don't await this)
            get().updateProfile(id, { lastUsed: Date.now() });

            // STEP 2: Ensure the new profile's session exists
            log.profileService('Step 2: Ensuring session', LogLevel.INFO, { apiUrl: profile.apiUrl });
            getSession(profile.id);
            log.profileService('Session ready', LogLevel.INFO);

            // STEP 3-5: Run bootstrap tasks (auth, timezone, zms path, multi-port)
            log.profileService('Step 3-5: Running bootstrap tasks', LogLevel.INFO);
            await performBootstrap(profile, {
              getDecryptedPassword: get().getDecryptedPassword,
              updateProfile: get().updateProfile,
            });

            log.profileService('Profile switch completed successfully', LogLevel.INFO, { currentProfile: profile.name });

          } catch (error) {
            log.profileService('Profile switch FAILED', LogLevel.ERROR, error);

            // ROLLBACK: Restore previous profile if it exists
            if (previousProfile) {
              log.profileService('Starting rollback to previous profile', LogLevel.INFO, {
                previousProfile: previousProfile.name,
              });

              try {
                // Clear the failed switch target's half-built auth state (not
                // the profile we're restoring to).
                const { useAuthStore } = await import('./auth');
                useAuthStore.getState().logout(profile.id);

                // Restore previous profile
                log.profileService('Restoring previous profile ID', LogLevel.INFO);
                set({ currentProfileId: previousProfileId });

                // Its session persisted through the failed switch; ensure it
                // still exists.
                log.profileService('Re-ensuring session for rollback profile', LogLevel.INFO, { apiUrl: previousProfile.apiUrl });
                getSession(previousProfile.id);

                // Run bootstrap for previous profile
                log.profileService('Running bootstrap for rollback profile', LogLevel.INFO);
                await performBootstrap(previousProfile, {
                  getDecryptedPassword: get().getDecryptedPassword,
                  updateProfile: get().updateProfile,
                });
                log.profileService('Rollback successful', LogLevel.INFO, { restoredTo: previousProfile.name });
              } catch (rollbackError) {
                log.profileService('Rollback FAILED - user may need to manually re-authenticate', LogLevel.ERROR, { rollbackError });
              }
            }

            // Re-throw the original error
            throw error;
          }
        }, setDefaultProfile: (id) => {
          set((state) => ({
            profiles: state.profiles.map((p) => ({
              ...p,
              isDefault: p.id === id,
            })),
          }));
        },

        /**
         * Cancel ongoing bootstrap and clear current profile.
         * Used when user wants to abort loading a profile that's taking too long.
         */
        cancelBootstrap: () => {
          log.profileService('Bootstrap cancelled by user', LogLevel.INFO);
          set({
            isBootstrapping: false,
            bootstrapStep: null,
            currentProfileId: null,
          });
        },

        /**
         * Retrieve decrypted password for a profile.
         * 
         * Fetches the encrypted password from secure storage and decrypts it.
         */
        getDecryptedPassword: async (profileId) => {
          const profile = get().profiles.find((p) => p.id === profileId);
          if (!profile?.password || profile.password !== 'stored-securely') {
            return undefined;
          }

          return ProfileService.getPassword(profileId);
        },
      };
    },
    {
      name: STORAGE_KEYS.profilesStore,
      // On load, ensure the current profile's session exists and authenticate
      // Complex initialization logic is extracted to services/profile-initialization.ts for maintainability
      onRehydrateStorage: () => {
        try {
          log.profileService('onRehydrateStorage: Zustand persist starting rehydration', LogLevel.INFO);
        } catch {
          // Logger might not be initialized in test environment
        }

        return async (state) => {
          try {
            // Ensure store references are available
            if (!storeSet || !storeGet) {
              throw new Error('Profile store not ready');
            }

            // Delegate to initialization module
            await handleProfileRehydration(state, storeSet, storeGet);
          } catch (error) {
            // CRITICAL: Catch any unexpected errors in onRehydrateStorage to prevent app from hanging
            try {
              log.profileService(
                'CRITICAL: Unexpected error in onRehydrateStorage - forcing initialization',
                LogLevel.ERROR,
                { error }
              );
            } catch {
              // Logger might not be initialized in test environment
            }
            // Force initialization to prevent hanging
            if (storeSet) {
              storeSet({ isInitialized: true, isBootstrapping: false, bootstrapStep: null });
            }
          }
        };
      },
    }
  )
);

// lib/log-sanitizer.ts has no store imports; this module assembles the real
// redaction check from the profile and settings stores and registers it here
// at load time, breaking the logger -> log-sanitizer -> profile store cycle.
// Refs #217.
setLogRedactionGate({
  isRedactionDisabled: () => {
    const { currentProfileId } = useProfileStore.getState();
    if (!currentProfileId) return false;
    return useSettingsStore.getState().getProfileSettings(currentProfileId).disableLogRedaction;
  },
});

// lib/profile/profile-settings.ts has no store imports for the same reason (it's
// imported by api/events.ts and other api modules downstream of this store).
// Refs #217.
setProfileSettingsGate({
  getExcludedMonitorIds: (profileId) => useSettingsStore.getState().getProfileSettings(profileId).excludedMonitorIds,
});

// services/sessions.ts has no store imports for the same reason (breaking a
// static import cycle back through this store). reLoginFor(id) looks up
// profile `id` fresh from state at call time (not the current profile) so a
// 401 on a non-current profile's session (aggregate readers) re-authenticates
// that profile against its own server with its own credentials. Refs #337.
//
// It also registers itself as that profile's setReLoginCallback the first
// time a session is built for it (getSession calls gate.reLoginFor(id)
// exactly once per profile, when the session isn't cached yet - refs #337).
// That is the ONLY registration path now: the old one in
// profile-initialization.ts registered just the rehydrated current profile,
// with a reLogin that only ever worked for the current profile, so
// getFreshAccessToken(B) in All mode had nothing to fall through to and
// couldn't self-heal an expired refresh token. Every profile that gets a
// session - current or not - now gets its own callback.
registerSessionsGate({
  getProfile: (id) => useProfileStore.getState().profiles.find((p) => p.id === id),
  getCurrentProfileId: () => useProfileStore.getState().currentProfileId,
  reLoginFor: (id) => {
    const doReLogin = async (): Promise<boolean> => {
      const profile = useProfileStore.getState().profiles.find((p) => p.id === id);
      if (!profile) {
        log.profileService('reLoginFor: profile not found', LogLevel.WARN, { profileId: id });
        return false;
      }

      // No credentials means no auth required (public server) - not a failure.
      if (!profile.username || !profile.password) return true;

      const password = await useProfileStore.getState().getDecryptedPassword(id);
      if (!password) {
        log.profileService('reLoginFor: no stored credentials', LogLevel.WARN, { profileId: id });
        return false;
      }

      try {
        await useAuthStore.getState().login(id, profile.username, password);
        return true;
      } catch (e) {
        log.profileService('reLoginFor failed', LogLevel.ERROR, { profileId: id, error: e });
        return false;
      }
    };

    useAuthStore.getState().setReLoginCallback(id, doReLogin);
    return doReLogin;
  },
});

// lib/zm/server-resolver.ts has no store imports for the same reason
// (getPortalUrlForMonitor/getPortalUrlForEvent are plain functions called
// from many components that already pass the profile they care about; an
// omitted profileId falls back to the current profile via this gate).
// Refs #337.
registerServerResolverGate({
  getCurrentProfileId: () => useProfileStore.getState().currentProfileId,
});

// stores/auth.ts's login/refreshAccessToken resolve their API client through
// this late-bound gate: getSession can't be imported there directly without
// cycling (services/sessions -> api/store-gates -> stores/auth). This module
// already imports both, so it wires them together. Refs #337.
registerAuthClientResolver((profileId) => getSession(profileId).client);

// Subscribe to auth store to update refresh token in profile
useAuthStore.subscribe((state) => {
  const { currentProfileId, updateProfile, profiles } = useProfileStore.getState();
  if (!currentProfileId) return;

  const refreshToken = state.slices[currentProfileId]?.refreshToken;
  if (currentProfileId && refreshToken) {
    const profile = profiles.find(p => p.id === currentProfileId);
    if (profile && profile.refreshToken !== refreshToken) {
      log.profileService('Updating profile with new refresh token', LogLevel.INFO, { profileId: currentProfileId });
      updateProfile(currentProfileId, { refreshToken });
    }
  }
});
