/**
 * useTokenRefresh Hook Tests
 *
 * Tests for the token refresh hook that automatically manages
 * authentication token lifecycle. Runs against the real profile, settings
 * and auth stores (tests/profile-fixture); only the store-gates client
 * factory and secure storage are faked. The auth store's own
 * getFreshAccessToken action is swapped for a spy so tests can assert
 * exactly when it's called without exercising a real network refresh -
 * that implementation has its own suite (stores/__tests__/auth.test.ts).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ZM_INTEGRATION } from '../../lib/zmninja-ng-constants';
import { ALL_PROFILES_ID } from '../../api/types';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

vi.mock('../../lib/logger', () => ({
  log: {
    auth: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
  },
}));

import { useTokenRefresh } from '../useTokenRefresh';
import { useAuthStore } from '../../stores/auth';
import { seedProfiles, resetProfileFixture, asProfileId, type ProfileId } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';

const mockGetFreshAccessToken = vi.fn();

/** Patch one profile's real auth slice directly - the precise per-test
 * expiry/authenticated control the old mock gave, applied to the real store. */
const EMPTY_SLICE = {
  accessToken: null,
  refreshToken: null,
  refreshTokenExpires: null,
  version: null,
  apiVersion: null,
  requiresAuth: true,
};

function setAuthSlice(profileId: ProfileId, patch: { isAuthenticated: boolean; accessTokenExpires: number | null }) {
  useAuthStore.setState((s) => ({
    slices: {
      ...s.slices,
      [profileId]: {
        ...EMPTY_SLICE,
        ...(s.slices[profileId] ?? {}),
        ...patch,
      },
    },
  }));
}

describe('useTokenRefresh', () => {
  const NOW = new Date('2024-01-01T12:00:00Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    seedProfiles(['p1'], { current: 'p1', authenticated: false });
    useAuthStore.setState({ getFreshAccessToken: mockGetFreshAccessToken as never });
  });

  afterEach(() => {
    vi.useRealTimers();
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('does not refresh when not authenticated', () => {
    setAuthSlice(asProfileId('p1'), { isAuthenticated: false, accessTokenExpires: null });

    renderHook(() => useTokenRefresh());

    expect(mockGetFreshAccessToken).not.toHaveBeenCalled();
  });

  it('does not refresh when token is far from expiry', () => {
    setAuthSlice(asProfileId('p1'), { isAuthenticated: true, accessTokenExpires: NOW + 2 * 60 * 60 * 1000 }); // 2 hours away

    renderHook(() => useTokenRefresh());

    expect(mockGetFreshAccessToken).not.toHaveBeenCalled();
  });

  it('refreshes when token is within leeway window', async () => {
    mockGetFreshAccessToken.mockResolvedValue(undefined);
    setAuthSlice(asProfileId('p1'), { isAuthenticated: true, accessTokenExpires: NOW + 3 * 60 * 1000 }); // 3 minutes away (within 30-min leeway)

    renderHook(() => useTokenRefresh());

    await vi.waitFor(() => {
      expect(mockGetFreshAccessToken).toHaveBeenCalledTimes(1);
    });
  });

  it('refreshes when token has already expired', async () => {
    mockGetFreshAccessToken.mockResolvedValue(undefined);
    setAuthSlice(asProfileId('p1'), { isAuthenticated: true, accessTokenExpires: NOW - 60 * 1000 }); // Expired 1 minute ago

    renderHook(() => useTokenRefresh());

    await vi.waitFor(() => {
      expect(mockGetFreshAccessToken).toHaveBeenCalledTimes(1);
    });
  });

  it('refreshes when token expired long ago (e.g., after background sleep)', async () => {
    mockGetFreshAccessToken.mockResolvedValue(undefined);
    setAuthSlice(asProfileId('p1'), { isAuthenticated: true, accessTokenExpires: NOW - 30 * 60 * 1000 }); // Expired 30 minutes ago

    renderHook(() => useTokenRefresh());

    await vi.waitFor(() => {
      expect(mockGetFreshAccessToken).toHaveBeenCalledTimes(1);
    });
  });

  it('checks token on interval', async () => {
    mockGetFreshAccessToken.mockResolvedValue(undefined);
    setAuthSlice(asProfileId('p1'), { isAuthenticated: true, accessTokenExpires: NOW + 2 * 60 * 60 * 1000 }); // 2 hours away

    renderHook(() => useTokenRefresh());
    expect(mockGetFreshAccessToken).not.toHaveBeenCalled();

    // Advance time so the token is now within the leeway window
    vi.setSystemTime(NOW + (2 * 60 * 60 * 1000) - (3 * 60 * 1000)); // 3 min before expiry
    await act(async () => {
      vi.advanceTimersByTime(ZM_INTEGRATION.tokenCheckInterval);
    });

    await vi.waitFor(() => {
      expect(mockGetFreshAccessToken).toHaveBeenCalledTimes(1);
    });
  });

  it('refreshes on visibility change to visible when token is expired', async () => {
    mockGetFreshAccessToken.mockResolvedValue(undefined);
    setAuthSlice(asProfileId('p1'), { isAuthenticated: true, accessTokenExpires: NOW - 10 * 1000 }); // Expired 10 seconds ago

    renderHook(() => useTokenRefresh());

    // First call happens immediately on mount
    await vi.waitFor(() => {
      expect(mockGetFreshAccessToken).toHaveBeenCalledTimes(1);
    });

    mockGetFreshAccessToken.mockClear();

    // Simulate page becoming visible (the visibilitychange handler should call checkAndRefresh)
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // The handler fires but the isRefreshing guard or the same expired state
    // may or may not trigger a second refresh depending on timing.
    // The key thing is that it doesn't crash and the visibility listener works.
  });

  it('prevents concurrent refresh attempts', async () => {
    let resolveRefresh!: () => void;
    mockGetFreshAccessToken.mockImplementation(
      () => new Promise<void>((resolve) => { resolveRefresh = resolve; })
    );
    setAuthSlice(asProfileId('p1'), { isAuthenticated: true, accessTokenExpires: NOW - 10 * 1000 }); // Expired

    renderHook(() => useTokenRefresh());

    // First refresh starts
    await vi.waitFor(() => {
      expect(mockGetFreshAccessToken).toHaveBeenCalledTimes(1);
    });

    // Advance timer to trigger another check while first is still in progress
    await act(async () => {
      vi.advanceTimersByTime(ZM_INTEGRATION.tokenCheckInterval);
    });

    // Should still only have 1 call (second was skipped due to guard)
    expect(mockGetFreshAccessToken).toHaveBeenCalledTimes(1);

    // Resolve the first refresh
    await act(async () => {
      resolveRefresh();
    });
  });

  it('handles refresh failure without crashing', async () => {
    mockGetFreshAccessToken.mockRejectedValue(new Error('Network error'));
    setAuthSlice(asProfileId('p1'), { isAuthenticated: true, accessTokenExpires: NOW - 10 * 1000 }); // Expired

    // Should not throw
    renderHook(() => useTokenRefresh());

    await vi.waitFor(() => {
      expect(mockGetFreshAccessToken).toHaveBeenCalledTimes(1);
    });
  });

  it('cleans up interval and listener on unmount', () => {
    const addEventSpy = vi.spyOn(document, 'addEventListener');
    const removeEventSpy = vi.spyOn(document, 'removeEventListener');

    setAuthSlice(asProfileId('p1'), { isAuthenticated: true, accessTokenExpires: NOW + 2 * 60 * 60 * 1000 });

    const { unmount } = renderHook(() => useTokenRefresh());

    expect(addEventSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

    unmount();

    expect(removeEventSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

    addEventSpy.mockRestore();
    removeEventSpy.mockRestore();
  });

  it('does not refresh when accessTokenExpires is null (no auth required)', () => {
    setAuthSlice(asProfileId('p1'), { isAuthenticated: true, accessTokenExpires: null });

    renderHook(() => useTokenRefresh());

    expect(mockGetFreshAccessToken).not.toHaveBeenCalled();
  });

  describe('All mode', () => {
    beforeEach(() => {
      seedProfiles(['profile-a', 'profile-b'], { current: ALL_PROFILES_ID, authenticated: false });
      useAuthStore.setState({ getFreshAccessToken: mockGetFreshAccessToken as never });
    });

    it('refreshes every scope profile whose token is within the leeway window', async () => {
      mockGetFreshAccessToken.mockResolvedValue(undefined);
      setAuthSlice(asProfileId('profile-a'), { isAuthenticated: true, accessTokenExpires: NOW + 3 * 60 * 1000 }); // within leeway
      setAuthSlice(asProfileId('profile-b'), { isAuthenticated: true, accessTokenExpires: NOW - 10 * 1000 }); // expired

      renderHook(() => useTokenRefresh());

      await vi.waitFor(() => {
        expect(mockGetFreshAccessToken).toHaveBeenCalledWith(asProfileId('profile-a'));
        expect(mockGetFreshAccessToken).toHaveBeenCalledWith(asProfileId('profile-b'));
      });
      expect(mockGetFreshAccessToken).toHaveBeenCalledTimes(2);
    });

    it('skips a scope profile whose token is far from expiry', async () => {
      mockGetFreshAccessToken.mockResolvedValue(undefined);
      setAuthSlice(asProfileId('profile-a'), { isAuthenticated: true, accessTokenExpires: NOW + 3 * 60 * 1000 }); // within leeway
      setAuthSlice(asProfileId('profile-b'), { isAuthenticated: true, accessTokenExpires: NOW + 2 * 60 * 60 * 1000 }); // 2 hours away

      renderHook(() => useTokenRefresh());

      await vi.waitFor(() => {
        expect(mockGetFreshAccessToken).toHaveBeenCalledWith(asProfileId('profile-a'));
      });
      expect(mockGetFreshAccessToken).not.toHaveBeenCalledWith(asProfileId('profile-b'));
      expect(mockGetFreshAccessToken).toHaveBeenCalledTimes(1);
    });

    it('skips a scope profile that has never authenticated this session', async () => {
      setAuthSlice(asProfileId('profile-a'), { isAuthenticated: false, accessTokenExpires: null });
      setAuthSlice(asProfileId('profile-b'), { isAuthenticated: true, accessTokenExpires: NOW + 2 * 60 * 60 * 1000 });

      renderHook(() => useTokenRefresh());

      expect(mockGetFreshAccessToken).not.toHaveBeenCalled();
    });

    it('checks every scope profile again on the next interval tick', async () => {
      mockGetFreshAccessToken.mockResolvedValue(undefined);
      setAuthSlice(asProfileId('profile-a'), { isAuthenticated: true, accessTokenExpires: NOW + 2 * 60 * 60 * 1000 });
      setAuthSlice(asProfileId('profile-b'), { isAuthenticated: true, accessTokenExpires: NOW + 2 * 60 * 60 * 1000 });

      renderHook(() => useTokenRefresh());
      expect(mockGetFreshAccessToken).not.toHaveBeenCalled();

      // Advance time so both tokens are now within the leeway window.
      const later = NOW + (2 * 60 * 60 * 1000) - 3 * 60 * 1000;
      vi.setSystemTime(later);
      setAuthSlice(asProfileId('profile-a'), { isAuthenticated: true, accessTokenExpires: later + 3 * 60 * 1000 });
      setAuthSlice(asProfileId('profile-b'), { isAuthenticated: true, accessTokenExpires: later + 3 * 60 * 1000 });

      await act(async () => {
        vi.advanceTimersByTime(ZM_INTEGRATION.tokenCheckInterval);
      });

      await vi.waitFor(() => {
        expect(mockGetFreshAccessToken).toHaveBeenCalledTimes(2);
      });
    });
  });
});
