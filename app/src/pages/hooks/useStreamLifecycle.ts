/**
 * Hook for ZMS stream lifecycle management
 *
 * Handles connKey generation, CMD_QUIT cleanup on navigation, and media element cleanup.
 */

import { useState, useEffect, useRef, type RefObject } from 'react';
import { httpGet } from '../../lib/http';
import { getZmsControlUrl } from '../../lib/url-builder';
import { ZMS_COMMANDS } from '../../lib/zm-constants';
import { useMonitorStore } from '../../stores/monitors';
import { log, LogLevel } from '../../lib/logger';

interface UseStreamLifecycleOptions {
  monitorId: string | undefined;
  monitorName: string | undefined;
  portalUrl: string | undefined;
  accessToken: string | null;
  mediaRef: RefObject<HTMLImageElement | HTMLVideoElement | null>;
}

interface UseStreamLifecycleReturn {
  connKey: number;
}

export function useStreamLifecycle({
  monitorId,
  monitorName,
  portalUrl,
  accessToken,
  mediaRef,
}: UseStreamLifecycleOptions): UseStreamLifecycleReturn {
  const [connKey, setConnKey] = useState(0);
  const regenerateConnKey = useMonitorStore((state) => state.regenerateConnKey);

  // Track previous connKey to send CMD_QUIT before regenerating
  const prevConnKeyRef = useRef<number>(0);
  const isInitialMountRef = useRef(true);

  // Force regenerate connKey when component mounts or monitor ID changes
  useEffect(() => {
    if (!monitorId || !portalUrl) return;

    // Send CMD_QUIT for previous connKey before generating new one (skip on initial mount)
    if (!isInitialMountRef.current && prevConnKeyRef.current !== 0) {
      const controlUrl = getZmsControlUrl(portalUrl, ZMS_COMMANDS.cmdQuit, prevConnKeyRef.current.toString(), {
        token: accessToken || undefined,
      });

      log.monitorDetail('Sending CMD_QUIT before regenerating connkey', LogLevel.DEBUG, {
        monitorId,
        monitorName,
        oldConnkey: prevConnKeyRef.current,
      });

      httpGet(controlUrl).catch(() => {
        // Silently ignore errors - connection may already be closed
      });
    }

    isInitialMountRef.current = false;

    // Generate new connKey
    log.monitorDetail('Regenerating connkey', LogLevel.DEBUG, { monitorId });
    const newKey = regenerateConnKey(monitorId);
    setConnKey(newKey);
    prevConnKeyRef.current = newKey;
  }, [monitorId, portalUrl, accessToken, monitorName, regenerateConnKey]);

  // Store cleanup parameters in ref to access latest values on unmount
  const cleanupParamsRef = useRef({
    monitorId: '',
    monitorName: '',
    connKey: 0,
    portalUrl: '',
    token: accessToken,
  });

  // Update cleanup params whenever they change
  useEffect(() => {
    cleanupParamsRef.current = {
      monitorId: monitorId || '',
      monitorName: monitorName || '',
      connKey,
      portalUrl: portalUrl || '',
      token: accessToken,
    };
  }, [monitorId, monitorName, connKey, portalUrl, accessToken]);

  // Cleanup: send CMD_QUIT and abort image loading on unmount ONLY
  useEffect(() => {
    return () => {
      const params = cleanupParamsRef.current;

      // Send CMD_QUIT to properly close the stream connection
      if (params.portalUrl && params.monitorId && params.connKey !== 0) {
        const controlUrl = getZmsControlUrl(
          params.portalUrl,
          ZMS_COMMANDS.cmdQuit,
          params.connKey.toString(),
          {
            token: params.token || undefined,
          }
        );

        log.monitorDetail('Sending CMD_QUIT on unmount', LogLevel.DEBUG, {
          monitorId: params.monitorId,
          monitorName: params.monitorName,
          connkey: params.connKey,
        });

        // Send CMD_QUIT asynchronously, ignore errors
        httpGet(controlUrl).catch(() => {
          // Silently ignore errors - server connection may already be closed
        });
      }

      // Abort image loading to release browser connection
      if (mediaRef.current && params.monitorId) {
        log.monitorDetail('Aborting media element', LogLevel.DEBUG, { monitorId: params.monitorId });
        mediaRef.current.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      }
    };
  }, [mediaRef]);

  return { connKey };
}
