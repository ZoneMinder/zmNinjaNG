/**
 * Regression test for the Task 6 review's Critical finding: hasActiveSession
 * (stores/auth.ts's getFreshAccessToken cold-start guard) was never true in
 * the running app, because markSessionActive was only called from
 * services/sessions.ts's getSession, which had zero non-test callers until
 * Task 8. The fix wires markSessionActive into the legacy bootstrap call
 * sites that actually build the live client today
 * (services/profile-initialization.ts, stores/profile.ts). This file proves
 * the underlying mechanism directly: unlike stores/__tests__/auth.test.ts,
 * it does NOT mock services/session-flags, so it exercises the real
 * markSessionActive <-> hasActiveSession wiring stores/auth.ts depends on.
 * Refs #337.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../auth';
import { login as apiLogin, refreshToken as apiRefreshToken } from '../../api/auth';
import { asProfileId } from '../../api/types';
import { markAllSessionsInactive, markSessionActive } from '../../services/session-flags';

vi.mock('../../api/auth', () => ({
  login: vi.fn(),
  refreshToken: vi.fn(),
}));

vi.mock('../../lib/logger', () => ({
  log: { auth: vi.fn() },
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 },
}));

const pid = asProfileId('wiring-profile');

describe('getFreshAccessToken <-> session-flags wiring (unmocked)', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ slices: {} });
    markAllSessionsInactive();
    vi.clearAllMocks();
  });

  it('returns null before markSessionActive has ever run for the profile', async () => {
    useAuthStore.setState({
      slices: {
        [pid]: {
          accessToken: 'stale',
          refreshToken: 'rt',
          accessTokenExpires: Date.now() + 60_000,
          refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000,
          version: null,
          apiVersion: null,
          isAuthenticated: true,
          requiresAuth: true,
        },
      },
    });

    const result = await useAuthStore.getState().getFreshAccessToken(pid);

    expect(result).toBeNull();
    expect(apiRefreshToken).not.toHaveBeenCalled();
  });

  it('proceeds past the guard and returns a refreshed token once markSessionActive has run for the profile (simulating bootstrap wiring)', async () => {
    useAuthStore.setState({
      slices: {
        [pid]: {
          accessToken: 'stale',
          refreshToken: 'rt',
          accessTokenExpires: Date.now() + 60_000, // within the leeway: needs a refresh
          refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000,
          version: null,
          apiVersion: null,
          isAuthenticated: true,
          requiresAuth: true,
        },
      },
    });
    vi.mocked(apiRefreshToken).mockResolvedValue({
      access_token: 'fresh-token',
      access_token_expires: 7200,
    });

    // The same call services/profile-initialization.ts's initializeApiClient
    // (and stores/profile.ts's legacy client-creation sites) now make.
    markSessionActive(pid);

    const result = await useAuthStore.getState().getFreshAccessToken(pid);

    expect(result).toBe('fresh-token');
    expect(apiRefreshToken).toHaveBeenCalledWith('rt');
  });

  it('never calls login through this path when there is no session (no false proactive attempts)', async () => {
    useAuthStore.setState({
      slices: {
        [pid]: {
          accessToken: null,
          refreshToken: 'rt',
          accessTokenExpires: null,
          refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000,
          version: null,
          apiVersion: null,
          isAuthenticated: true,
          requiresAuth: true,
        },
      },
    });

    await useAuthStore.getState().getFreshAccessToken(pid);

    expect(apiLogin).not.toHaveBeenCalled();
    expect(apiRefreshToken).not.toHaveBeenCalled();
  });
});
