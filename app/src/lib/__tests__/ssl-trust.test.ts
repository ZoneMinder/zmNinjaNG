import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEnable = vi.fn().mockResolvedValue(undefined);
const mockDisable = vi.fn().mockResolvedValue(undefined);
const mockSetTrustedFingerprint = vi.fn().mockResolvedValue(undefined);
const mockGetServerCertFingerprint = vi.fn();

vi.mock('../../plugins/ssl-trust', () => ({
  SSLTrust: {
    enable: mockEnable,
    disable: mockDisable,
    isEnabled: vi.fn().mockResolvedValue({ enabled: false }),
    setTrustedFingerprint: mockSetTrustedFingerprint,
    getServerCertFingerprint: mockGetServerCertFingerprint,
  },
}));

const mockLogSslTrust = vi.fn();
vi.mock('../logger', () => ({
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

describe('applySSLTrustSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('should call SSLTrust.enable() when enabled on native', async () => {
    vi.doMock('../platform', () => ({
      Platform: { isNative: true },
    }));

    const { applySSLTrustSetting } = await import('../ssl-trust');
    await applySSLTrustSetting(true);

    expect(mockEnable).toHaveBeenCalled();
    expect(mockDisable).not.toHaveBeenCalled();
  });

  it('should call SSLTrust.disable() when disabled on native', async () => {
    vi.doMock('../platform', () => ({
      Platform: { isNative: true },
    }));

    const { applySSLTrustSetting } = await import('../ssl-trust');
    await applySSLTrustSetting(false);

    expect(mockDisable).toHaveBeenCalled();
    expect(mockEnable).not.toHaveBeenCalled();
  });

  it('should call electronSsl.setTrustSelfSigned with the enabled flag on Electron', async () => {
    vi.doMock('../platform', () => ({
      Platform: { isNative: false, isElectron: true },
    }));

    const setTrustSelfSigned = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('window', { electronSsl: { setTrustSelfSigned } });

    const { applySSLTrustSetting } = await import('../ssl-trust');

    await applySSLTrustSetting(true);
    expect(setTrustSelfSigned).toHaveBeenCalledWith(true);

    await applySSLTrustSetting(false);
    expect(setTrustSelfSigned).toHaveBeenCalledWith(false);

    expect(mockEnable).not.toHaveBeenCalled();
    expect(mockDisable).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('should be a no-op on web platforms', async () => {
    vi.doMock('../platform', () => ({
      Platform: { isNative: false, isElectron: false },
    }));

    const { applySSLTrustSetting } = await import('../ssl-trust');
    await applySSLTrustSetting(true);

    expect(mockEnable).not.toHaveBeenCalled();
    expect(mockDisable).not.toHaveBeenCalled();
  });

  it('passes the fingerprint through to setTrustedFingerprint when pinning on native', async () => {
    vi.doMock('../platform', () => ({
      Platform: { isNative: true },
    }));

    const { applySSLTrustSetting } = await import('../ssl-trust');
    await applySSLTrustSetting(true, 'AA:BB:CC:DD');

    expect(mockEnable).toHaveBeenCalled();
    expect(mockSetTrustedFingerprint).toHaveBeenCalledWith({ fingerprint: 'AA:BB:CC:DD' });
  });

  it('accepts-any (passes null fingerprint) when no pin is stored yet, per TOFU rule', async () => {
    vi.doMock('../platform', () => ({
      Platform: { isNative: true },
    }));

    const { applySSLTrustSetting } = await import('../ssl-trust');
    await applySSLTrustSetting(true);

    expect(mockEnable).toHaveBeenCalled();
    expect(mockSetTrustedFingerprint).toHaveBeenCalledWith({ fingerprint: null });
  });

  it('swallows a native enable() rejection instead of throwing', async () => {
    vi.doMock('../platform', () => ({
      Platform: { isNative: true },
    }));
    mockEnable.mockRejectedValueOnce(new Error('plugin unavailable'));

    const { applySSLTrustSetting } = await import('../ssl-trust');
    await expect(applySSLTrustSetting(true)).resolves.toBeUndefined();
    expect(mockLogSslTrust).toHaveBeenCalledWith(
      'Failed to apply SSL trust setting',
      expect.anything(),
      expect.objectContaining({ error: expect.any(Error) })
    );
  });

  it('swallows an Electron setTrustSelfSigned rejection instead of throwing', async () => {
    vi.doMock('../platform', () => ({
      Platform: { isNative: false, isElectron: true },
    }));
    const setTrustSelfSigned = vi.fn().mockRejectedValue(new Error('ipc failure'));
    vi.stubGlobal('window', { electronSsl: { setTrustSelfSigned } });

    const { applySSLTrustSetting } = await import('../ssl-trust');
    await expect(applySSLTrustSetting(true)).resolves.toBeUndefined();
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
    vi.doMock('../platform', () => ({
      Platform: { isNative: false },
    }));

    const { getServerCertFingerprint } = await import('../ssl-trust');
    const result = await getServerCertFingerprint('https://example.com');

    expect(result).toBeNull();
    expect(mockGetServerCertFingerprint).not.toHaveBeenCalled();
  });

  it('returns the certificate info from the native plugin (first-use fetch)', async () => {
    vi.doMock('../platform', () => ({
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
    vi.doMock('../platform', () => ({
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

describe('setTrustedFingerprint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('is a no-op on non-native platforms', async () => {
    vi.doMock('../platform', () => ({
      Platform: { isNative: false },
    }));

    const { setTrustedFingerprint } = await import('../ssl-trust');
    await setTrustedFingerprint('AA:BB:CC:DD');

    expect(mockSetTrustedFingerprint).not.toHaveBeenCalled();
  });

  it('pins a new fingerprint on native (accept/trust path)', async () => {
    vi.doMock('../platform', () => ({
      Platform: { isNative: true },
    }));

    const { setTrustedFingerprint } = await import('../ssl-trust');
    await setTrustedFingerprint('AA:BB:CC:DD');

    expect(mockSetTrustedFingerprint).toHaveBeenCalledWith({ fingerprint: 'AA:BB:CC:DD' });
  });

  it('can clear a pinned fingerprint by passing null (rejection path)', async () => {
    vi.doMock('../platform', () => ({
      Platform: { isNative: true },
    }));

    const { setTrustedFingerprint } = await import('../ssl-trust');
    await setTrustedFingerprint(null);

    expect(mockSetTrustedFingerprint).toHaveBeenCalledWith({ fingerprint: null });
  });

  it('swallows a native rejection instead of throwing', async () => {
    vi.doMock('../platform', () => ({
      Platform: { isNative: true },
    }));
    mockSetTrustedFingerprint.mockRejectedValueOnce(new Error('plugin write failed'));

    const { setTrustedFingerprint } = await import('../ssl-trust');
    await expect(setTrustedFingerprint('AA:BB')).resolves.toBeUndefined();
    expect(mockLogSslTrust).toHaveBeenCalledWith(
      'Failed to set trusted fingerprint',
      expect.anything(),
      expect.objectContaining({ error: expect.any(Error) })
    );
  });
});
