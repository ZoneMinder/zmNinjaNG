import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({
  promptSpy: vi.fn(),
  settings: { allowSelfSignedCerts: true, trustedCertFingerprint: null as string | null },
  isNative: true,
}));

vi.mock('../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    currentProfile: { id: 'p1', portalUrl: 'https://host' },
    settings: h.settings,
  }),
}));
vi.mock('../../hooks/useCertTrustPrompt', () => ({
  useCertTrustPrompt: () => ({
    prompt: h.promptSpy,
    verifying: false,
    dialogProps: { open: false, certInfo: null, isChanged: false, onTrust: vi.fn(), onCancel: vi.fn() },
  }),
}));
vi.mock('../../lib/platform', () => ({
  Platform: { get isNative() { return h.isNative; } },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { CertTrustBanner } from '../CertTrustBanner';

describe('CertTrustBanner', () => {
  beforeEach(() => {
    h.promptSpy.mockClear();
    h.settings = { allowSelfSignedCerts: true, trustedCertFingerprint: null };
    h.isNative = true;
  });

  it('shows when self-signed is enabled with no pinned fingerprint on native', () => {
    render(<CertTrustBanner />);
    expect(screen.getByTestId('cert-trust-banner')).toBeTruthy();
  });

  it('is hidden once a fingerprint is pinned', () => {
    h.settings = { allowSelfSignedCerts: true, trustedCertFingerprint: 'AA:BB' };
    render(<CertTrustBanner />);
    expect(screen.queryByTestId('cert-trust-banner')).toBeNull();
  });

  it('is hidden on non-native platforms', () => {
    h.isNative = false;
    render(<CertTrustBanner />);
    expect(screen.queryByTestId('cert-trust-banner')).toBeNull();
  });

  it('triggers the trust prompt when Verify is tapped', () => {
    render(<CertTrustBanner />);
    fireEvent.click(screen.getByTestId('cert-trust-banner-verify'));
    expect(h.promptSpy).toHaveBeenCalledTimes(1);
  });

  it('can be dismissed', () => {
    render(<CertTrustBanner />);
    fireEvent.click(screen.getByTestId('cert-trust-banner-dismiss'));
    expect(screen.queryByTestId('cert-trust-banner')).toBeNull();
  });
});
