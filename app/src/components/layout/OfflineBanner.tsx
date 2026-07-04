/**
 * Offline Banner
 *
 * Persistent banner shown at the top of the main content area while the
 * device/browser has no network connectivity (see useNetworkStatus.ts).
 * Not dismissible: it tracks live connectivity state and disappears on its
 * own once the connection returns, so there's nothing useful for a user to
 * dismiss. refs #217
 */

import { useTranslation } from 'react-i18next';
import { WifiOff } from 'lucide-react';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';

export function OfflineBanner() {
  const { t } = useTranslation();
  const { isOnline } = useNetworkStatus();

  if (isOnline) return null;

  return (
    <div
      className="bg-muted text-muted-foreground px-3 py-2 flex items-center gap-2 text-sm border-b"
      data-testid="offline-banner"
      role="status"
    >
      <WifiOff className="h-4 w-4 flex-shrink-0" />
      <span className="truncate min-w-0">{t('network.offline_banner')}</span>
    </div>
  );
}
