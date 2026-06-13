import { describe, it, expect, vi } from 'vitest';
import { requestCertTrust, onCertTrustRequest } from '../cert-trust-event';
import type { CertInfo } from '../ssl-trust';

const cert: CertInfo = {
  fingerprint: 'AA:BB',
  subject: 'CN=host',
  issuer: 'CN=host',
  expiry: '2030-01-01',
};

describe('cert-trust-event', () => {
  it('delivers to a registered listener', () => {
    const fn = vi.fn();
    const off = onCertTrustRequest(fn);
    requestCertTrust('p1', cert);
    expect(fn).toHaveBeenCalledWith({ profileId: 'p1', certInfo: cert });
    off();
  });

  it('buffers a request fired before any listener registers, then delivers on register', () => {
    // bootstrap fires before AppLayout mounts
    requestCertTrust('p2', cert);

    const fn = vi.fn();
    const off = onCertTrustRequest(fn);
    expect(fn).toHaveBeenCalledWith({ profileId: 'p2', certInfo: cert });
    off();
  });

  it('does not redeliver the buffered request to a later listener', () => {
    requestCertTrust('p3', cert);

    const first = vi.fn();
    onCertTrustRequest(first)();
    expect(first).toHaveBeenCalledTimes(1);

    const second = vi.fn();
    onCertTrustRequest(second)();
    expect(second).not.toHaveBeenCalled();
  });
});
