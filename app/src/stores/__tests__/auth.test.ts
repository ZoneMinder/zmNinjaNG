import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { resetAuthGates, useAuthStore, getAuthSlice, registerAuthClientResolver } from '../auth';
import { login as apiLogin, refreshToken as apiRefreshToken } from '../../api/auth';
import type { ApiClient } from '../../api/client';
import type { LoginResponse } from '../../api/types';
import { asProfileId } from '../../api/types';
import { log } from '../../lib/logger';

vi.mock('../../api/auth', () => ({
  login: vi.fn(),
  refreshToken: vi.fn(),
}));

// getFreshAccessToken skips refreshing until the profile has a session. Default
// to a session existing for the existing tests; the cold-start test flips it off.
const sessionState = vi.hoisted(() => ({ hasSession: true }));
vi.mock('../../services/session-flags', () => ({
  hasActiveSession: () => sessionState.hasSession,
}));

vi.mock('../../lib/logger', () => ({
  log: {
    auth: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
  },
}));

const aId = asProfileId('profile-a');
const bId = asProfileId('profile-b');
const mockClient = {} as ApiClient;

describe('Auth Store', () => {
  beforeEach(() => {
    // login/refreshAccessToken resolve their client through this gate
    // (services/sessions.ts's getSession, normally wired by stores/profile.ts
    // - not loaded here). Refs #337.
    registerAuthClientResolver(() => mockClient);
    localStorage.clear();
    useAuthStore.setState({ slices: {} });
    sessionState.hasSession = true;
    resetAuthGates();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('logs in and sets tokens', async () => {
    const response = {
      access_token: 'access-123',
      refresh_token: 'refresh-456',
      access_token_expires: 60,
      refresh_token_expires: 120,
      version: '1.0.0',
      apiversion: '2.0.0',
    };

    vi.mocked(apiLogin).mockResolvedValue(response);

    await useAuthStore.getState().login(aId, 'user', 'pass');

    expect(apiLogin).toHaveBeenCalledWith(expect.anything(), { user: 'user', pass: 'pass' });
    const state = getAuthSlice(aId);
    expect(state.accessToken).toBe('access-123');
    expect(state.refreshToken).toBe('refresh-456');
    expect(state.accessTokenExpires).toBe(Date.now() + 60 * 1000);
    expect(state.refreshTokenExpires).toBe(Date.now() + 120 * 1000);
    expect(state.version).toBe('1.0.0');
    expect(state.apiVersion).toBe('2.0.0');
    expect(state.isAuthenticated).toBe(true);
  });

  it('retains refresh token when access token only is returned', () => {
    useAuthStore.setState({
      slices: {
        [aId]: {
          accessToken: null,
          refreshToken: 'existing-refresh',
          accessTokenExpires: null,
          refreshTokenExpires: Date.now() + 5000,
          version: '0.9.0',
          apiVersion: '1.9.0',
          isAuthenticated: false,
          requiresAuth: true,
        },
      },
    });

    useAuthStore.getState().setTokens(aId, {
      access_token: 'new-access',
      access_token_expires: 10,
    });

    const state = getAuthSlice(aId);
    expect(state.accessToken).toBe('new-access');
    expect(state.refreshToken).toBe('existing-refresh');
    expect(state.refreshTokenExpires).toBe(Date.now() + 5000);
    expect(state.version).toBe('0.9.0');
    expect(state.apiVersion).toBe('1.9.0');
  });

  it('refreshes access token successfully', async () => {
    useAuthStore.setState({
      slices: {
        [aId]: {
          accessToken: null,
          refreshToken: 'refresh-xyz',
          accessTokenExpires: null,
          refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000,
          version: null,
          apiVersion: null,
          isAuthenticated: false,
          requiresAuth: true,
        },
      },
    });

    vi.mocked(apiRefreshToken).mockResolvedValue({
      access_token: 'new-access',
      access_token_expires: 30,
    });

    await useAuthStore.getState().refreshAccessToken(aId);

    expect(apiRefreshToken).toHaveBeenCalledWith(expect.anything(), 'refresh-xyz');
    expect(getAuthSlice(aId).accessToken).toBe('new-access');
  });

  it('logs out on refresh failure', async () => {
    useAuthStore.setState({
      slices: {
        [aId]: {
          accessToken: 'old-access',
          refreshToken: 'refresh-xyz',
          accessTokenExpires: null,
          refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000,
          version: null,
          apiVersion: null,
          isAuthenticated: true,
          requiresAuth: true,
        },
      },
    });

    vi.mocked(apiRefreshToken).mockRejectedValue(new Error('refresh failed'));

    await expect(useAuthStore.getState().refreshAccessToken(aId)).rejects.toThrow('refresh failed');

    const state = getAuthSlice(aId);
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('clears state on logout', () => {
    useAuthStore.setState({
      slices: {
        [aId]: {
          accessToken: 'access',
          refreshToken: 'refresh',
          accessTokenExpires: Date.now() + 1000,
          refreshTokenExpires: Date.now() + 2000,
          version: '1.0.0',
          apiVersion: '2.0.0',
          isAuthenticated: true,
          requiresAuth: true,
        },
      },
    });

    useAuthStore.getState().logout(aId);

    const state = getAuthSlice(aId);
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.accessTokenExpires).toBeNull();
    expect(state.refreshTokenExpires).toBeNull();
    expect(state.version).toBeNull();
    expect(state.apiVersion).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('logout(A) clears only A', () => {
    useAuthStore.setState({
      slices: {
        [aId]: {
          accessToken: 'a-access',
          refreshToken: 'a-refresh',
          accessTokenExpires: Date.now() + 1000,
          refreshTokenExpires: Date.now() + 2000,
          version: null,
          apiVersion: null,
          isAuthenticated: true,
          requiresAuth: true,
        },
        [bId]: {
          accessToken: 'b-access',
          refreshToken: 'b-refresh',
          accessTokenExpires: Date.now() + 1000,
          refreshTokenExpires: Date.now() + 2000,
          version: null,
          apiVersion: null,
          isAuthenticated: true,
          requiresAuth: true,
        },
      },
    });

    useAuthStore.getState().logout(aId);

    expect(getAuthSlice(aId).isAuthenticated).toBe(false);
    expect(getAuthSlice(bId).isAuthenticated).toBe(true);
    expect(getAuthSlice(bId).accessToken).toBe('b-access');
  });

  it('logoutAll clears every profile', () => {
    useAuthStore.setState({
      slices: {
        [aId]: {
          accessToken: 'a-access', refreshToken: 'a-refresh', accessTokenExpires: null,
          refreshTokenExpires: null, version: null, apiVersion: null, isAuthenticated: true, requiresAuth: true,
        },
        [bId]: {
          accessToken: 'b-access', refreshToken: 'b-refresh', accessTokenExpires: null,
          refreshTokenExpires: null, version: null, apiVersion: null, isAuthenticated: true, requiresAuth: true,
        },
      },
    });

    useAuthStore.getState().logoutAll();

    expect(getAuthSlice(aId).isAuthenticated).toBe(false);
    expect(getAuthSlice(bId).isAuthenticated).toBe(false);
  });

  describe('getFreshAccessToken', () => {
    it('returns the current access token when it has more than the leeway remaining', async () => {
      const future = Date.now() + 60 * 60 * 1000; // 1 hour ahead
      useAuthStore.setState({
        slices: {
          [aId]: {
            accessToken: 'fresh-token',
            refreshToken: null,
            accessTokenExpires: future,
            refreshTokenExpires: null,
            version: null,
            apiVersion: null,
            isAuthenticated: true,
            requiresAuth: true,
          },
        },
      });
      const result = await useAuthStore.getState().getFreshAccessToken(aId);
      expect(result).toBe('fresh-token');
    });

    it('refreshes when the token has less than the leeway remaining', async () => {
      const soon = Date.now() + 5 * 60 * 1000; // 5 min ahead, below the 30-min leeway
      useAuthStore.setState({
        slices: {
          [aId]: {
            accessToken: 'stale-token',
            refreshToken: 'rt',
            accessTokenExpires: soon,
            refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000,
            version: null,
            apiVersion: null,
            isAuthenticated: true,
            requiresAuth: true,
          },
        },
      });
      vi.mocked(apiRefreshToken).mockResolvedValueOnce({
        access_token: 'new-token',
        access_token_expires: 7200,
        refresh_token: 'new-rt',
        refresh_token_expires: 86400,
      });
      const result = await useAuthStore.getState().getFreshAccessToken(aId);
      expect(result).toBe('new-token');
      expect(apiRefreshToken).toHaveBeenCalledWith(expect.anything(), 'rt');
    });

    it('falls through to reLoginCallback when refresh rejects', async () => {
      useAuthStore.setState({
        slices: {
          [aId]: {
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
      vi.mocked(apiRefreshToken).mockRejectedValueOnce(new Error('401'));
      const reLogin = vi.fn().mockImplementation(async () => {
        useAuthStore.setState((s) => ({
          slices: {
            ...s.slices,
            [aId]: { ...s.slices[aId], accessToken: 'after-relogin', accessTokenExpires: Date.now() + 2 * 60 * 60 * 1000, isAuthenticated: true },
          },
        }));
        return true;
      });
      useAuthStore.getState().setReLoginCallback(aId, reLogin);
      const result = await useAuthStore.getState().getFreshAccessToken(aId);
      expect(result).toBe('after-relogin');
      expect(reLogin).toHaveBeenCalled();
    });

    it('returns null when both refresh and reLogin fail', async () => {
      useAuthStore.setState({
        slices: {
          [aId]: {
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
      vi.mocked(apiRefreshToken).mockRejectedValueOnce(new Error('401'));
      useAuthStore.getState().setReLoginCallback(aId, async () => false);
      const result = await useAuthStore.getState().getFreshAccessToken(aId);
      expect(result).toBeNull();
    });

    it('returns null without refreshing or logging out when the profile has no session yet', async () => {
      // Cold start: refresh token rehydrated, no access token, but profile
      // bootstrap has not built this profile's session yet.
      sessionState.hasSession = false;
      useAuthStore.setState({
        slices: {
          [aId]: {
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
      const reLogin = vi.fn(async () => true);
      useAuthStore.getState().setReLoginCallback(aId, reLogin);

      const result = await useAuthStore.getState().getFreshAccessToken(aId);

      expect(result).toBeNull();
      expect(apiRefreshToken).not.toHaveBeenCalled();
      expect(reLogin).not.toHaveBeenCalled();
      // No doomed-refresh error and no spurious logout.
      expect(vi.mocked(log.auth)).not.toHaveBeenCalledWith(
        'Token refresh failed',
        expect.anything(),
        expect.anything(),
      );
      expect(getAuthSlice(aId).isAuthenticated).toBe(true);
    });

    it('dedupes concurrent callers into one refresh', async () => {
      useAuthStore.setState({
        slices: {
          [aId]: {
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
      vi.mocked(apiRefreshToken).mockResolvedValue({
        access_token: 'new',
        access_token_expires: 7200,
        refresh_token: 'new-rt',
        refresh_token_expires: 86400,
      });
      const [a, b, c] = await Promise.all([
        useAuthStore.getState().getFreshAccessToken(aId),
        useAuthStore.getState().getFreshAccessToken(aId),
        useAuthStore.getState().getFreshAccessToken(aId),
      ]);
      expect(a).toBe('new');
      expect(b).toBe('new');
      expect(c).toBe('new');
      expect(apiRefreshToken).toHaveBeenCalledTimes(1);
    });

    it('refreshes independently per profile: A and B do not share a gate', async () => {
      useAuthStore.setState({
        slices: {
          [aId]: {
            accessToken: 'stale-a', refreshToken: 'refresh-a', accessTokenExpires: Date.now() + 60_000,
            refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000, version: null, apiVersion: null,
            isAuthenticated: true, requiresAuth: true,
          },
          [bId]: {
            accessToken: 'stale-b', refreshToken: 'refresh-b', accessTokenExpires: Date.now() + 60_000,
            refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000, version: null, apiVersion: null,
            isAuthenticated: true, requiresAuth: true,
          },
        },
      });
      const posts: string[] = [];
      vi.mocked(apiRefreshToken).mockImplementation(async (_client, token: string) => {
        posts.push(token);
        return { access_token: `new-${token}`, access_token_expires: 7200 };
      });

      await Promise.all([
        useAuthStore.getState().refreshAccessToken(aId),
        useAuthStore.getState().refreshAccessToken(bId),
      ]);

      expect(posts.filter((t) => t === 'refresh-a')).toHaveLength(1);
      expect(posts.filter((t) => t === 'refresh-b')).toHaveLength(1);
      expect(getAuthSlice(aId).accessToken).toBe('new-refresh-a');
      expect(getAuthSlice(bId).accessToken).toBe('new-refresh-b');
    });
  });

  describe('refreshAccessToken single-flight', () => {
    it('dedupes concurrent callers into one refresh POST', async () => {
      useAuthStore.setState({
        slices: {
          [aId]: {
            accessToken: null,
            refreshToken: 'rt',
            accessTokenExpires: null,
            refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000,
            version: null,
            apiVersion: null,
            isAuthenticated: false,
            requiresAuth: true,
          },
        },
      });
      vi.mocked(apiRefreshToken).mockResolvedValue({
        access_token: 'new',
        access_token_expires: 7200,
      });

      await Promise.all([
        useAuthStore.getState().refreshAccessToken(aId),
        useAuthStore.getState().refreshAccessToken(aId),
        useAuthStore.getState().refreshAccessToken(aId),
      ]);

      expect(apiRefreshToken).toHaveBeenCalledTimes(1);
      // The gate clears once settled: a later call refreshes again.
      await useAuthStore.getState().refreshAccessToken(aId);
      expect(apiRefreshToken).toHaveBeenCalledTimes(2);
    });

    it('two concurrent refreshes for the same profile share one POST', async () => {
      useAuthStore.setState({
        slices: {
          [aId]: {
            accessToken: null,
            refreshToken: 'refresh-a',
            accessTokenExpires: null,
            refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000,
            version: null,
            apiVersion: null,
            isAuthenticated: false,
            requiresAuth: true,
          },
        },
      });
      const posts: string[] = [];
      vi.mocked(apiRefreshToken).mockImplementation(async (_client, token: string) => {
        posts.push(token);
        return { access_token: 'new', access_token_expires: 7200 };
      });

      await Promise.all([
        useAuthStore.getState().refreshAccessToken(aId),
        useAuthStore.getState().refreshAccessToken(aId),
      ]);

      expect(posts.filter((t) => t === 'refresh-a')).toHaveLength(1);
    });
  });

  describe('proactiveLogin', () => {
    it('shares one reLogin across concurrent callers and clears the gate after settling', async () => {
      let resolveLogin!: (ok: boolean) => void;
      const reLogin = vi.fn(
        () => new Promise<boolean>((resolve) => { resolveLogin = resolve; }),
      );

      const first = useAuthStore.getState().proactiveLogin(aId, reLogin);
      const second = useAuthStore.getState().proactiveLogin(aId, reLogin);
      resolveLogin(true);

      expect(await first).toBe(true);
      expect(await second).toBe(true);
      expect(reLogin).toHaveBeenCalledTimes(1);

      const reLoginAgain = vi.fn(async () => false);
      expect(await useAuthStore.getState().proactiveLogin(aId, reLoginAgain)).toBe(false);
      expect(reLoginAgain).toHaveBeenCalledTimes(1);
    });
  });

  describe('recoverFromAuthFailure', () => {
    function recoverableState(profileId = aId) {
      useAuthStore.setState((s) => ({
        slices: {
          ...s.slices,
          [profileId]: {
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
      }));
    }

    it('shares one execution across concurrent callers', async () => {
      recoverableState();
      let resolveRefresh!: (value: LoginResponse) => void;
      vi.mocked(apiRefreshToken).mockImplementation(
        () => new Promise((resolve) => { resolveRefresh = resolve; }),
      );

      const calls = [
        useAuthStore.getState().recoverFromAuthFailure(aId),
        useAuthStore.getState().recoverFromAuthFailure(aId),
        useAuthStore.getState().recoverFromAuthFailure(aId),
      ];
      expect(apiRefreshToken).toHaveBeenCalledTimes(1);
      resolveRefresh({ access_token: 'new', access_token_expires: 7200 });

      expect(await Promise.all(calls)).toEqual([true, true, true]);
      expect(apiRefreshToken).toHaveBeenCalledTimes(1);
    });

    it('attaches to a pending proactive refresh instead of issuing a second refresh POST', async () => {
      recoverableState();
      let resolveRefresh!: (value: LoginResponse) => void;
      vi.mocked(apiRefreshToken).mockImplementation(
        () => new Promise((resolve) => { resolveRefresh = resolve; }),
      );

      // Proactive refresh (e.g. a stream tile rebuilding its URL) in flight.
      const proactive = useAuthStore.getState().getFreshAccessToken(aId);
      expect(apiRefreshToken).toHaveBeenCalledTimes(1);

      // A 401 recovery starts while that refresh is pending.
      const recovery = useAuthStore.getState().recoverFromAuthFailure(aId);
      resolveRefresh({ access_token: 'new-token', access_token_expires: 7200 });

      expect(await recovery).toBe(true);
      expect(await proactive).toBe('new-token');
      expect(apiRefreshToken).toHaveBeenCalledTimes(1);
    });

    it('falls back to reLogin when the refresh fails', async () => {
      recoverableState();
      vi.mocked(apiRefreshToken).mockRejectedValue(new Error('refresh failed'));
      const reLogin = vi.fn(async () => true);

      const recovered = await useAuthStore.getState().recoverFromAuthFailure(aId, reLogin);

      expect(recovered).toBe(true);
      expect(reLogin).toHaveBeenCalledTimes(1);
    });

    it('logs out once and resolves false when refresh and reLogin both fail', async () => {
      useAuthStore.setState({
        slices: {
          [aId]: {
            accessToken: 'at',
            refreshToken: null,
            accessTokenExpires: null,
            refreshTokenExpires: null,
            version: null,
            apiVersion: null,
            isAuthenticated: true,
            requiresAuth: true,
          },
        },
      });
      const reLogin = vi.fn(async () => false);

      const recovered = await useAuthStore.getState().recoverFromAuthFailure(aId, reLogin);

      expect(recovered).toBe(false);
      expect(reLogin).toHaveBeenCalledTimes(1);
      expect(getAuthSlice(aId).isAuthenticated).toBe(false);
    });
  });

  describe('resetAuthGates', () => {
    it('clears an in-flight recovery and refresh so the next caller starts fresh', async () => {
      useAuthStore.setState({
        slices: {
          [aId]: {
            accessToken: null,
            refreshToken: 'rt',
            accessTokenExpires: null,
            refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000,
            version: null,
            apiVersion: null,
            isAuthenticated: false,
            requiresAuth: true,
          },
        },
      });
      const resolvers: Array<(value: LoginResponse) => void> = [];
      vi.mocked(apiRefreshToken).mockImplementation(
        () => new Promise((resolve) => { resolvers.push(resolve); }),
      );

      const first = useAuthStore.getState().recoverFromAuthFailure(aId);
      expect(apiRefreshToken).toHaveBeenCalledTimes(1);

      resetAuthGates();

      const second = useAuthStore.getState().recoverFromAuthFailure(aId);
      expect(apiRefreshToken).toHaveBeenCalledTimes(2);

      resolvers.forEach((resolve) => resolve({ access_token: 'n', access_token_expires: 7200 }));
      expect(await first).toBe(true);
      expect(await second).toBe(true);
    });

    it('clearing one profile leaves another profile\'s pending gate untouched', async () => {
      useAuthStore.setState({
        slices: {
          [aId]: {
            accessToken: null, refreshToken: 'refresh-a', accessTokenExpires: null,
            refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000, version: null, apiVersion: null,
            isAuthenticated: false, requiresAuth: true,
          },
          [bId]: {
            accessToken: null, refreshToken: 'refresh-b', accessTokenExpires: null,
            refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000, version: null, apiVersion: null,
            isAuthenticated: false, requiresAuth: true,
          },
        },
      });
      let resolveA!: (value: LoginResponse) => void;
      let resolveB!: (value: LoginResponse) => void;
      let call = 0;
      vi.mocked(apiRefreshToken).mockImplementation(
        () => new Promise((resolve) => {
          call += 1;
          if (call === 1) resolveA = resolve; else resolveB = resolve;
        }),
      );

      const pendingA = useAuthStore.getState().refreshAccessToken(aId);
      const pendingB = useAuthStore.getState().refreshAccessToken(bId);
      expect(apiRefreshToken).toHaveBeenCalledTimes(2);

      resetAuthGates(aId);

      // B's gate is untouched: a second call for B attaches to the same pending POST.
      const pendingBAgain = useAuthStore.getState().refreshAccessToken(bId);
      expect(apiRefreshToken).toHaveBeenCalledTimes(2);

      resolveA({ access_token: 'a', access_token_expires: 7200 });
      resolveB({ access_token: 'b', access_token_expires: 7200 });
      await Promise.all([pendingA, pendingB, pendingBAgain]);
    });
  });

  describe('logout keepGates', () => {
    it('logout(id, { keepGates: true }) clears auth state but leaves a pending gate intact', async () => {
      useAuthStore.setState({
        slices: {
          [aId]: {
            accessToken: 'at', refreshToken: 'rt', accessTokenExpires: Date.now() + 60 * 60 * 1000,
            refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000, version: null, apiVersion: null,
            isAuthenticated: true, requiresAuth: true,
          },
        },
      });
      let resolveRefresh!: (value: LoginResponse) => void;
      vi.mocked(apiRefreshToken).mockImplementation(
        () => new Promise((resolve) => { resolveRefresh = resolve; }),
      );

      const pending = useAuthStore.getState().refreshAccessToken(aId);
      expect(apiRefreshToken).toHaveBeenCalledTimes(1);

      useAuthStore.getState().logout(aId, { keepGates: true });
      expect(getAuthSlice(aId).isAuthenticated).toBe(false);

      // A concurrent caller attaches to the still-pending gate: no new POST.
      const second = useAuthStore.getState().refreshAccessToken(aId);
      expect(apiRefreshToken).toHaveBeenCalledTimes(1);

      resolveRefresh({ access_token: 'new', access_token_expires: 7200 });
      await Promise.all([pending, second]);
    });

    it('logout(id) (default) clears the gate too: a concurrent caller starts a fresh POST', async () => {
      useAuthStore.setState({
        slices: {
          [aId]: {
            accessToken: 'at', refreshToken: 'rt', accessTokenExpires: Date.now() + 60 * 60 * 1000,
            refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000, version: null, apiVersion: null,
            isAuthenticated: true, requiresAuth: true,
          },
        },
      });
      const resolvers: Array<(value: LoginResponse) => void> = [];
      vi.mocked(apiRefreshToken).mockImplementation(
        () => new Promise((resolve) => { resolvers.push(resolve); }),
      );

      const pending = useAuthStore.getState().refreshAccessToken(aId);
      expect(apiRefreshToken).toHaveBeenCalledTimes(1);

      useAuthStore.getState().logout(aId);

      // The gate is gone: a concurrent caller can't attach to it, so this
      // one throws synchronously (no refresh token left after logout) rather
      // than starting a real second POST.
      await expect(useAuthStore.getState().refreshAccessToken(aId)).rejects.toThrow(
        'No refresh token available',
      );
      expect(apiRefreshToken).toHaveBeenCalledTimes(1);

      // The original in-flight refresh still settles for its own caller
      // (its captured refreshToken predates the logout) - it just isn't
      // shared with the second caller anymore.
      resolvers.forEach((resolve) => resolve({ access_token: 'new', access_token_expires: 7200 }));
      await pending;
    });

    it('a same-profile getFreshAccessToken call arriving exactly as a failing refresh logs out attaches to the same in-flight attempt: one refresh POST, one reLogin call', async () => {
      // Regression for the review's Important finding: refreshAccessToken's
      // failure path used to call the default (full-reset) logout() while
      // its own pendingRefresh/pendingFreshToken gates were still open, so a
      // concurrent caller arriving in that exact window would see no pending
      // gate and start a duplicate refresh/reLogin (N login POSTs, possible
      // server lockout). This test lands a second getFreshAccessToken(aId)
      // call at that exact moment by hooking the "Logged out, auth state
      // cleared" log line logout() emits right after its (now
      // keepGates: true) internal call - deterministic, no reliance on
      // microtask-count timing. With the fix, pendingFreshToken is still set
      // at that instant, so the second call attaches to the same gate
      // instead of starting its own refresh + reLogin.
      useAuthStore.setState({
        slices: {
          [aId]: {
            accessToken: 'stale', refreshToken: 'rt', accessTokenExpires: Date.now() + 60_000,
            refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000, version: null, apiVersion: null,
            isAuthenticated: true, requiresAuth: true,
          },
        },
      });
      vi.mocked(apiRefreshToken).mockRejectedValue(new Error('401'));
      const reLogin = vi.fn().mockResolvedValue(true);
      useAuthStore.getState().setReLoginCallback(aId, reLogin);

      let secondCall: Promise<string | null> | null = null;
      vi.mocked(log.auth).mockImplementation(((message: string) => {
        if (message === 'Logged out, auth state cleared' && !secondCall) {
          secondCall = useAuthStore.getState().getFreshAccessToken(aId);
        }
      }) as typeof log.auth);

      await useAuthStore.getState().getFreshAccessToken(aId);

      expect(secondCall).not.toBeNull();
      await secondCall;

      expect(apiRefreshToken).toHaveBeenCalledTimes(1);
      expect(reLogin).toHaveBeenCalledTimes(1);
    });
  });

  describe('refreshAccessToken expiry pre-check', () => {
    it('throws synchronously and does not call the network when refresh token is expired', async () => {
      useAuthStore.setState({
        slices: {
          [aId]: {
            accessToken: null,
            refreshToken: 'expired-rt',
            accessTokenExpires: null,
            refreshTokenExpires: Date.now() - 60_000,
            version: null,
            apiVersion: null,
            isAuthenticated: false,
            requiresAuth: true,
          },
        },
      });
      vi.mocked(apiRefreshToken).mockClear();
      await expect(useAuthStore.getState().refreshAccessToken(aId)).rejects.toThrow(
        /Refresh token expired/,
      );
      expect(apiRefreshToken).not.toHaveBeenCalled();
    });

    it('throws when refresh token expiry is missing', async () => {
      useAuthStore.setState({
        slices: {
          [aId]: {
            accessToken: null,
            refreshToken: 'rt-no-expiry',
            accessTokenExpires: null,
            refreshTokenExpires: null,
            version: null,
            apiVersion: null,
            isAuthenticated: false,
            requiresAuth: true,
          },
        },
      });
      vi.mocked(apiRefreshToken).mockClear();
      await expect(useAuthStore.getState().refreshAccessToken(aId)).rejects.toThrow();
      expect(apiRefreshToken).not.toHaveBeenCalled();
    });
  });

  describe('no-auth servers (requiresAuth)', () => {
    it('marks requiresAuth false and clears any stale refresh token when the server returns no tokens', () => {
      useAuthStore.setState({
        slices: {
          [aId]: {
            accessToken: null,
            refreshToken: 'stale-from-previous-profile',
            accessTokenExpires: null,
            refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000,
            version: null,
            apiVersion: null,
            isAuthenticated: false,
            requiresAuth: true,
          },
        },
      });

      useAuthStore.getState().setTokens(aId, { version: '1.36.35', apiversion: '2.0' });

      const state = getAuthSlice(aId);
      expect(state.requiresAuth).toBe(false);
      expect(state.accessToken).toBeNull();
      expect(state.refreshToken).toBeNull();
      expect(state.isAuthenticated).toBe(true);
    });

    it('marks requiresAuth true when the server returns tokens', () => {
      useAuthStore.getState().setTokens(aId, {
        access_token: 'a',
        access_token_expires: 60,
        refresh_token: 'r',
        refresh_token_expires: 120,
      });
      expect(getAuthSlice(aId).requiresAuth).toBe(true);
    });

    it('getFreshAccessToken returns null without attempting refresh or reLogin on a no-auth server', async () => {
      useAuthStore.setState({
        slices: {
          [aId]: {
            accessToken: null,
            refreshToken: null,
            accessTokenExpires: null,
            refreshTokenExpires: null,
            version: null,
            apiVersion: null,
            isAuthenticated: true,
            requiresAuth: false,
          },
        },
      });
      const reLogin = vi.fn(async () => true);
      useAuthStore.getState().setReLoginCallback(aId, reLogin);

      const result = await useAuthStore.getState().getFreshAccessToken(aId);

      expect(result).toBeNull();
      expect(apiRefreshToken).not.toHaveBeenCalled();
      expect(reLogin).not.toHaveBeenCalled();
    });

    it('login against a no-auth server sets requiresAuth false', async () => {
      vi.mocked(apiLogin).mockResolvedValue({ version: '1.36.35', apiversion: '2.0' });
      await useAuthStore.getState().login(aId, '', '');
      expect(getAuthSlice(aId).requiresAuth).toBe(false);
    });
  });

  describe('persistence', () => {
    it('discards a legacy single-slice persisted shape on rehydrate', async () => {
      const { encryptedAuthStorage } = await import('../auth');
      localStorage.setItem(
        'zmng-auth',
        JSON.stringify({
          state: { refreshToken: null, refreshTokenExpires: null, version: null, apiVersion: null, requiresAuth: true },
          version: 0,
        }),
      );

      const loaded = await encryptedAuthStorage.getItem('zmng-auth');

      expect(loaded).toBeNull();
    });

    it('excludes PROBE_PROFILE_ID from the persisted output', async () => {
      const { PROBE_PROFILE_ID } = await import('../../api/types');

      useAuthStore.getState().setTokens(PROBE_PROFILE_ID, {
        access_token: 'probe-at', access_token_expires: 60,
        refresh_token: 'probe-rt', refresh_token_expires: 120,
      });
      useAuthStore.getState().setTokens(aId, {
        access_token: 'a-at', access_token_expires: 60,
        refresh_token: 'a-rt', refresh_token_expires: 120,
      });

      const partialize = useAuthStore.persist.getOptions().partialize;
      const persisted = partialize!(useAuthStore.getState());

      expect(Object.keys(persisted.slices)).not.toContain(PROBE_PROFILE_ID);
      expect(Object.keys(persisted.slices)).toContain(aId);
    });
  });
});
