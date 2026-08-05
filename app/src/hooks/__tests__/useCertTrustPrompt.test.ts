/**
 * useCertTrustPrompt tests
 *
 * This hook holds the actual TOFU (trust-on-first-use) decision logic for
 * self-signed certs on native: whether a freshly fetched certificate should be
 * treated as a silent first pin, a confirmed match, or a changed/mismatched
 * certificate that needs the user's explicit trust/cancel decision. Refs #217.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  isNative: true,
  currentProfile: { id: 'profile-1', portalUrl: 'https://zm.example.com' } as {
    id: string;
    portalUrl: string;
  } | null,
  trustedCertFingerprint: null as string | null,
  updateProfileSettings: vi.fn(),
  applyTrustedCertificates: vi.fn().mockResolvedValue(undefined),
  getServerCertFingerprint: vi.fn(),
  logSslTrust: vi.fn(),
}));

vi.mock('../../lib/platform', () => ({
  Platform: {
    get isNative() {
      return h.isNative;
    },
  },
}));

vi.mock('../useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    currentProfile: h.currentProfile,
    settings: { trustedCertFingerprint: h.trustedCertFingerprint },
  }),
}));

vi.mock('../../stores/settings', () => ({
  useSettingsStore: (selector: (s: { updateProfileSettings: typeof h.updateProfileSettings }) => unknown) =>
    selector({ updateProfileSettings: h.updateProfileSettings }),
}));

vi.mock('../../lib/security/ssl-trust', () => ({
  applyTrustedCertificates: h.applyTrustedCertificates,
  getServerCertFingerprint: h.getServerCertFingerprint,
}));

vi.mock('../../lib/logger', () => ({
  log: { sslTrust: h.logSslTrust },
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
}));

const mockApplyTrustedCertificates = h.applyTrustedCertificates;
const mockGetServerCertFingerprint = h.getServerCertFingerprint;
const mockLogSslTrust = h.logSslTrust;

import { useCertTrustPrompt } from '../useCertTrustPrompt';

const CERT_INFO = {
  fingerprint: 'AA:BB:CC:DD',
  subject: 'CN=zm.example.com',
  issuer: 'CN=zm.example.com',
  expiry: '2027-01-01',
};

describe('useCertTrustPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.isNative = true;
    h.currentProfile = { id: 'profile-1', portalUrl: 'https://zm.example.com' };
    h.trustedCertFingerprint = null;
  });

  it('is a no-op on non-native platforms', async () => {
    h.isNative = false;
    const { result } = renderHook(() => useCertTrustPrompt());

    await act(async () => {
      await result.current.prompt();
    });

    expect(mockGetServerCertFingerprint).not.toHaveBeenCalled();
    expect(result.current.dialogProps.open).toBe(false);
  });

  it('is a no-op when there is no current profile', async () => {
    h.currentProfile = null;
    const { result } = renderHook(() => useCertTrustPrompt());

    await act(async () => {
      await result.current.prompt();
    });

    expect(mockGetServerCertFingerprint).not.toHaveBeenCalled();
    expect(result.current.dialogProps.open).toBe(false);
  });

  it('accept-on-first-use: opens the dialog with isChanged=false when no fingerprint is pinned yet', async () => {
    h.trustedCertFingerprint = null;
    mockGetServerCertFingerprint.mockResolvedValue(CERT_INFO);

    const { result } = renderHook(() => useCertTrustPrompt());
    await act(async () => {
      await result.current.prompt();
    });

    expect(mockApplyTrustedCertificates).toHaveBeenCalled();
    expect(mockGetServerCertFingerprint).toHaveBeenCalledWith('https://zm.example.com');
    expect(result.current.dialogProps.open).toBe(true);
    expect(result.current.dialogProps.certInfo).toEqual(CERT_INFO);
    expect(result.current.dialogProps.isChanged).toBe(false);
  });

  it('pin match: isChanged=false when the fetched fingerprint matches the stored pin', async () => {
    h.trustedCertFingerprint = CERT_INFO.fingerprint;
    mockGetServerCertFingerprint.mockResolvedValue(CERT_INFO);

    const { result } = renderHook(() => useCertTrustPrompt());
    await act(async () => {
      await result.current.prompt();
    });

    expect(result.current.dialogProps.isChanged).toBe(false);
    expect(result.current.dialogProps.open).toBe(true);
  });

  it('mismatch: isChanged=true when the fetched fingerprint differs from the stored pin', async () => {
    h.trustedCertFingerprint = 'FF:EE:DD:CC';
    mockGetServerCertFingerprint.mockResolvedValue(CERT_INFO);

    const { result } = renderHook(() => useCertTrustPrompt());
    await act(async () => {
      await result.current.prompt();
    });

    expect(result.current.dialogProps.isChanged).toBe(true);
    expect(result.current.dialogProps.certInfo).toEqual(CERT_INFO);
    expect(result.current.dialogProps.open).toBe(true);
  });

  it('does not open the dialog when the certificate cannot be fetched', async () => {
    mockGetServerCertFingerprint.mockResolvedValue(null);

    const { result } = renderHook(() => useCertTrustPrompt());
    await act(async () => {
      await result.current.prompt();
    });

    expect(result.current.dialogProps.open).toBe(false);
    expect(mockLogSslTrust).toHaveBeenCalledWith('Could not fetch certificate to verify', expect.anything());
  });

  it('handles a rejected certificate fetch without throwing', async () => {
    mockGetServerCertFingerprint.mockRejectedValue(new Error('network unreachable'));

    const { result } = renderHook(() => useCertTrustPrompt());
    await act(async () => {
      await expect(result.current.prompt()).resolves.toBeUndefined();
    });

    expect(result.current.dialogProps.open).toBe(false);
    expect(result.current.verifying).toBe(false);
    expect(mockLogSslTrust).toHaveBeenCalledWith(
      'Failed to fetch certificate for trust prompt',
      expect.anything(),
      expect.objectContaining({ error: expect.any(Error) })
    );
  });

  it('sets verifying=true while the fetch is in flight and false once it settles', async () => {
    let resolveFetch: (value: typeof CERT_INFO) => void;
    mockGetServerCertFingerprint.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );

    const { result } = renderHook(() => useCertTrustPrompt());

    let promptPromise: Promise<void>;
    act(() => {
      promptPromise = result.current.prompt();
    });

    await waitFor(() => expect(result.current.verifying).toBe(true));

    await act(async () => {
      resolveFetch(CERT_INFO);
      await promptPromise;
    });

    expect(result.current.verifying).toBe(false);
  });

  it('onTrust pins the fingerprint, enables self-signed certs, and re-applies with the new pin', async () => {
    h.trustedCertFingerprint = 'FF:EE:DD:CC';
    mockGetServerCertFingerprint.mockResolvedValue(CERT_INFO);

    const { result } = renderHook(() => useCertTrustPrompt());
    await act(async () => {
      await result.current.prompt();
    });
    expect(result.current.dialogProps.open).toBe(true);

    await act(async () => {
      await result.current.dialogProps.onTrust();
    });

    expect(h.updateProfileSettings).toHaveBeenCalledWith('profile-1', {
      allowSelfSignedCerts: true,
      trustedCertFingerprint: CERT_INFO.fingerprint,
    });
    // Called once from prompt's TOFU enable, once more from onTrust's re-apply with the pinned fingerprint
    expect(mockApplyTrustedCertificates).toHaveBeenCalledTimes(2);
    expect(result.current.dialogProps.open).toBe(false);
  });

  it('onCancel closes the dialog without pinning (rejection path)', async () => {
    h.trustedCertFingerprint = 'FF:EE:DD:CC';
    mockGetServerCertFingerprint.mockResolvedValue(CERT_INFO);

    const { result } = renderHook(() => useCertTrustPrompt());
    await act(async () => {
      await result.current.prompt();
    });
    expect(result.current.dialogProps.open).toBe(true);

    act(() => {
      result.current.dialogProps.onCancel();
    });

    expect(result.current.dialogProps.open).toBe(false);
    expect(h.updateProfileSettings).not.toHaveBeenCalled();
    // applyTrustedCertificates was called once already (from prompt's TOFU enable), never again with a pin
    expect(mockApplyTrustedCertificates).toHaveBeenCalledTimes(1);
  });

  it('onTrust is a no-op without a current profile or fetched cert info', async () => {
    const { result } = renderHook(() => useCertTrustPrompt());

    await act(async () => {
      await result.current.dialogProps.onTrust();
    });

    expect(h.updateProfileSettings).not.toHaveBeenCalled();
    expect(mockApplyTrustedCertificates).not.toHaveBeenCalled();
  });
});
