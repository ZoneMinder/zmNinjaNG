/**
 * Profile Store Initialization
 *
 * Handles profile store rehydration from localStorage and initial app bootstrap.
 * This module is separated from profile.ts to reduce complexity and improve maintainability.
 *
 * The initialization process:
 * 1. Rehydrate profile data from localStorage (handled by Zustand persist middleware)
 * 2. Clear stale auth and cache
 * 3. Initialize API client with current profile
 * 4. Run bootstrap tasks (auth, timezone, zms path, multi-port) in background
 * 5. Set initialization flags to allow UI to render
 */

import { ALL_PROFILES_ID, type Profile, type ProfileId } from '../api/types';
import { getSession } from './sessions';
import { log, LogLevel } from '../lib/logger';
import { BOOTSTRAP_TIMEOUTS } from '../lib/zmninja-ng-constants';
import { performBootstrap, type BootstrapContext } from './profile-bootstrap';

function safeLog(message: string, level: LogLevel, details?: Record<string, unknown>) {
  try { log.profileService(message, level, details); } catch { /* Logger may not be initialized in test env */ }
}

interface ProfileState {
  profiles: Profile[];
  currentProfileId: ProfileId | null;
  isInitialized: boolean;
  isBootstrapping: boolean;
  bootstrapStep: 'start' | 'auth' | 'timezone' | 'zms' | 'finalize' | null;
  getDecryptedPassword: (profileId: string) => Promise<string | undefined>;
  updateProfile: (id: string, updates: Partial<Profile>) => Promise<void>;
}

/**
 * Wraps a promise with a timeout to prevent hanging
 */
async function withTimeout<T>(
  label: string,
  promise: Promise<T>,
  timeoutMs: number = BOOTSTRAP_TIMEOUTS.stepTimeoutMs
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Logs operation duration with context
 */
function logDuration(
  message: string,
  startTime: number,
  context: Record<string, unknown> = {}
): void {
  log.profileService(message, LogLevel.INFO, {
    ...context,
    durationMs: Date.now() - startTime,
  });
}

/**
 * Sets initialization state flags
 */
function setInitializationState(
  storeSet: (partial: Partial<ProfileState>) => void,
  bootstrapping: boolean
): void {
  storeSet({
    isBootstrapping: bootstrapping,
    isInitialized: true,
    bootstrapStep: bootstrapping ? 'start' : null,
  });
}

/**
 * Clears stale authentication and cache data
 */
async function clearStaleState(profileId: ProfileId): Promise<void> {
  const clearStart = Date.now();
  log.profileService('Clearing stale auth and cache', LogLevel.INFO);

  const { useAuthStore } = await import('../stores/auth');
  useAuthStore.getState().logout(profileId);

  const { clearQueryCache } = await import('../stores/query-cache');
  clearQueryCache();

  logDuration('Bootstrap step: cleared auth and cache', clearStart);
}

/**
 * Ensures the given profile's session exists. getSession's own construction
 * path registers this profile's credentials reLogin into the auth store
 * (services/sessions.ts's gate -> stores/profile.ts's reLoginFor(id)), so
 * getFreshAccessToken can fall through to it when refresh fails - no
 * separate registration needed here. Refs #337.
 */
async function initializeApiClient(profile: Profile): Promise<void> {
  const apiClientStart = Date.now();
  log.profileService('Ensuring session', LogLevel.INFO, {
    apiUrl: profile.apiUrl,
  });

  getSession(profile.id);

  logDuration('Bootstrap step: session ready', apiClientStart, {
    apiUrl: profile.apiUrl,
  });
}

/**
 * Runs bootstrap tasks in background with timeout protection
 */
async function runBootstrapTasks(
  profile: Profile,
  bootstrapContext: BootstrapContext,
  storeSet: (partial: Partial<ProfileState>) => void,
  storeGet: () => ProfileState,
  bootstrapStart: number
): Promise<void> {
  let overallTimeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    // Set overall timeout to prevent bootstrap from hanging forever
    overallTimeoutId = setTimeout(() => {
      if (storeGet().isBootstrapping) {
        log.profileService(
          'Profile bootstrap exceeded timeout; allowing UI to continue',
          LogLevel.WARN,
          { timeoutMs: BOOTSTRAP_TIMEOUTS.totalTimeoutMs }
        );
        storeSet({ isBootstrapping: false, bootstrapStep: null });
      }
    }, BOOTSTRAP_TIMEOUTS.totalTimeoutMs);

    storeSet({ bootstrapStep: 'start' });
    log.profileService('Running bootstrap tasks on app load', LogLevel.INFO);

    // Run all bootstrap steps with timeout protection
    await withTimeout(
      'Bootstrap tasks',
      performBootstrap(profile, bootstrapContext),
      BOOTSTRAP_TIMEOUTS.totalTimeoutMs
    );

    storeSet({ bootstrapStep: 'finalize' });
  } finally {
    logDuration('Profile bootstrap completed', bootstrapStart, {
      profileId: profile.id,
    });
    if (overallTimeoutId) {
      clearTimeout(overallTimeoutId);
    }
    storeSet({ isBootstrapping: false, bootstrapStep: null });
  }
}

/**
 * Main rehydration handler called by Zustand persist middleware
 *
 * This is invoked when the app loads and profile data is restored from localStorage.
 * It handles initialization in a non-blocking way to prevent UI from hanging.
 */
export async function handleProfileRehydration(
  state: ProfileState | undefined,
  storeSet: (partial: Partial<ProfileState>) => void,
  storeGet: () => ProfileState
): Promise<void> {
  const bootstrapStart = Date.now();

  safeLog('onRehydrateStorage called', LogLevel.INFO, {
    hasState: !!state,
    currentProfileId: state?.currentProfileId,
  });

  // Case 1: No profile exists - just mark as initialized
  if (!state?.currentProfileId) {
    safeLog('No current profile found on app load', LogLevel.INFO, { state });
    setInitializationState(storeSet, false);
    safeLog('isInitialized set to true (no profile)', LogLevel.INFO);
    return;
  }

  // Case 2: The All Profiles virtual sentinel - no single profile to
  // bootstrap. Each real profile's own aggregate query (useScopedMonitors)
  // self-heals its own auth on first fetch, so there is nothing to do here
  // beyond marking the app initialized. Refs #337.
  if (state.currentProfileId === ALL_PROFILES_ID) {
    safeLog('App loading in All Profiles mode; skipping single-profile bootstrap', LogLevel.INFO);
    setInitializationState(storeSet, false);
    return;
  }

  // Case 3: Profile ID exists but profile not found - error case
  const profile = state.profiles.find((p) => p.id === state.currentProfileId);
  if (!profile) {
    safeLog('Current profile ID exists but profile not found', LogLevel.ERROR, {
      profileId: state.currentProfileId,
    });
    // Set isInitialized even on error to prevent hanging
    setInitializationState(storeSet, false);
    return;
  }

  safeLog('App loading with profile', LogLevel.INFO, {
    name: profile.name,
    id: profile.id,
    portalUrl: profile.portalUrl,
    apiUrl: profile.apiUrl,
    cgiUrl: profile.cgiUrl,
    username: profile.username || '(not set)',
    hasPassword: !!profile.password,
    passwordLength: profile.password?.length,
    isDefault: profile.isDefault,
    createdAt: new Date(profile.createdAt).toLocaleString(),
    lastUsed: profile.lastUsed
      ? new Date(profile.lastUsed).toLocaleString()
      : 'never',
  });

  // Case 4: Valid profile - perform initialization and bootstrap
  try {
    // Clear stale state from previous session
    await clearStaleState(profile.id);

    // Initialize API client
    await initializeApiClient(profile);
  } catch (error) {
    log.profileService(
      'Profile bootstrap failed during early initialization',
      LogLevel.ERROR,
      error
    );
    setInitializationState(storeSet, false);
    return;
  }

  // Mark as initialized and bootstrapping
  setInitializationState(storeSet, true);

  // Run bootstrap tasks in background (non-blocking)
  const bootstrapContext: BootstrapContext = {
    getDecryptedPassword: storeGet().getDecryptedPassword,
    updateProfile: storeGet().updateProfile,
  };

  // Run bootstrap tasks asynchronously (don't await)
  void runBootstrapTasks(
    profile,
    bootstrapContext,
    storeSet,
    storeGet,
    bootstrapStart
  );
}
