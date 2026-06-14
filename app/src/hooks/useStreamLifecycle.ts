/**
 * Stream Lifecycle Hook
 *
 * Encapsulates the shared connection-key lifecycle pattern used by monitor
 * streams. Handles:
 * - connKey state generation via the monitor store
 * - CMD_QUIT before connKey regeneration (skips initial mount)
 * - CMD_QUIT on unmount (streaming mode only)
 * - Image/media element abort on unmount to release browser connections
 * - cleanupParamsRef pattern to capture latest values for the unmount effect
 */

import { useState, useEffect, useRef } from 'react';
import { getZmsControlUrl } from '../lib/url-builder';
import { ZMS_COMMANDS } from '../lib/zm-constants';
import { httpGet } from '../lib/http';
import { API_REQUEST } from '../lib/zmninja-ng-constants';
import { useMonitorStore } from '../stores/monitors';
import { log, LogLevel } from '../lib/logger';

/** Signature of a component-scoped log helper (e.g. log.monitor, log.dashboard). */
type ComponentLogger = (message: string, level?: LogLevel, details?: unknown) => void;

export interface UseStreamLifecycleOptions {
  /** Monitor ID to generate a connKey for. When undefined the hook is inert. */
  monitorId: string | undefined;
  /** Human-readable name, used only for log messages. */
  monitorName?: string;
  /** Portal URL of the active profile, needed for CMD_QUIT requests. */
  portalUrl: string | undefined;
  /** Auth token appended to CMD_QUIT requests. */
  accessToken: string | null;
  /** Current view mode: CMD_QUIT is only sent in streaming mode. */
  viewMode: 'streaming' | 'snapshot';
  /** Ref to the <img> or <video> element whose src is cleared on unmount. */
  mediaRef: React.RefObject<HTMLImageElement | HTMLVideoElement | null>;
  /** Component-scoped log function (e.g. log.monitor, log.montageMonitor). */
  logFn: ComponentLogger;
  /**
   * When true the hook is fully enabled. When false the hook skips connKey
   * generation and cleanup param tracking. Defaults to true.
   */
  enabled?: boolean;
  /** Base port for multi-port streaming (port = minStreamingPort + monitorId). */
  minStreamingPort?: number;
  /**
   * Profile's API request timeout (seconds), applied to CMD_QUIT so teardown
   * requests follow the same timeout as the rest of the app's HTTP. 0 disables
   * it. Defaults to the built-in default when not supplied.
   */
  apiTimeoutSeconds?: number;
}

export interface UseStreamLifecycleReturn {
  /** The current connection key. 0 means no key has been generated yet. */
  connKey: number;
  /**
   * Force-regenerate the connKey. By default skips CMD_QUIT. Pass
   * `killPrevious: true` when the previous stream may still be alive on the
   * server (visibility resume, manual retry, error-driven reconnect) so its
   * nph-zms process is closed before a new one is started. An `<img>` error
   * cannot tell a dead server process from a dropped-but-alive one, so the
   * reconnect path passes `killPrevious: true` to avoid orphaning a connkey.
   */
  forceRegenerate: (options?: { killPrevious?: boolean }) => number;
  /**
   * Release the current connkey without minting a new one: sends CMD_QUIT for
   * it and clears the stored key so the next mount/retry starts fresh. Used
   * when the reconnect loop gives up, so the final connkey is not orphaned
   * until unmount.
   */
  releaseConnection: () => void;
}

/**
 * Manages the ZMS connection-key lifecycle for a single monitor stream.
 *
 * The hook generates a unique connKey on mount (and when monitorId changes),
 * sends CMD_QUIT for the previous connKey before regenerating, and sends a
 * final CMD_QUIT on unmount. It also clears the media element src on unmount
 * to abort in-flight image loads and free browser connections.
 */
export function useStreamLifecycle({
  monitorId,
  monitorName,
  portalUrl,
  accessToken,
  viewMode,
  mediaRef,
  logFn,
  enabled = true,
  minStreamingPort,
  apiTimeoutSeconds = API_REQUEST.defaultTimeoutSeconds,
}: UseStreamLifecycleOptions): UseStreamLifecycleReturn {
  const regenerateConnKey = useMonitorStore((state) => state.regenerateConnKey);

  // CMD_QUIT follows the same timeout as the rest of the app's HTTP. 0 disables.
  const cmdQuitTimeoutMs = apiTimeoutSeconds > 0 ? apiTimeoutSeconds * 1000 : undefined;

  const [connKey, setConnKey] = useState(0);

  // Track previous connKey to send CMD_QUIT before regenerating
  const prevConnKeyRef = useRef<number>(0);
  const isInitialMountRef = useRef(true);

  // Regenerate connKey on mount or when monitorId changes
  useEffect(() => {
    if (!enabled || !monitorId) return;

    // If we already have a connKey for this monitor, don't regenerate
    // (only regenerate when first enabled or monitor changes)
    if (connKey !== 0 && !isInitialMountRef.current) return;

    // Send CMD_QUIT for previous connKey before generating new one (skip on initial mount)
    if (
      !isInitialMountRef.current &&
      prevConnKeyRef.current !== 0 &&
      viewMode === 'streaming' &&
      portalUrl
    ) {
      const controlUrl = getZmsControlUrl(
        portalUrl,
        ZMS_COMMANDS.cmdQuit,
        prevConnKeyRef.current.toString(),
        { token: accessToken || undefined, minStreamingPort, monitorId },
      );

      // Connkey churn: a montage view can regenerate many keys within ms.
      // Dedupe the per-monitor chatter into a single line per 3s window;
      // on subsequent emits we surface the suppressed count.
      log.dedupe('connkey-cmd-quit-pre-regen', 3000, (suffix) =>
        logFn(`Sending CMD_QUIT before regenerating connkey${suffix}`, LogLevel.DEBUG, {
          monitorId,
          monitorName,
          oldConnkey: prevConnKeyRef.current,
        }),
      );

      httpGet(controlUrl, { timeoutMs: cmdQuitTimeoutMs }).catch(() => {
        // Silently ignore errors - connection may already be closed
      });
    }

    isInitialMountRef.current = false;

    // Generate new connKey
    log.dedupe('connkey-regen', 3000, (suffix) =>
      logFn(`Regenerating connkey${suffix}`, LogLevel.DEBUG, { monitorId, monitorName }),
    );
    const newKey = regenerateConnKey(monitorId);
    setConnKey(newKey);
    prevConnKeyRef.current = newKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monitorId, enabled]);

  // Store cleanup parameters in ref to access latest values on unmount
  const cleanupParamsRef = useRef({
    monitorId: monitorId || '',
    monitorName: monitorName || '',
    connKey: 0,
    portalUrl,
    token: accessToken,
    viewMode,
    minStreamingPort,
    cmdQuitTimeoutMs,
  });

  // Update cleanup params whenever they change
  useEffect(() => {
    if (!enabled) return;
    cleanupParamsRef.current = {
      monitorId: monitorId || '',
      monitorName: monitorName || '',
      connKey,
      portalUrl,
      token: accessToken,
      viewMode,
      minStreamingPort,
      cmdQuitTimeoutMs,
    };
  }, [enabled, monitorId, monitorName, connKey, portalUrl, accessToken, viewMode, minStreamingPort, cmdQuitTimeoutMs]);

  // Capture the live media element on every render. The unmount cleanup runs as
  // a passive effect, by which point React has already nulled mediaRef, so we
  // keep our own handle to the element to tear it down.
  const mediaElRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null);
  useEffect(() => {
    mediaElRef.current = mediaRef.current;
  });

  // Cleanup: send CMD_QUIT and abort image loading on unmount ONLY
  useEffect(() => {
    return () => {
      const params = cleanupParamsRef.current;

      // Send CMD_QUIT to properly close the stream connection (only in streaming mode)
      if (
        params.viewMode === 'streaming' &&
        params.portalUrl &&
        params.monitorId &&
        params.connKey !== 0
      ) {
        const controlUrl = getZmsControlUrl(
          params.portalUrl,
          ZMS_COMMANDS.cmdQuit,
          params.connKey.toString(),
          { token: params.token || undefined, minStreamingPort: params.minStreamingPort, monitorId: params.monitorId },
        );

        log.dedupe('connkey-cmd-quit-unmount', 3000, (suffix) =>
          logFn(`Sending CMD_QUIT on unmount${suffix}`, LogLevel.DEBUG, {
            monitorId: params.monitorId,
            monitorName: params.monitorName,
            connkey: params.connKey,
          }),
        );

        // Send CMD_QUIT asynchronously, ignore errors (connection may already be closed)
        httpGet(controlUrl, { timeoutMs: params.cmdQuitTimeoutMs }).catch(() => {
          // Silently ignore errors - server connection may already be closed
        });

        // Drop the stored connkey so the next mount of this monitor gets a
        // fresh key instead of reusing the one we just quit (a quit key can
        // collide with the server-side stream state). The params.connKey !== 0
        // guard above keeps the StrictMode throwaway-mount cleanup out of this
        // path; the store comparison keeps a concurrent mount's newer key
        // intact: only the key this cleanup quit is cleared, never a newer one.
        const store = useMonitorStore.getState();
        if (store.connKeys[params.monitorId] === params.connKey) {
          store.clearConnKey(params.monitorId);
        }
      }

      // After CMD_QUIT, tear down the client side: removing the src aborts the
      // in-flight nph-zms connection and frees the browser connection slot.
      // Use removeAttribute, not src='' (an empty src resolves to the page URL
      // on some engines and triggers a spurious request).
      if (mediaElRef.current) {
        logFn('Aborting media element on unmount', LogLevel.DEBUG, {
          monitorId: params.monitorId,
        });
        mediaElRef.current.removeAttribute('src');
      }
    };
  }, []); // Empty deps = only run on unmount

  // Send CMD_QUIT for a connkey to close its nph-zms process on the server.
  // No-op unless we have a real key, are streaming, and know the portal URL.
  // Errors are ignored: the connection may already be closed.
  const sendCmdQuit = (key: number): void => {
    if (key === 0 || viewMode !== 'streaming' || !portalUrl || !monitorId) return;
    const controlUrl = getZmsControlUrl(
      portalUrl,
      ZMS_COMMANDS.cmdQuit,
      key.toString(),
      { token: accessToken || undefined, minStreamingPort, monitorId },
    );
    httpGet(controlUrl, { timeoutMs: cmdQuitTimeoutMs }).catch(() => {
      // Silently ignore - server connection may already be closed
    });
  };

  // Force-regenerate. Optionally sends CMD_QUIT for the previous connkey first
  // when `killPrevious` is true: used by the visibility-resume, manual-retry,
  // and error-reconnect paths where the old stream may still be alive on the
  // server. Without it, each regeneration would orphan a connkey on ZM and the
  // nph-zms process would only exit after its own idle timeout, leaking sockets
  // in CLOSE_WAIT. Dedupes the log line across all monitors in the same 3s
  // window so a visibility-resume burst surfaces as one line. refs #150
  const forceRegenerate = ({ killPrevious = false }: { killPrevious?: boolean } = {}): number => {
    if (!monitorId) return 0;

    if (killPrevious) {
      sendCmdQuit(prevConnKeyRef.current);
    }

    const newKey = regenerateConnKey(monitorId);
    setConnKey(newKey);
    prevConnKeyRef.current = newKey;
    log.dedupe('connkey-force-regen', 3000, (suffix) =>
      logFn(`Force-regenerated connkey${suffix}`, LogLevel.INFO, { monitorId, newKey, killPrevious }),
    );
    return newKey;
  };

  // Release the current connkey without minting a new one. Used when the
  // reconnect loop gives up so the last errored connkey is closed on the
  // server now, not left until unmount. Clearing the stored key keeps a quit
  // key from being reused on the next mount (it can collide with server state).
  const releaseConnection = (): void => {
    const key = prevConnKeyRef.current;
    if (key === 0 || viewMode !== 'streaming') return;
    sendCmdQuit(key);
    log.dedupe('connkey-release', 3000, (suffix) =>
      logFn(`Releasing connkey after giving up${suffix}`, LogLevel.INFO, { monitorId, connkey: key }),
    );
    if (monitorId) {
      const store = useMonitorStore.getState();
      if (store.connKeys[monitorId] === key) {
        store.clearConnKey(monitorId);
      }
    }
    prevConnKeyRef.current = 0;
  };

  return { connKey, forceRegenerate, releaseConnection };
}
