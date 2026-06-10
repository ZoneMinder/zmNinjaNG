import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLogin = vi.fn().mockResolvedValue(undefined);
const mockLogout = vi.fn();
const mockSubscribe = vi.fn();
const getServerTimeZone = vi.fn();
const fetchZmsPath = vi.fn();

vi.mock('../auth', () => ({
  useAuthStore: {
    getState: vi.fn(() => ({
      accessToken: 'access-token',
      refreshToken: null,
      login: mockLogin,
      logout: mockLogout,
    })),
    subscribe: mockSubscribe,
  },
}));

vi.mock('../../api/time', () => ({
  getServerTimeZone,
}));

vi.mock('../../api/auth', () => ({
  fetchZmsPath,
}));

vi.mock('../../api/client', () => ({
  setApiClient: vi.fn(),
  resetApiClient: vi.fn(),
}));

vi.mock('../../api/store-gates', () => ({
  createStoreApiClient: vi.fn(() => ({})),
}));

vi.mock('../../lib/secureStorage', () => ({
  getSecureValue: vi.fn(async () => 'password'),
  setSecureValue: vi.fn(),
  removeSecureValue: vi.fn(),
}));

vi.mock('../../lib/logger', () => ({
  log: {
    profile: vi.fn(),
    profileService: vi.fn(),
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

vi.mock('../query-cache', () => ({
  clearQueryCache: vi.fn(),
}));

describe('Profile Store Initialization', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks initialization complete when no profile exists', async () => {
    localStorage.setItem(
      'zmng-profiles',
      JSON.stringify({
        state: {
          profiles: [],
          currentProfileId: null,
          isInitialized: false,
          isBootstrapping: false,
        },
        version: 0,
      })
    );

    vi.resetModules();
    const { useProfileStore } = await import('../profile');
    await useProfileStore.persist.rehydrate();
    await Promise.resolve();
    vi.advanceTimersByTime(0);

    const state = useProfileStore.getState();
    expect(state.isInitialized).toBe(true);
    expect(state.isBootstrapping).toBe(false);
  });

});
