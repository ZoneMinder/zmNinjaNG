import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

const h = vi.hoisted(() => ({
  promptSpy: vi.fn(),
  isNative: true,
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
import { seedProfiles, resetProfileFixture } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';

describe('CertTrustBanner', () => {
  beforeEach(() => {
    h.promptSpy.mockClear();
    h.isNative = true;
    seedProfiles(['p1'], { settings: { p1: { allowSelfSignedCerts: true, trustedCertFingerprint: null } } });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('shows when self-signed is enabled with no pinned fingerprint on native', () => {
    render(<CertTrustBanner />);
    expect(screen.getByTestId('cert-trust-banner')).toBeTruthy();
  });

  it('is hidden once a fingerprint is pinned', () => {
    seedProfiles(['p1'], { settings: { p1: { allowSelfSignedCerts: true, trustedCertFingerprint: 'AA:BB' } } });
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
