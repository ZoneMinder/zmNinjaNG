import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../client';
import { httpRequest } from '../../lib/http';
import { log, LogLevel } from '../../lib/logger';
import { useAuthStore } from '../../stores/auth';

vi.mock('../../lib/http', () => ({
  httpRequest: vi.fn(),
}));

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
});
