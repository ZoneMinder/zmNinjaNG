/**
 * Hook for monitor mode/function control
 *
 * Handles changing monitor function (Modect, Monitor, Mocord, etc.) with loading state.
 */

import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { changeMonitorFunction } from '../../api/monitors';
import { log, LogLevel } from '../../lib/logger';

export type MonitorFunction = 'None' | 'Monitor' | 'Modect' | 'Record' | 'Mocord' | 'Nodect';

interface UseModeControlOptions {
  monitorId: string | undefined;
  currentFunction: MonitorFunction | undefined;
  onSuccess?: () => Promise<unknown>;
}

interface UseModeControlReturn {
  isModeUpdating: boolean;
  handleModeChange: (nextMode: MonitorFunction) => Promise<void>;
}

export function useModeControl({
  monitorId,
  currentFunction,
  onSuccess,
}: UseModeControlOptions): UseModeControlReturn {
  const { t } = useTranslation();
  const [isModeUpdating, setIsModeUpdating] = useState(false);

  const handleModeChange = useCallback(
    async (nextMode: MonitorFunction) => {
      if (!monitorId) return;
      if (currentFunction === nextMode) return;

      setIsModeUpdating(true);
      try {
        await changeMonitorFunction(monitorId, nextMode);
        if (onSuccess) {
          await onSuccess();
        }
        toast.success(t('monitor_detail.mode_updated'));
      } catch (modeError) {
        log.monitorDetail('Monitor mode update failed', LogLevel.ERROR, {
          monitorId,
          nextMode,
          error: modeError,
        });
        toast.error(t('monitor_detail.mode_failed'));
      } finally {
        setIsModeUpdating(false);
      }
    },
    [monitorId, currentFunction, onSuccess, t]
  );

  return {
    isModeUpdating,
    handleModeChange,
  };
}
