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

/**
 * Tolerant when reading, strict when writing (refs #247).
 *
 * `MonitorFunction` is `string` because it holds whatever ZoneMinder reports,
 * and a release that adds a value must not blank the monitors list (see
 * MonitorSchema's note). `WritableMonitorFunction` is the narrow set we are
 * willing to SEND: we choose those, so there is no reason to give up the
 * compile-time check on the way out.
 */
export const KNOWN_MONITOR_FUNCTIONS = ['None', 'Monitor', 'Modect', 'Record', 'Mocord', 'Nodect'] as const;
export type MonitorFunction = string;
export type WritableMonitorFunction = (typeof KNOWN_MONITOR_FUNCTIONS)[number];

/** Narrows a read value to one we are allowed to write back. A real guard, not
 *  a cast: the mode picker is built from the same list, so this only fires if
 *  those two ever drift apart, and then it says so instead of sending garbage
 *  to ZoneMinder. */
export function isWritableMonitorFunction(value: string): value is WritableMonitorFunction {
  return (KNOWN_MONITOR_FUNCTIONS as readonly string[]).includes(value);
}

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
      if (!isWritableMonitorFunction(nextMode)) {
        log.monitorDetail('Refusing to set an unrecognized monitor function', LogLevel.ERROR, {
          monitorId,
          nextMode,
        });
        return;
      }

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
