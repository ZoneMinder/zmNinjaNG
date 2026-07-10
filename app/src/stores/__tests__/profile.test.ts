import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProfileStore } from '../profile';
import { useMonitorSeenStore } from '../monitorSeen';
import { setApiClient } from '../../api/client';
import { createStoreApiClient } from '../../api/store-gates';
import { getServerTimeZone } from '../../api/time';
import { setSecureValue, removeSecureValue } from '../../lib/security/secureStorage';
import { asProfileId } from '../../api/types';

vi.mock('../../api/client', () => ({
  setApiClient: vi.fn(),
}));

vi.mock('../../api/store-gates', () => ({
  createStoreApiClient: vi.fn(() => ({ mock: true })),
}));

vi.mock('../../api/time', () => ({
  getServerTimeZone: vi.fn(),
}));

vi.mock('../../lib/security/secureStorage', () => ({
  setSecureValue: vi.fn().mockResolvedValue(undefined),
  getSecureValue: vi.fn().mockResolvedValue(undefined),
  removeSecureValue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/logger', () => ({
  log: {
    profile: vi.fn(),
    profileService: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
  },
}));

describe('Profile Store', () => {
  beforeEach(() => {
    useProfileStore.setState({
      profiles: [],
      currentProfileId: null,
      isInitialized: true,
    });
    useMonitorSeenStore.setState({ profileWatermarks: {} });
    vi.clearAllMocks();
    vi.stubGlobal('crypto', { randomUUID: () => 'profile-1' });
  });

  it('detects duplicate profile names', () => {
    useProfileStore.setState({
      profiles: [
        {
          id: asProfileId('p1'),
          name: 'Home',
          apiUrl: 'http://a',
          portalUrl: 'http://a',
          cgiUrl: 'http://a/cgi-bin',
          isDefault: true,
          createdAt: 1,
        },
      ],
    });

    const exists = useProfileStore.getState().profileExists('home');

    expect(exists).toBe(true);
  });

  it('adds a profile and stores password securely', async () => {
    vi.mocked(getServerTimeZone).mockResolvedValue('UTC');

    const id = await useProfileStore.getState().addProfile({
      name: 'Office',
      portalUrl: 'https://example.test',
      apiUrl: 'https://example.test',
      cgiUrl: 'https://example.test/cgi-bin',
      isDefault: false,
      username: 'admin',
      password: 'secret',
    });

    expect(id).toBe('profile-1');
    expect(setSecureValue).toHaveBeenCalledWith('password_profile-1', 'secret');
    expect(createStoreApiClient).toHaveBeenCalledWith('https://example.test', undefined, 'profile-1');
    expect(setApiClient).toHaveBeenCalled();

    const { profiles, currentProfileId } = useProfileStore.getState();
    const profile = profiles.find(p => p.id === currentProfileId);
    expect(profile?.name).toBe('Office');
    expect(profile?.password).toBe('stored-securely');
  });

  it('rejects duplicate profile names on add', async () => {
    useProfileStore.setState({
      profiles: [
        {
          id: asProfileId('p1'),
          name: 'Home',
          apiUrl: 'http://a',
          portalUrl: 'http://a',
          cgiUrl: 'http://a/cgi-bin',
          isDefault: true,
          createdAt: 1,
        },
      ],
    });

    await expect(
      useProfileStore.getState().addProfile({
        name: 'Home',
        portalUrl: 'https://example.test',
        apiUrl: 'https://example.test',
        cgiUrl: 'https://example.test/cgi-bin',
        isDefault: false,
      })
    ).rejects.toThrow('already exists');
  });

  it('updates profile and enforces unique names', async () => {
    useProfileStore.setState({
      profiles: [
        {
          id: asProfileId('p1'),
          name: 'Home',
          apiUrl: 'http://a',
          portalUrl: 'http://a',
          cgiUrl: 'http://a/cgi-bin',
          isDefault: true,
          createdAt: 1,
        },
        {
          id: asProfileId('p2'),
          name: 'Office',
          apiUrl: 'http://b',
          portalUrl: 'http://b',
          cgiUrl: 'http://b/cgi-bin',
          isDefault: false,
          createdAt: 2,
        },
      ],
    });

    await expect(
      useProfileStore.getState().updateProfile('p2', { name: 'Home' })
    ).rejects.toThrow('already exists');
  });

  it('removes profile password on delete', async () => {
    useProfileStore.setState({
      profiles: [
        {
          id: asProfileId('p1'),
          name: 'Home',
          apiUrl: 'http://a',
          portalUrl: 'http://a',
          cgiUrl: 'http://a/cgi-bin',
          isDefault: true,
          createdAt: 1,
        },
      ],
      currentProfileId: asProfileId('p1'),
    });

    await useProfileStore.getState().deleteProfile('p1');

    expect(removeSecureValue).toHaveBeenCalledWith('password_p1');
    expect(useProfileStore.getState().profiles).toHaveLength(0);
  });

  it('drops the deleted profile\'s monitor watermarks but keeps other profiles\'', async () => {
    useProfileStore.setState({
      profiles: [
        {
          id: asProfileId('p1'),
          name: 'Home',
          apiUrl: 'http://a',
          portalUrl: 'http://a',
          cgiUrl: 'http://a/cgi-bin',
          isDefault: true,
          createdAt: 1,
        },
      ],
      currentProfileId: asProfileId('p1'),
    });

    useMonitorSeenStore.getState().seed('p1', 'monitor-1', '2026-07-01 00:00:00');
    useMonitorSeenStore.getState().seed('p2', 'monitor-1', '2026-07-02 00:00:00');

    await useProfileStore.getState().deleteProfile('p1');

    expect(useMonitorSeenStore.getState().hasWatermark('p1', 'monitor-1')).toBe(false);
    expect(useMonitorSeenStore.getState().hasWatermark('p2', 'monitor-1')).toBe(true);
    expect(useMonitorSeenStore.getState().getWatermark('p2', 'monitor-1')).toBe('2026-07-02 00:00:00');
  });
});
