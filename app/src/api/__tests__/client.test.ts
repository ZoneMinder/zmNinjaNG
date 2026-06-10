import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient, resetApiClient } from '../client';
import { httpRequest } from '../../lib/http';
import { log, LogLevel } from '../../lib/logger';
import { useAuthStore } from '../../stores/auth';
import { API_REQUEST } from '../../lib/zmninja-ng-constants';

vi.mock('../../lib/http', () => ({
  httpRequest: vi.fn(),
}));

const mockGetProfileSettings = vi.fn((): { apiTimeoutSeconds: number } => ({
  apiTimeoutSeconds: API_REQUEST.defaultTimeoutSeconds,
}));
vi.mock('../../stores/settings', () => ({
  useSettingsStore: { getState: () => ({ getProfileSettings: mockGetProfileSettings }) },
}));

function okOnce() {
  vi.mocked(httpRequest).mockResolvedValueOnce({ data: {}, status: 200, statusText: 'OK', headers: {} } as never);
}

vi.mock('../../lib/logger', () => ({
  log: {
    api: vi.fn(),
    auth: vi.fn(),
    debug: vi.fn(),
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

describe('API Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetApiClient();
    useAuthStore.setState({
      accessToken: null,
      refreshToken: null,
      accessTokenExpires: null,
      refreshTokenExpires: null,
      version: null,
      apiVersion: null,
      isAuthenticated: false,
    });
  });

  it('never attaches refresh token to the login.json query string when posting credentials', async () => {
    // Simulate the rehydration race: refresh token has been resurrected after logout.
    useAuthStore.setState({
      accessToken: null,
      refreshToken: 'rehydrated-rt',
      refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000,
      isAuthenticated: false,
    });

    const httpRequestSpy = vi.mocked(httpRequest);
    httpRequestSpy.mockResolvedValueOnce({
      data: { access_token: 'a', refresh_token: 'r', access_token_expires: 7200, refresh_token_expires: 86400 },
      status: 200,
      statusText: 'OK',
      headers: {},
    } as never);

    const client = createApiClient('https://zm.example.com/api');
    const formBody = new URLSearchParams({ user: 'admin', pass: 'secret' }).toString();
    await client.post('/host/login.json', formBody, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    expect(httpRequestSpy).toHaveBeenCalled();
    const callArgs = httpRequestSpy.mock.calls[0]?.[1];
    expect(callArgs?.params?.token).toBeUndefined();
  });

  it('replaces an expired access token with a fresh one before attaching', async () => {
    useAuthStore.setState({
      accessToken: 'expired-at',
      accessTokenExpires: Date.now() - 60_000,
      refreshToken: null,
      refreshTokenExpires: null,
      isAuthenticated: true,
    });

    // Mock getFreshAccessToken to deterministically return a fresh token
    const getFreshAccessToken = vi.fn(async () => 'fresh-at');
    useAuthStore.setState({ getFreshAccessToken } as never);

    const httpRequestSpy = vi.mocked(httpRequest);
    httpRequestSpy.mockResolvedValueOnce({
      data: {},
      status: 200,
      statusText: 'OK',
      headers: {},
    } as never);

    const client = createApiClient('https://zm.example.com/api');
    await client.get('/monitors.json');

    expect(getFreshAccessToken).toHaveBeenCalled();
    const callArgs = httpRequestSpy.mock.calls[0]?.[1];
    expect(callArgs?.params?.token).toBe('fresh-at');
  });

  it('attaches no token when refresh returns null for an expired access token', async () => {
    useAuthStore.setState({
      accessToken: 'expired-at',
      accessTokenExpires: Date.now() - 60_000,
      refreshToken: null,
      refreshTokenExpires: null,
      isAuthenticated: true,
    });

    const getFreshAccessToken = vi.fn(async () => null);
    useAuthStore.setState({ getFreshAccessToken } as never);

    const httpRequestSpy = vi.mocked(httpRequest);
    httpRequestSpy.mockResolvedValueOnce({
      data: {},
      status: 200,
      statusText: 'OK',
      headers: {},
    } as never);

    const client = createApiClient('https://zm.example.com/api');
    await client.get('/monitors.json');

    expect(getFreshAccessToken).toHaveBeenCalled();
    const callArgs = httpRequestSpy.mock.calls[0]?.[1];
    expect(callArgs?.params?.token).toBeUndefined();
  });

  it('logs an expected status (e.g. 404 probe) at DEBUG, not ERROR, and still rejects', async () => {
    const httpRequestSpy = vi.mocked(httpRequest);
    httpRequestSpy.mockRejectedValueOnce({
      status: 404,
      statusText: 'Not Found',
      message: 'Not Found',
    } as never);

    const client = createApiClient('https://zm.example.com/api');

    await expect(
      client.get('/tags/index/Events.Id:55.json', { expectedStatuses: [404] }),
    ).rejects.toMatchObject({ status: 404 });

    const errorCall = vi.mocked(log.api).mock.calls.find(c => String(c[0]).includes('[Error #'));
    expect(errorCall).toBeDefined();
    expect(errorCall?.[1]).toBe(LogLevel.DEBUG);
  });

  it('logs an unexpected error status at ERROR', async () => {
    const httpRequestSpy = vi.mocked(httpRequest);
    httpRequestSpy.mockRejectedValueOnce({
      status: 500,
      statusText: 'Server Error',
      message: 'Server Error',
    } as never);

    const client = createApiClient('https://zm.example.com/api');

    await expect(client.get('/monitors.json')).rejects.toMatchObject({ status: 500 });

    const errorCall = vi.mocked(log.api).mock.calls.find(c => String(c[0]).includes('[Error #'));
    expect(errorCall?.[1]).toBe(LogLevel.ERROR);
  });

  describe('default request timeout', () => {
    it('applies the built-in default timeout when no profile and no explicit timeout', async () => {
      okOnce();
      const client = createApiClient('https://zm.example.com/api');
      await client.get('/monitors.json');
      expect(vi.mocked(httpRequest).mock.calls[0]?.[1]?.timeoutMs)
        .toBe(API_REQUEST.defaultTimeoutSeconds * 1000);
    });

    it('uses the profile-configured timeout when a profileId is provided', async () => {
      mockGetProfileSettings.mockReturnValueOnce({ apiTimeoutSeconds: 7 });
      okOnce();
      const client = createApiClient('https://zm.example.com/api', undefined, 'p1');
      await client.get('/monitors.json');
      expect(vi.mocked(httpRequest).mock.calls[0]?.[1]?.timeoutMs).toBe(7000);
    });

    it('disables the timeout when apiTimeoutSeconds is 0', async () => {
      mockGetProfileSettings.mockReturnValueOnce({ apiTimeoutSeconds: 0 });
      okOnce();
      const client = createApiClient('https://zm.example.com/api', undefined, 'p1');
      await client.get('/monitors.json');
      expect(vi.mocked(httpRequest).mock.calls[0]?.[1]?.timeoutMs).toBeUndefined();
    });

    it('does not apply the default to downloads (onDownloadProgress)', async () => {
      okOnce();
      const client = createApiClient('https://zm.example.com/api');
      await client.get('/events/12/video.mp4', { onDownloadProgress: () => {} });
      expect(vi.mocked(httpRequest).mock.calls[0]?.[1]?.timeoutMs).toBeUndefined();
    });

    it('respects an explicit timeoutMs from the caller', async () => {
      okOnce();
      const client = createApiClient('https://zm.example.com/api');
      await client.get('/monitors.json', { timeoutMs: 1234 });
      expect(vi.mocked(httpRequest).mock.calls[0]?.[1]?.timeoutMs).toBe(1234);
    });
  });

  describe('single-flight 401 recovery', () => {
    const unauthorized = { status: 401, statusText: 'Unauthorized', message: 'Unauthorized' };

    function authedState() {
      useAuthStore.setState({
        accessToken: 'at',
        accessTokenExpires: Date.now() + 60 * 60 * 1000,
        refreshToken: 'rt',
        refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000,
        isAuthenticated: true,
      });
    }

    it('runs one token refresh for concurrent 401s and retries each request once', async () => {
      authedState();

      let resolveRefresh!: () => void;
      const refreshAccessToken = vi.fn(
        () => new Promise<void>((resolve) => { resolveRefresh = resolve; }),
      );
      useAuthStore.setState({ refreshAccessToken } as never);

      const httpRequestSpy = vi.mocked(httpRequest);
      let calls = 0;
      httpRequestSpy.mockImplementation(async () => {
        calls += 1;
        if (calls <= 5) throw unauthorized;
        return { data: {}, status: 200, statusText: 'OK', headers: {} } as never;
      });

      const client = createApiClient('https://zm.example.com/api');
      const requests = Array.from({ length: 5 }, (_, i) => client.get(`/monitors/${i}.json`));

      // Let all five requests hit the 401 handler before the refresh resolves.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(refreshAccessToken).toHaveBeenCalledTimes(1);
      resolveRefresh();

      const results = await Promise.all(requests);
      expect(results).toHaveLength(5);
      expect(refreshAccessToken).toHaveBeenCalledTimes(1);
      // 5 original attempts + 5 retries, no extra recovery round-trips.
      expect(httpRequestSpy).toHaveBeenCalledTimes(10);
    });

    it('fails all concurrent callers with one re-login attempt, then allows a later recovery', async () => {
      // No refresh token: recovery falls through to reLogin immediately.
      useAuthStore.setState({
        accessToken: 'at',
        accessTokenExpires: Date.now() + 60 * 60 * 1000,
        refreshToken: null,
        refreshTokenExpires: null,
        isAuthenticated: true,
      });
      const logout = vi.fn();
      useAuthStore.setState({ logout } as never);

      let resolveReLogin!: (ok: boolean) => void;
      const reLogin = vi.fn(
        () => new Promise<boolean>((resolve) => { resolveReLogin = resolve; }),
      );

      vi.mocked(httpRequest).mockRejectedValue(unauthorized as never);

      const client = createApiClient('https://zm.example.com/api', reLogin);
      const requests = Array.from({ length: 4 }, () =>
        client.get('/monitors.json').then(() => 'resolved', (e: unknown) => e),
      );

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(reLogin).toHaveBeenCalledTimes(1);
      resolveReLogin(false);

      const results = await Promise.all(requests);
      results.forEach((r) => expect(r).toMatchObject({ status: 401 }));
      expect(reLogin).toHaveBeenCalledTimes(1);
      expect(logout).toHaveBeenCalledTimes(1);

      // The gate is cleared: a later 401 attempts recovery again.
      const next = client.get('/monitors.json').then(() => 'resolved', (e: unknown) => e);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(reLogin).toHaveBeenCalledTimes(2);
      resolveReLogin(false);
      expect(await next).toMatchObject({ status: 401 });
    });

    it('does not start a second recovery when the retried request 401s again', async () => {
      authedState();
      const refreshAccessToken = vi.fn(async () => {});
      useAuthStore.setState({ refreshAccessToken } as never);

      vi.mocked(httpRequest).mockRejectedValue(unauthorized as never);

      const client = createApiClient('https://zm.example.com/api');
      await expect(client.get('/monitors.json')).rejects.toMatchObject({ status: 401 });
      expect(refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(vi.mocked(httpRequest)).toHaveBeenCalledTimes(2);
    });

    it('resetApiClient clears an in-flight recovery so later requests start a new one', async () => {
      authedState();
      const refreshResolvers: Array<() => void> = [];
      const refreshAccessToken = vi.fn(
        () => new Promise<void>((resolve) => { refreshResolvers.push(resolve); }),
      );
      useAuthStore.setState({ refreshAccessToken } as never);

      vi.mocked(httpRequest).mockRejectedValue(unauthorized as never);

      const client = createApiClient('https://zm.example.com/api');
      const first = client.get('/a.json').then(() => 'resolved', (e: unknown) => e);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(refreshAccessToken).toHaveBeenCalledTimes(1);

      resetApiClient();

      const second = client.get('/b.json').then(() => 'resolved', (e: unknown) => e);
      await new Promise((resolve) => setTimeout(resolve, 0));
      // A stale recovery is not awaited; a new one starts.
      expect(refreshAccessToken).toHaveBeenCalledTimes(2);

      refreshResolvers.forEach((resolve) => resolve());
      // Both retries hit the always-401 mock and reject without looping.
      expect(await first).toMatchObject({ status: 401 });
      expect(await second).toMatchObject({ status: 401 });
    });
  });
});
