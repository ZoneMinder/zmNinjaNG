/**
 * CertTrustBanner
 *
 * On native, when a profile has self-signed certs enabled but no fingerprint
 * pinned, the API still works (CapacitorHttp accepts the cert) but WebView
 * image loads (thumbnails, MJPEG) are rejected, so they fail silently. This
 * banner surfaces that state and lets the user pin the certificate in one tap.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, X } from 'lucide-react';
import { Platform } from '../lib/platform';
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { useCertTrustPrompt } from '../hooks/useCertTrustPrompt';
import { CertTrustDialog } from './CertTrustDialog';
import { Button } from './ui/button';

export function CertTrustBanner() {
  const { t } = useTranslation();
  const { settings } = useCurrentProfile();
  const { prompt, verifying, dialogProps } = useCertTrustPrompt();
  const [dismissed, setDismissed] = useState(false);

  const needsTrust =
    Platform.isNative && settings.allowSelfSignedCerts && !settings.trustedCertFingerprint;

  return (
    <>
      {needsTrust && !dismissed && (
        <div
          className="mx-3 mt-2 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2"
          data-testid="cert-trust-banner"
        >
          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{t('ssl.untrusted_banner_title')}</p>
            <p className="text-xs text-muted-foreground">{t('ssl.untrusted_banner_desc')}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={verifying}
            onClick={prompt}
            data-testid="cert-trust-banner-verify"
          >
            {t('ssl.verify_button')}
          </Button>
          <button
            type="button"
            aria-label={t('common.close')}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => setDismissed(true)}
            data-testid="cert-trust-banner-dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <CertTrustDialog {...dialogProps} />
    </>
  );
}
