/**
 * useCertTrustPrompt tests
 *
 * This hook holds the actual TOFU (trust-on-first-use) decision logic for
 * self-signed certs on native: whether a freshly fetched certificate should be
 * treated as a silent first pin, a confirmed match, or a changed/mismatched
 * certificate that needs the user's explicit trust/cancel decision. Refs #217.
 *
 * Runs against the real profile and settings stores; only Platform,
 * ssl-trust and the logger are faked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  isNative: true,
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

vi.mock('../../lib/security/ssl-trust', () => ({
  applyTrustedCertificates: h.applyTrustedCertificates,
  getServerCertFingerprint: h.getServerCertFingerprint,
}));

// The real profile/auth stores (pulled in by seedProfiles/resetProfileFixture)
// log through profileService/auth on their own housekeeping (refresh-token
// sync, logout); stub those too so seeding doesn't crash on an undefined
// method, alongside sslTrust which the hook itself calls.
vi.mock('../../lib/logger', () => ({
  log: { sslTrust: h.logSslTrust, profileService: vi.fn(), auth: vi.fn() },
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
}));

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

const mockApplyTrustedCertificates = h.applyTrustedCertificates;
const mockGetServerCertFingerprint = h.getServerCertFingerprint;
const mockLogSslTrust = h.logSslTrust;

import { useCertTrustPrompt } from '../useCertTrustPrompt';
import { useSettingsStore } from '../../stores/settings';
import { makeProfile, seedProfiles, resetProfileFixture, asProfileId } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';

const CERT_INFO = {
  fingerprint: 'AA:BB:CC:DD',
  subject: 'CN=zm.example.com',
  issuer: 'CN=zm.example.com',
  expiry: '2027-01-01',
};

const PROFILE_ID = asProfileId('profile-1');

function seedWithFingerprint(fingerprint: string | null) {
  seedProfiles([makeProfile('profile-1', { portalUrl: 'https://zm.example.com' })], {
    settings: { 'profile-1': { trustedCertFingerprint: fingerprint } },
  });
}

describe('useCertTrustPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.isNative = true;
    seedWithFingerprint(null);
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
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
    resetProfileFixture();
    const { result } = renderHook(() => useCertTrustPrompt());

    await act(async () => {
      await result.current.prompt();
    });

    expect(mockGetServerCertFingerprint).not.toHaveBeenCalled();
    expect(result.current.dialogProps.open).toBe(false);
  });

  it('accept-on-first-use: opens the dialog with isChanged=false when no fingerprint is pinned yet', async () => {
    seedWithFingerprint(null);
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
    seedWithFingerprint(CERT_INFO.fingerprint);
    mockGetServerCertFingerprint.mockResolvedValue(CERT_INFO);

    const { result } = renderHook(() => useCertTrustPrompt());
    await act(async () => {
      await result.current.prompt();
    });

    expect(result.current.dialogProps.isChanged).toBe(false);
    expect(result.current.dialogProps.open).toBe(true);
  });

  it('mismatch: isChanged=true when the fetched fingerprint differs from the stored pin', async () => {
    seedWithFingerprint('FF:EE:DD:CC');
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
    seedWithFingerprint('FF:EE:DD:CC');
    mockGetServerCertFingerprint.mockResolvedValue(CERT_INFO);

    const { result } = renderHook(() => useCertTrustPrompt());
    await act(async () => {
      await result.current.prompt();
    });
    expect(result.current.dialogProps.open).toBe(true);

    await act(async () => {
      await result.current.dialogProps.onTrust();
    });

    const settings = useSettingsStore.getState().getProfileSettings(PROFILE_ID);
    expect(settings.allowSelfSignedCerts).toBe(true);
    expect(settings.trustedCertFingerprint).toBe(CERT_INFO.fingerprint);
    // Called once from prompt's TOFU enable, once more from onTrust's re-apply with the pinned fingerprint
    expect(mockApplyTrustedCertificates).toHaveBeenCalledTimes(2);
    expect(result.current.dialogProps.open).toBe(false);
  });

  it('onCancel closes the dialog without pinning (rejection path)', async () => {
    seedWithFingerprint('FF:EE:DD:CC');
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
    const settings = useSettingsStore.getState().getProfileSettings(PROFILE_ID);
    expect(settings.allowSelfSignedCerts).toBe(false);
    expect(settings.trustedCertFingerprint).toBe('FF:EE:DD:CC');
    // applyTrustedCertificates was called once already (from prompt's TOFU enable), never again with a pin
    expect(mockApplyTrustedCertificates).toHaveBeenCalledTimes(1);
  });

  it('onTrust is a no-op without a current profile or fetched cert info', async () => {
    const { result } = renderHook(() => useCertTrustPrompt());

    await act(async () => {
      await result.current.dialogProps.onTrust();
    });

    const settings = useSettingsStore.getState().getProfileSettings(PROFILE_ID);
    expect(settings.allowSelfSignedCerts).toBe(false);
    expect(mockApplyTrustedCertificates).not.toHaveBeenCalled();
  });
});
