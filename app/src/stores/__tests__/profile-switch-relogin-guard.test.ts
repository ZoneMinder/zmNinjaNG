/**
 * Regression test: the self-heal reLogin must not fire with the outgoing
 * profile's credentials during a profile switch.
 *
 * switchProfile step 1 logs out, which makes the useFreshAccessToken effect
 * call getFreshAccessToken -> reLogin while currentProfileId is still the old
 * profile. That produced a 401 that poisoned the single-flight login. reLogin
 * is now suppressed for the duration of the switch.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loginSpy } = vi.hoisted(() => ({ loginSpy: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../auth', () => ({
  useAuthStore: {
    getState: () => ({ logout: vi.fn(), login: loginSpy, setTokens: vi.fn() }),
    subscribe: vi.fn(() => () => {}),
  },
}));
vi.mock('../query-cache', () => ({ clearQueryCache: vi.fn() }));
vi.mock('../../api/client', () => ({ setApiClient: vi.fn(), resetApiClient: vi.fn() }));
vi.mock('../../api/store-gates', () => ({ createStoreApiClient: vi.fn(() => ({})) }));
vi.mock('../../api/time', () => ({ getServerTimeZone: vi.fn() }));
vi.mock('../../services/profile-bootstrap', () => ({ performBootstrap: vi.fn() }));
vi.mock('../../lib/secureStorage', () => ({
  setSecureValue: vi.fn().mockResolvedValue(undefined),
  getSecureValue: vi.fn().mockResolvedValue(undefined),
  removeSecureValue: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../lib/logger', () => ({
  log: { profile: vi.fn(), profileService: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 },
}));

import { useProfileStore } from '../profile';
import { performBootstrap } from '../../services/profile-bootstrap';
import { asProfileId } from '../../api/types';

function profile(id: string, name: string, username: string) {
  return {
    id: asProfileId(id),
    name,
    apiUrl: `http://${name}/api`,
    portalUrl: `http://${name}`,
    username,
    password: 'stored',
  } as never;
}

describe('switchProfile reLogin guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProfileStore.setState({
      profiles: [profile('p-old', 'home', 'admin'), profile('p-new', 'isaac', 'asker')],
      currentProfileId: asProfileId('p-old'),
      isInitialized: true,
      // Avoid real decryption; reLogin uses this when it is not suppressed.
      getDecryptedPassword: (async () => 'decrypted') as never,
    });
  });

  it('suppresses reLogin during the switch and resumes after', async () => {
    let duringSwitch: boolean | undefined;
    // performBootstrap stands in for the work that runs mid-switch; capture what
    // a self-heal reLogin would return at that point.
    vi.mocked(performBootstrap).mockImplementation(async () => {
      duringSwitch = await useProfileStore.getState().reLogin();
    });

    await useProfileStore.getState().switchProfile('p-new');

    // During the switch reLogin is suppressed (returns false, no login attempt).
    expect(duringSwitch).toBe(false);
    expect(loginSpy).not.toHaveBeenCalled();

    // After the switch the guard is cleared: reLogin proceeds with the new
    // profile's credentials.
    const after = await useProfileStore.getState().reLogin();
    expect(after).toBe(true);
    expect(loginSpy).toHaveBeenCalledWith('asker', 'decrypted');
  });
});
