import { describe, it, expect, vi, beforeEach } from 'vitest';
import { asProfileId } from '../../../api/types';
import type { Profile, ProfileId } from '../../../api/types';
import type { ProfileSettings } from '../../../stores/settings';
import { collectTrustEntries } from '../ssl-trust';

// vi.mock factories below are hoisted above these imports; vi.hoisted keeps
// the mock fns they reference from hitting the temporal dead zone.
const { mockEnable, mockDisable, mockSetTrustedFingerprints, mockGetServerCertFingerprint, mockLogSslTrust } =
  vi.hoisted(() => ({
    mockEnable: vi.fn().mockResolvedValue(undefined),
    mockDisable: vi.fn().mockResolvedValue(undefined),
    mockSetTrustedFingerprints: vi.fn().mockResolvedValue(undefined),
    mockGetServerCertFingerprint: vi.fn(),
    mockLogSslTrust: vi.fn(),
  }));

vi.mock('../../../plugins/ssl-trust', () => ({
  SSLTrust: {
    enable: mockEnable,
    disable: mockDisable,
    isEnabled: vi.fn().mockResolvedValue({ enabled: false }),
    setTrustedFingerprints: mockSetTrustedFingerprints,
    getServerCertFingerprint: mockGetServerCertFingerprint,
  },
}));

vi.mock('../../logger', () => ({
  log: {
    sslTrust: mockLogSslTrust,
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
  },
}));

const profile = (id: string, urls: Partial<Profile>): Profile =>
  ({
    id: asProfileId(id),
    name: id,
    portalUrl: '',
    apiUrl: '',
    cgiUrl: '',
    isDefault: false,
    createdAt: 0,
    ...urls,
  }) as Profile;

describe('collectTrustEntries', () => {
  it('emits one entry per distinct host of each trusting profile', () => {
    const profiles = [
      profile('a', {
        portalUrl: 'https://cam-a.local',
        apiUrl: 'https://cam-a.local/zm/api',
        cgiUrl: 'https://cam-a.local/cgi-bin',
      }),
      profile('b', {
        portalUrl: 'https://cam-b.local:8443',
        apiUrl: 'https://api-b.local/zm/api',
        cgiUrl: 'https://cam-b.local:8443/cgi-bin',
      }),
    ];
    const settings = (id: ProfileId) =>
      ({
        allowSelfSignedCerts: true,
        trustedCertFingerprint: id === asProfileId('a') ? 'AA:11' : 'BB:22',
      }) as ProfileSettings;
    const { enabled, entries } = collectTrustEntries(profiles, settings);
    expect(enabled).toBe(true);
    expect(entries).toContainEqual({ host: 'cam-a.local', fingerprint: 'AA:11' });
    expect(entries).toContainEqual({ host: 'cam-b.local', fingerprint: 'BB:22' });
    expect(entries).toContainEqual({ host: 'api-b.local', fingerprint: 'BB:22' });
    expect(entries.filter((e) => e.host === 'cam-a.local')).toHaveLength(1); // deduped
  });

  it('excludes profiles with trust off or no stored fingerprint, disabled when none trust', () => {
    const profiles = [profile('a', { portalUrl: 'https://cam-a.local' })];
    const off = () => ({ allowSelfSignedCerts: false, trustedCertFingerprint: 'AA:11' }) as ProfileSettings;
    expect(collectTrustEntries(profiles, off)).toEqual({ enabled: false, entries: [] });
  });

  it('is enabled with no entries when trust is on but no fingerprint is stored yet (TOFU accept-all)', () => {
    const profiles = [profile('a', { portalUrl: 'https://cam-a.local' })];
    const settings = () => ({ allowSelfSignedCerts: true, trustedCertFingerprint: null }) as ProfileSettings;
    expect(collectTrustEntries(profiles, settings)).toEqual({ enabled: true, entries: [] });
  });

  it('skips unparseable or empty URLs', () => {
    const profiles = [
      profile('a', { portalUrl: 'not-a-url', apiUrl: '', cgiUrl: 'https://cam-a.local/cgi-bin' }),
    ];
    const settings = () => ({ allowSelfSignedCerts: true, trustedCertFingerprint: 'AA:11' }) as ProfileSettings;
    expect(collectTrustEntries(profiles, settings)).toEqual({
      enabled: true,
      entries: [{ host: 'cam-a.local', fingerprint: 'AA:11' }],
    });
  });

  it('last write wins and logs a WARN when two profiles claim the same host', () => {
    const profiles = [
      profile('a', { portalUrl: 'https://shared.local' }),
      profile('b', { portalUrl: 'https://shared.local' }),
    ];
    const settings = (id: ProfileId) =>
      ({
        allowSelfSignedCerts: true,
        trustedCertFingerprint: id === asProfileId('a') ? 'AA:11' : 'BB:22',
      }) as ProfileSettings;
    const { entries } = collectTrustEntries(profiles, settings);
    expect(entries).toEqual([{ host: 'shared.local', fingerprint: 'BB:22' }]);
    expect(mockLogSslTrust).toHaveBeenCalledWith(expect.stringContaining('shared.local'), 2);
  });
});

describe('applyTrustedCertificates', () => {
  const mockGetProfileSettings = vi.fn();

  function mockStores(profiles: Profile[]) {
    vi.doMock('../../../stores/profile', () => ({
      useProfileStore: { getState: () => ({ profiles }) },
    }));
    vi.doMock('../../../stores/settings', () => ({
      useSettingsStore: { getState: () => ({ getProfileSettings: mockGetProfileSettings }) },
    }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetProfileSettings.mockReset();
  });

  it('enables native trust with the collected entries when any profile trusts', async () => {
    vi.doMock('../../platform', () => ({
      Platform: { isNative: true },
    }));
    mockStores([profile('a', { portalUrl: 'https://cam-a.local' })]);
    mockGetProfileSettings.mockReturnValue({ allowSelfSignedCerts: true, trustedCertFingerprint: 'AA:11' });

    const { applyTrustedCertificates } = await import('../ssl-trust');
    await applyTrustedCertificates();

    expect(mockEnable).toHaveBeenCalled();
    expect(mockSetTrustedFingerprints).toHaveBeenCalledWith({
      entries: [{ host: 'cam-a.local', fingerprint: 'AA:11' }],
    });
    expect(mockDisable).not.toHaveBeenCalled();
  });

  it('disables native trust when no profile trusts', async () => {
    vi.doMock('../../platform', () => ({
      Platform: { isNative: true },
    }));
    mockStores([profile('a', {})]);
    mockGetProfileSettings.mockReturnValue({ allowSelfSignedCerts: false, trustedCertFingerprint: null });

    const { applyTrustedCertificates } = await import('../ssl-trust');
    await applyTrustedCertificates();

    expect(mockDisable).toHaveBeenCalled();
    expect(mockEnable).not.toHaveBeenCalled();
  });

  it('forwards only the enabled boolean to Electron', async () => {
    vi.doMock('../../platform', () => ({
      Platform: { isNative: false, isElectron: true },
    }));
    mockStores([profile('a', {})]);
    mockGetProfileSettings.mockReturnValue({ allowSelfSignedCerts: true, trustedCertFingerprint: 'AA:11' });
    const setTrustSelfSigned = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('window', { electronSsl: { setTrustSelfSigned } });

    const { applyTrustedCertificates } = await import('../ssl-trust');
    await applyTrustedCertificates();

    expect(setTrustSelfSigned).toHaveBeenCalledWith(true);
    expect(mockEnable).not.toHaveBeenCalled();
    expect(mockDisable).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('is a no-op on web platforms', async () => {
    vi.doMock('../../platform', () => ({
      Platform: { isNative: false, isElectron: false },
    }));
    mockStores([profile('a', {})]);
    mockGetProfileSettings.mockReturnValue({ allowSelfSignedCerts: true, trustedCertFingerprint: 'AA:11' });

    const { applyTrustedCertificates } = await import('../ssl-trust');
    await applyTrustedCertificates();

    expect(mockEnable).not.toHaveBeenCalled();
    expect(mockDisable).not.toHaveBeenCalled();
  });

  it('swallows a native enable() rejection instead of throwing', async () => {
    vi.doMock('../../platform', () => ({
      Platform: { isNative: true },
    }));
    mockStores([profile('a', { portalUrl: 'https://cam-a.local' })]);
    mockGetProfileSettings.mockReturnValue({ allowSelfSignedCerts: true, trustedCertFingerprint: 'AA:11' });
    mockEnable.mockRejectedValueOnce(new Error('plugin unavailable'));

    const { applyTrustedCertificates } = await import('../ssl-trust');
    await expect(applyTrustedCertificates()).resolves.toBeUndefined();
    expect(mockLogSslTrust).toHaveBeenCalledWith(
      'Failed to apply SSL trust setting',
      expect.anything(),
      expect.objectContaining({ error: expect.any(Error) })
    );
  });

  it('swallows an Electron setTrustSelfSigned rejection instead of throwing', async () => {
    vi.doMock('../../platform', () => ({
      Platform: { isNative: false, isElectron: true },
    }));
    mockStores([profile('a', {})]);
    mockGetProfileSettings.mockReturnValue({ allowSelfSignedCerts: true, trustedCertFingerprint: 'AA:11' });
    const setTrustSelfSigned = vi.fn().mockRejectedValue(new Error('ipc failure'));
    vi.stubGlobal('window', { electronSsl: { setTrustSelfSigned } });

    const { applyTrustedCertificates } = await import('../ssl-trust');
    await expect(applyTrustedCertificates()).resolves.toBeUndefined();
    expect(mockLogSslTrust).toHaveBeenCalledWith(
      'Failed to apply Electron SSL trust setting',
      expect.anything(),
      expect.objectContaining({ error: expect.any(Error) })
    );

    vi.unstubAllGlobals();
  });
});

describe('getServerCertFingerprint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns null without touching the plugin on non-native platforms', async () => {
    vi.doMock('../../platform', () => ({
      Platform: { isNative: false },
    }));

    const { getServerCertFingerprint } = await import('../ssl-trust');
    const result = await getServerCertFingerprint('https://example.com');

    expect(result).toBeNull();
    expect(mockGetServerCertFingerprint).not.toHaveBeenCalled();
  });

  it('returns the certificate info from the native plugin (first-use fetch)', async () => {
    vi.doMock('../../platform', () => ({
      Platform: { isNative: true },
    }));
    const certInfo = {
      fingerprint: 'AA:BB:CC:DD',
      subject: 'CN=zm.example.com',
      issuer: 'CN=zm.example.com',
      expiry: '2027-01-01',
    };
    mockGetServerCertFingerprint.mockResolvedValueOnce(certInfo);

    const { getServerCertFingerprint } = await import('../ssl-trust');
    const result = await getServerCertFingerprint('https://zm.example.com');

    expect(mockGetServerCertFingerprint).toHaveBeenCalledWith({ url: 'https://zm.example.com' });
    expect(result).toEqual(certInfo);
  });

  it('returns null and logs when the native plugin rejects', async () => {
    vi.doMock('../../platform', () => ({
      Platform: { isNative: true },
    }));
    mockGetServerCertFingerprint.mockRejectedValueOnce(new Error('TLS handshake failed'));

    const { getServerCertFingerprint } = await import('../ssl-trust');
    const result = await getServerCertFingerprint('https://zm.example.com');

    expect(result).toBeNull();
    expect(mockLogSslTrust).toHaveBeenCalledWith(
      'Failed to fetch server certificate fingerprint',
      expect.anything(),
      expect.objectContaining({ error: expect.any(Error) })
    );
  });
});
