import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

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

vi.mock('../../api/auth', () => ({
  login: vi.fn(),
  refreshToken: vi.fn(),
}));

const profileId = 'p1';
vi.mock('../useCurrentProfile', () => ({
  useCurrentProfile: () => ({ currentProfile: { id: profileId }, settings: {}, hasProfile: true }),
}));

import { useFreshAccessToken } from '../useFreshAccessToken';
import { useAuthStore, type AuthSlice } from '../../stores/auth';
import { asProfileId } from '../../api/types';

const pid = asProfileId(profileId);

const EMPTY_SLICE: AuthSlice = {
  accessToken: null,
  refreshToken: null,
  accessTokenExpires: null,
  refreshTokenExpires: null,
  version: null,
  apiVersion: null,
  isAuthenticated: false,
  requiresAuth: true,
};

function setSlice(patch: Partial<AuthSlice>) {
  useAuthStore.setState({ slices: { [pid]: { ...EMPTY_SLICE, ...patch } } });
}

describe('useFreshAccessToken', () => {
  beforeEach(() => {
    useAuthStore.setState({ slices: {} });
  });

  it('treats a no-auth server as fresh and does not trigger a token refresh', () => {
    const getFreshAccessToken = vi.fn(async () => null);
    setSlice({ requiresAuth: false, isAuthenticated: true });
    useAuthStore.setState({ getFreshAccessToken });

    const { result } = renderHook(() => useFreshAccessToken());

    expect(result.current.isFresh).toBe(true);
    expect(result.current.token).toBeNull();
    expect(getFreshAccessToken).not.toHaveBeenCalled();
  });

  it('returns isFresh=true with the token when expiry is comfortably ahead', () => {
    setSlice({
      accessToken: 'fresh',
      accessTokenExpires: Date.now() + 60 * 60 * 1000, // 1 hour
      isAuthenticated: true,
    });
    const { result } = renderHook(() => useFreshAccessToken());
    expect(result.current.isFresh).toBe(true);
    expect(result.current.token).toBe('fresh');
  });

  it('returns isFresh=false with token=null when expiry is below the leeway', () => {
    setSlice({
      accessToken: 'stale',
      accessTokenExpires: Date.now() + 5 * 60 * 1000, // 5 min, under 30-min leeway
      isAuthenticated: true,
    });
    const { result } = renderHook(() => useFreshAccessToken());
    expect(result.current.isFresh).toBe(false);
    expect(result.current.token).toBeNull();
  });

  it('returns isFresh=false when there is no token', () => {
    const { result } = renderHook(() => useFreshAccessToken());
    expect(result.current.isFresh).toBe(false);
    expect(result.current.token).toBeNull();
  });

  it('triggers getFreshAccessToken when not fresh', () => {
    const spy = vi.fn(async () => 'new');
    setSlice({
      accessToken: 'stale',
      accessTokenExpires: Date.now() + 5 * 60 * 1000,
      isAuthenticated: true,
    });
    useAuthStore.setState({ getFreshAccessToken: spy as never });
    renderHook(() => useFreshAccessToken());
    expect(spy).toHaveBeenCalledWith(profileId);
  });

  it('does not retrigger refresh while fresh', () => {
    const spy = vi.fn(async () => 'tok');
    setSlice({
      accessToken: 'tok',
      accessTokenExpires: Date.now() + 60 * 60 * 1000,
      isAuthenticated: true,
    });
    useAuthStore.setState({ getFreshAccessToken: spy as never });
    const { rerender } = renderHook(() => useFreshAccessToken());
    rerender();
    rerender();
    expect(spy).not.toHaveBeenCalled();
  });

  it('flips to fresh when accessTokenExpires updates', () => {
    setSlice({
      accessToken: 'old',
      accessTokenExpires: Date.now() + 5 * 60 * 1000,
      isAuthenticated: true,
    });
    const { result } = renderHook(() => useFreshAccessToken());
    expect(result.current.isFresh).toBe(false);
    act(() => {
      setSlice({
        accessToken: 'new',
        accessTokenExpires: Date.now() + 60 * 60 * 1000,
        isAuthenticated: true,
      });
    });
    expect(result.current.isFresh).toBe(true);
    expect(result.current.token).toBe('new');
  });
});
