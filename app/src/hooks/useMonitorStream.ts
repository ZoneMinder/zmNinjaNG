/**
 * Monitor Stream Hook
 *
 * Manages the lifecycle of a ZoneMinder video stream or snapshot sequence.
 * Handles connection keys (connkey) so multiple simultaneous streams can run.
 * Implements cache busting and periodic refreshing for snapshot mode.
 *
 * Features:
 * - Supports 'streaming' (MJPEG) and 'snapshot' (periodic JPEG) modes
 * - Sends CMD_QUIT to ZM on unmount to prevent zombie nph-zms processes
 * - Reconnects MJPEG with exponential backoff on stream error
 * - Refetches and rebinds on visibility return (page resumed from background)
 */

import { useState, useEffect, useRef } from 'react';
import { getStreamUrl } from '../api/monitors';
import { resolveMinStreamingPort } from '../lib/monitor/multiport';
import { useProfileById } from './useCurrentProfile';
import { useBandwidthSettings } from './useBandwidthSettings';
import { useStreamLifecycle } from './useStreamLifecycle';
import { useAnalysisFrames } from './useAnalysisFrames';
import { useFreshAccessToken } from './useFreshAccessToken';
import { useServerUrls } from './useServerUrls';
import { useVisibilityResume } from './useVisibilityResume';
import { useAuthStore } from '../stores/auth';
import { log, LogLevel } from '../lib/logger';
import { ZM_INTEGRATION } from '../lib/zmninja-ng-constants';
import type { StreamOptions, ProfileId } from '../api/types';

interface UseMonitorStreamOptions {
  monitorId: string;
  serverId?: string | null;
  streamOptions?: Partial<StreamOptions>;
  enabled?: boolean; // Enable/disable stream management (default: true)
  /**
   * Override the global Streaming Mode setting for this stream.
   * When set, forces 'streaming' or 'snapshot' regardless of profile settings.
   * Used by the single-monitor page, which always wants continuous streaming.
   */
  viewModeOverride?: 'streaming' | 'snapshot';
  /**
   * Profile that owns this monitor. Defaults to the current profile. An
   * All-mode tile owned by a non-current profile passes that profile's id so
   * the stream URL, minStreamingPort and token all resolve against it
   * instead of the globally-selected profile.
   */
  profileId?: ProfileId | null;
}

interface UseMonitorStreamReturn {
  streamUrl: string;
  /**
   * The value to bind to the `<img src>`. Equal to streamUrl once a connkey
   * has been minted; empty string before that.
   */
  imageSrc: string;
  imgRef: React.RefObject<HTMLImageElement | null>;
  /** Manual retry: reset the backoff counter and mint a fresh connkey. */
  regenerateConnection: () => void;
  /**
   * Call from the `<img onError>` handler. Schedules a backoff reconnect that
   * releases the errored connkey (CMD_QUIT) before minting a new one. Caps at
   * mjpegReconnectMaxAttempts unless insomnia is on; releases the connkey when
   * it gives up.
   */
  reportStreamError: () => void;
  /**
   * Call from the `<img onLoad>` handler. Resets the backoff counter so a later
   * independent drop starts fresh. A stream that never loads never resets, so
   * the give-up cap still applies to a permanently dead feed.
   */
  reportStreamLoad: () => void;
}

/**
 * Custom hook for managing monitor stream URLs and connections.
 *
 * @param options - Configuration options
 * @param options.monitorId - The ID of the monitor to stream
 * @param options.streamOptions - Optional overrides for stream parameters
 */
export function useMonitorStream({
  monitorId,
  serverId,
  streamOptions = {},
  enabled = true,
  viewModeOverride,
  profileId,
}: UseMonitorStreamOptions): UseMonitorStreamReturn {
  const { profile: currentProfile, settings } = useProfileById(profileId);
  const bandwidth = useBandwidthSettings();
  const { token: accessToken, isFresh: isAccessTokenFresh } = useFreshAccessToken(profileId);
  const { recordingUrl, portalPath } = useServerUrls(serverId, profileId);
  // portalUrl for stream lifecycle = portalPath without /index.php
  const resolvedPortalUrl = portalPath ? portalPath.replace(/\/index\.php$/, '') : currentProfile?.portalUrl;

  const effectiveViewMode = viewModeOverride ?? settings.viewMode;
  // Multi-port only applies in streaming mode, and only when not force-disabled.
  const effectiveMinStreamingPort =
    effectiveViewMode === 'streaming'
      ? resolveMinStreamingPort(currentProfile?.minStreamingPort, settings.forceDisableMultiPort)
      : undefined;

  const [cacheBuster, setCacheBuster] = useState(() => Date.now());
  const imgRef = useRef<HTMLImageElement>(null);

  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror settings.insomnia into a ref so the scheduleReconnect closure
  // reads the latest value without re-running its effect.
  const insomniaRef = useRef(settings.insomnia);
  insomniaRef.current = settings.insomnia;
  const [imageSrc, setImageSrc] = useState<string>('');

  // Stream lifecycle: connKey generation, CMD_QUIT on regen/unmount, media abort
  const { connKey, forceRegenerate, releaseConnection } = useStreamLifecycle({
    monitorId,
    portalUrl: resolvedPortalUrl,
    accessToken,
    viewMode: effectiveViewMode,
    mediaRef: imgRef,
    logFn: log.monitor,
    enabled,
    minStreamingPort: effectiveMinStreamingPort,
    apiTimeoutSeconds: settings.apiTimeoutSeconds,
  });

  // Analysis frames: applied to the live connection by command, and re-applied
  // from the load handler below whenever a fresh connkey replaces it.
  const analysisFrames = useAnalysisFrames({
    monitorId,
    portalUrl: resolvedPortalUrl,
    accessToken,
    connKey,
    viewMode: effectiveViewMode,
    enabled,
    showAnalysis: settings.showAnalysisFrames,
    minStreamingPort: effectiveMinStreamingPort,
    apiTimeoutSeconds: settings.apiTimeoutSeconds,
  });

  // An armed backoff must not survive a disable. The disable teardown quits the
  // connkey and zeroes it, so a timer firing afterwards would forceRegenerate a
  // key while disabled: nothing can stream on it (streamUrl is gated on
  // enabled), and re-enabling would reuse that dead key instead of minting a
  // fresh one. Resetting the counter too means the next enable starts on a clean
  // backoff rather than partway up the old stream's ladder.
  useEffect(() => {
    if (enabled) return;
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, [enabled]);

  // Reset cacheBuster when connKey changes (new connection)
  useEffect(() => {
    if (connKey !== 0) {
      setCacheBuster(Date.now());
    }
  }, [connKey]);

  // Snapshot mode: periodic refresh
  useEffect(() => {
    if (!enabled || effectiveViewMode !== 'snapshot') return;

    const interval = setInterval(() => {
      setCacheBuster(Date.now());
    }, settings.snapshotRefreshInterval * 1000);

    return () => clearInterval(interval);
  }, [enabled, effectiveViewMode, settings.snapshotRefreshInterval]);

  // Build stream URL - ONLY when we have a valid connKey to prevent zombie
  // streams, and only while enabled: a disabled hook exposes no URL, so nothing
  // can mount an <img> on a connkey the disable teardown has already quit.
  const streamUrl = enabled && currentProfile && connKey !== 0 && isAccessTokenFresh
    ? getStreamUrl(recordingUrl || currentProfile.cgiUrl, monitorId, {
      mode: effectiveViewMode === 'snapshot' ? 'single' : 'jpeg',
      scale: bandwidth.imageScale,
      maxfps:
        effectiveViewMode === 'streaming'
          ? settings.streamMaxFps
          : undefined,
      token: accessToken || undefined,
      connkey: connKey,
      // Only use cacheBuster in snapshot mode to force refresh; streaming mode uses only connkey
      cacheBuster: effectiveViewMode === 'snapshot' ? cacheBuster : undefined,
      // Only use multi-port in streaming mode, not snapshot (and not force-disabled)
      minStreamingPort: effectiveMinStreamingPort,
      ...streamOptions,
    })
    : '';

  // The `<img>` points straight at streamUrl. We mirror it into imageSrc so the
  // consumer binds to a single field; reconnect logic below depends on the
  // <img>'s native onError handler which the consuming player wires up.
  useEffect(() => {
    setImageSrc(streamUrl);
  }, [streamUrl]);

  // MJPEG reconnect on stream error. Wired to the consumer's <img onError> via
  // reportStreamError below. Backoff doubles from mjpegReconnectBaseDelayMs up
  // to mjpegReconnectMaxDelayMs and caps at mjpegReconnectMaxAttempts unless
  // insomnia is on. The reconnect uses killPrevious so the errored connkey is
  // CMD_QUIT'd before a new one is minted (an <img> error can't tell a dead
  // server process from a dropped-but-alive one); on give-up the final connkey
  // is released too, instead of being orphaned until unmount.
  const scheduleReconnect = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const attempt = reconnectAttemptRef.current;
    const insomniaOn = insomniaRef.current;
    if (!insomniaOn && attempt >= ZM_INTEGRATION.mjpegReconnectMaxAttempts) {
      log.monitor(
        `MJPEG stream gave up after ${attempt} reconnect attempts for monitor ${monitorId}`,
        LogLevel.ERROR,
        { monitorId },
      );
      releaseConnection();
      return;
    }
    reconnectAttemptRef.current = attempt + 1;
    const delay = Math.min(
      ZM_INTEGRATION.mjpegReconnectBaseDelayMs * 2 ** attempt,
      ZM_INTEGRATION.mjpegReconnectMaxDelayMs,
    );
    reconnectTimerRef.current = setTimeout(() => {
      forceRegenerate({ killPrevious: true });
    }, delay);
  };

  // Reset the backoff counter (and cancel any pending reconnect) once a frame
  // loads, so a later independent drop starts a fresh backoff. A frame is also
  // the first proof that this connection's zms command socket exists, which is
  // when a remembered analysis setting can be applied to it.
  const reportStreamLoad = () => {
    analysisFrames.applyOnStreamLoad();
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const regenerateConnection = () => {
    log.monitor(`Manually regenerating connection for monitor ${monitorId}`, LogLevel.WARN);
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    // killPrevious: the user clicked Retry but the old stream may still be
    // running on ZM (they might click Retry preemptively, not after an error).
    // Close it so we don't orphan a connkey.
    forceRegenerate({ killPrevious: true });
    setCacheBuster(Date.now());
  };

  // Cleanup pending reconnect on unmount
  useEffect(() => () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  // When the page returns from background, MJPEG streams may have stalled
  // while the browser was throttling timers. The token may also have lapsed
  // mid-suspension. Reset the retry counter, refresh the token defensively,
  // then mint a fresh connkey so the stream reconnects. Snapshot mode
  // self-heals on its next interval tick, so the resume is streaming-only.
  // refs #150
  useVisibilityResume(() => {
    if (!enabled || effectiveViewMode !== 'streaming') return;
    log.dedupe('stream-visibility-resume', 3000, (suffix) =>
      log.monitor(`Resuming streams after visibility return${suffix}`, LogLevel.INFO, {
        monitorId,
        reconnectAttempts: reconnectAttemptRef.current,
      }),
    );
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const refresh = currentProfile
      ? useAuthStore.getState().getFreshAccessToken(currentProfile.id)
      : Promise.resolve(null);
    void refresh.finally(() => {
      // killPrevious closes the old nph-zms process on ZM. The server side
      // may still be alive (just throttled with us during the suspend), so
      // without this each resume would orphan a connkey.
      forceRegenerate({ killPrevious: true });
    });
  }, { enabled: enabled && effectiveViewMode === 'streaming' });

  return {
    streamUrl,
    imageSrc,
    imgRef,
    regenerateConnection,
    reportStreamError: scheduleReconnect,
    reportStreamLoad,
  };
}
