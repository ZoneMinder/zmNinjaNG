import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { useAuthStore } from '../auth';
import { login as apiLogin, refreshToken as apiRefreshToken } from '../../api/auth';

vi.mock('../../api/auth', () => ({
  login: vi.fn(),
  refreshToken: vi.fn(),
}));

vi.mock('../../lib/logger', () => ({
  log: {
    auth: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Auth Store', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({
      accessToken: null,
      refreshToken: null,
      accessTokenExpires: null,
      refreshTokenExpires: null,
      version: null,
      apiVersion: null,
      isAuthenticated: false,
    });
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

    await useAuthStore.getState().login('user', 'pass');

    expect(apiLogin).toHaveBeenCalledWith({ user: 'user', pass: 'pass' });
    const state = useAuthStore.getState();
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
      refreshToken: 'existing-refresh',
      refreshTokenExpires: Date.now() + 5000,
      version: '0.9.0',
      apiVersion: '1.9.0',
    });

    useAuthStore.getState().setTokens({
      access_token: 'new-access',
      access_token_expires: 10,
    });

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('new-access');
    expect(state.refreshToken).toBe('existing-refresh');
    expect(state.refreshTokenExpires).toBe(Date.now() + 5000);
    expect(state.version).toBe('0.9.0');
    expect(state.apiVersion).toBe('1.9.0');
  });

  it('refreshes access token successfully', async () => {
    useAuthStore.setState({
      refreshToken: 'refresh-xyz',
    });

    vi.mocked(apiRefreshToken).mockResolvedValue({
      access_token: 'new-access',
      access_token_expires: 30,
    });

    await useAuthStore.getState().refreshAccessToken();

    expect(apiRefreshToken).toHaveBeenCalledWith('refresh-xyz');
    expect(useAuthStore.getState().accessToken).toBe('new-access');
  });

  it('logs out on refresh failure', async () => {
    useAuthStore.setState({
      refreshToken: 'refresh-xyz',
      accessToken: 'old-access',
      isAuthenticated: true,
    });

    vi.mocked(apiRefreshToken).mockRejectedValue(new Error('refresh failed'));

    await expect(useAuthStore.getState().refreshAccessToken()).rejects.toThrow('refresh failed');

    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('clears state on logout', () => {
    useAuthStore.setState({
      accessToken: 'access',
      refreshToken: 'refresh',
      accessTokenExpires: Date.now() + 1000,
      refreshTokenExpires: Date.now() + 2000,
      version: '1.0.0',
      apiVersion: '2.0.0',
      isAuthenticated: true,
    });

    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.accessTokenExpires).toBeNull();
    expect(state.refreshTokenExpires).toBeNull();
    expect(state.version).toBeNull();
    expect(state.apiVersion).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });
});
