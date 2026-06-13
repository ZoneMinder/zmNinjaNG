import type { CertInfo } from './ssl-trust';

export interface PendingCertTrust {
  profileId: string;
  certInfo: CertInfo;
}

type CertTrustListener = (pending: PendingCertTrust) => void;

let listener: CertTrustListener | null = null;
let pending: PendingCertTrust | null = null;

/**
 * Called by bootstrap when self-signed certs are enabled but no fingerprint is stored.
 * The UI component listens via onCertTrustRequest and shows the TOFU dialog.
 *
 * On cold start bootstrap can fire before the UI listener (AppLayout) has
 * mounted. Buffer the request in that case and deliver it once a listener
 * registers, so the dialog is not silently dropped.
 */
export function requestCertTrust(profileId: string, certInfo: CertInfo): void {
  const request = { profileId, certInfo };
  if (listener) {
    listener(request);
  } else {
    pending = request;
  }
}

/**
 * Register a listener for cert trust requests. Returns a cleanup function.
 * Any request buffered before registration is delivered immediately.
 */
export function onCertTrustRequest(fn: CertTrustListener): () => void {
  listener = fn;
  if (pending) {
    const buffered = pending;
    pending = null;
    fn(buffered);
  }
  return () => { listener = null; };
}
