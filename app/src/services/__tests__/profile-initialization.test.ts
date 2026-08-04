/**
 * handleProfileRehydration used to fall into the "profile not found" ERROR
 * branch for the ALL_PROFILES_ID sentinel (profiles.find never matches a
 * virtual id), which also skipped bootstrap for every real profile with no
 * indication why. Refs #337: the sentinel now short-circuits to a plain
 * initialized state with an INFO log, same as the no-profile case.
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

describe('handleProfileRehydration', () => {
  beforeEach(() => {
    logSpy.mockClear();
  });

  it('treats the All Profiles sentinel as initialized, skips bootstrap, and logs no ERROR', async () => {
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

    expect(storeSet).toHaveBeenCalledWith(
      expect.objectContaining({ isInitialized: true, isBootstrapping: false })
    );
    // storeGet is only reached by the real-profile bootstrap path.
    expect(storeGet).not.toHaveBeenCalled();
    const errorCalls = logSpy.mock.calls.filter(([, level]) => level === 3);
    expect(errorCalls).toEqual([]);
  });

  it('treats a virtual profile the same way, with no ERROR (refs #337)', async () => {
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
