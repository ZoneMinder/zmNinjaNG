/**
 * handleProfileRehydration used to fall into the "profile not found" ERROR
 * branch for an aggregate id (profiles.find never matches one), which also
 * skipped bootstrap for every real profile with no indication why. Refs #337:
 * a virtual profile now short-circuits to a plain initialized state with an
 * INFO log, same as the no-profile case.
 *
 * The ALL_PROFILES_ID sentinel is the other half: it is retired from the UI,
 * so a persisted one is pre-retirement state that has to be migrated away
 * rather than restored - nothing can switch back into it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { handleProfileRehydration } from '../profile-initialization';
import { ALL_PROFILES_ID, asProfileId, mintVirtualProfileId } from '../../api/types';

const logSpy = vi.fn();

vi.mock('../../lib/logger', () => ({
  log: { profileService: (...args: unknown[]) => logSpy(...args) },
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 },
}));

vi.mock('../sessions', () => ({
  getSession: vi.fn(),
}));

const removeProfileSettings = vi.fn();
const clearDashboardProfile = vi.fn();

vi.mock('../../stores/settings', () => ({
  useSettingsStore: { getState: () => ({ removeProfileSettings }) },
}));

vi.mock('../../stores/dashboard', () => ({
  useDashboardStore: { getState: () => ({ clearProfile: clearDashboardProfile }) },
}));

vi.mock('../../stores/auth', () => ({
  useAuthStore: { getState: () => ({ logout: vi.fn() }) },
}));

vi.mock('../../stores/query-cache', () => ({
  clearQueryCache: vi.fn(),
}));

// The real-profile arm below is only here to prove it writes nothing; its
// bootstrap would otherwise reach the network.
vi.mock('../profile-bootstrap', () => ({
  performBootstrap: vi.fn().mockResolvedValue(undefined),
}));

describe('handleProfileRehydration', () => {
  beforeEach(() => {
    logSpy.mockClear();
    removeProfileSettings.mockClear();
    clearDashboardProfile.mockClear();
  });

  // I2: this rewrites persisted user state, so it has to be exact - the
  // selection resets, the two buckets only that selection could own go, and
  // nothing else is touched.
  it('resets a persisted All Servers selection to no profile and deletes its buckets', async () => {
    const storeSet = vi.fn();
    const storeGet = vi.fn();

    await handleProfileRehydration(
      {
        profiles: [],
        currentProfileId: ALL_PROFILES_ID,
        isInitialized: false,
        isBootstrapping: false,
        bootstrapStep: null,
        getDecryptedPassword: vi.fn(),
        updateProfile: vi.fn(),
      },
      storeSet,
      storeGet
    );

    expect(storeSet).toHaveBeenCalledWith(expect.objectContaining({ currentProfileId: null }));
    expect(removeProfileSettings).toHaveBeenCalledWith(ALL_PROFILES_ID);
    expect(clearDashboardProfile).toHaveBeenCalledWith(ALL_PROFILES_ID);
    // Once per rehydrate, not once per store read.
    expect(removeProfileSettings).toHaveBeenCalledTimes(1);
    expect(clearDashboardProfile).toHaveBeenCalledTimes(1);
    expect(storeSet).toHaveBeenCalledWith(
      expect.objectContaining({ isInitialized: true, isBootstrapping: false })
    );
    expect(logSpy.mock.calls.filter(([, level]) => level === 3)).toEqual([]);
  });

  it('writes nothing for a user who never used All mode (refs #337)', async () => {
    const profile = {
      id: asProfileId('p1'),
      name: 'Home',
      apiUrl: 'http://a',
      portalUrl: 'http://a',
      cgiUrl: 'http://a/cgi-bin',
      isDefault: true,
      createdAt: 1,
    };
    const storeGet = vi.fn(() => ({
      getDecryptedPassword: vi.fn(),
      updateProfile: vi.fn(),
      isBootstrapping: false,
    }));

    for (const currentProfileId of [profile.id, mintVirtualProfileId(), null]) {
      await handleProfileRehydration(
        {
          profiles: [profile],
          currentProfileId,
          isInitialized: false,
          isBootstrapping: false,
          bootstrapStep: null,
          getDecryptedPassword: vi.fn(),
          updateProfile: vi.fn(),
        },
        vi.fn(),
        storeGet as never
      );
    }

    expect(removeProfileSettings).not.toHaveBeenCalled();
    expect(clearDashboardProfile).not.toHaveBeenCalled();
  });

  it('treats a virtual profile as initialized, skipping bootstrap, with no ERROR (refs #337)', async () => {
    // A virtual id matches no profile either, so without the guard it lands
    // in the "profile not found" ERROR branch, which also skips bootstrap for
    // every real profile with no indication why.
    const storeSet = vi.fn();
    const storeGet = vi.fn();

    await handleProfileRehydration(
      {
        profiles: [],
        currentProfileId: mintVirtualProfileId(),
        isInitialized: false,
        isBootstrapping: false,
        bootstrapStep: null,
        getDecryptedPassword: vi.fn(),
        updateProfile: vi.fn(),
      },
      storeSet,
      storeGet
    );

    expect(storeSet).toHaveBeenCalledWith(
      expect.objectContaining({ isInitialized: true, isBootstrapping: false })
    );
    expect(storeGet).not.toHaveBeenCalled();
    expect(logSpy.mock.calls.filter(([, level]) => level === 3)).toEqual([]);
  });

  it('still logs ERROR for a real unknown-profile id (regression guard)', async () => {
    const storeSet = vi.fn();
    const storeGet = vi.fn();

    await handleProfileRehydration(
      {
        profiles: [],
        currentProfileId: asProfileId('missing-profile'),
        isInitialized: false,
        isBootstrapping: false,
        bootstrapStep: null,
        getDecryptedPassword: vi.fn(),
        updateProfile: vi.fn(),
      },
      storeSet,
      storeGet
    );

    const errorCalls = logSpy.mock.calls.filter(([, level]) => level === 3);
    expect(errorCalls.length).toBeGreaterThan(0);
    expect(storeSet).toHaveBeenCalledWith(
      expect.objectContaining({ isInitialized: true, isBootstrapping: false })
    );
  });
});
