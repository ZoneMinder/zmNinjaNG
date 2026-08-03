/**
 * Hook for PTZ camera control.
 *
 * Press-to-start / release-to-stop is implemented in the PTZControls
 * component via pointer events; this hook just dispatches each command.
 */

import { useCallback } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { controlMonitor } from '../../api/monitors';
import { getSession, getCurrentSession } from '../../services/sessions';
import { log, LogLevel } from '../../lib/logger';
import type { ProfileId } from '../../api/types';

interface UsePTZControlOptions {
  portalUrl: string;
  monitorId: string;
  accessToken: string | null;
  minStreamingPort?: number;
  /** Owning profile for an /all/ deep route; defaults to the current profile. */
  profileId?: ProfileId;
}

interface UsePTZControlReturn {
  handlePTZCommand: (command: string) => Promise<void>;
}

export function usePTZControl({
  portalUrl,
  monitorId,
  accessToken,
  minStreamingPort,
  profileId,
}: UsePTZControlOptions): UsePTZControlReturn {
  const { t } = useTranslation();

  const handlePTZCommand = useCallback(
    async (command: string) => {
      if (!portalUrl || !monitorId) return;

      try {
        const client = (profileId ? getSession(profileId) : getCurrentSession()).client;
        await controlMonitor(client, portalUrl, monitorId, command, accessToken || undefined, minStreamingPort);
      } catch (error) {
        log.monitorDetail('PTZ command failed', LogLevel.ERROR, { command, error });
        toast.error(t('monitor_detail.ptz_failed'));
      }
    },
    [portalUrl, monitorId, accessToken, minStreamingPort, profileId, t]
  );

  return { handlePTZCommand };
}
