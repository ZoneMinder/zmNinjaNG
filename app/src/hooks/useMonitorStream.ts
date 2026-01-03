/**
 * Monitor Stream Hook
 * 
 * Manages the lifecycle of a ZoneMinder video stream or snapshot sequence.
 * Handles connection keys (connkey) to allow multiple simultaneous streams.
 * Implements cache busting and periodic refreshing for snapshot mode.
 * 
 * Features:
 * - Supports both 'streaming' (MJPEG) and 'snapshot' (JPEG refresh) modes
 * - Handles connection cleanup on unmount to prevent zombie streams on server
 * - Implements image preloading for smooth snapshot transitions
 * - Generates unique connection keys per stream instance
 */

import { useState, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getStreamUrl } from '../api/monitors';
import { useMonitorStore } from '../stores/monitors';
import { useProfileStore } from '../stores/profile';
import { useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { log } from '../lib/logger';
import type { StreamOptions } from '../api/types';

interface UseMonitorStreamOptions {
  monitorId: string;
  streamOptions?: Partial<StreamOptions>;
}

interface UseMonitorStreamReturn {
  streamUrl: string;
  displayedImageUrl: string;
  imgRef: React.RefObject<HTMLImageElement | null>;
  regenerateConnection: () => void;
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
  streamOptions = {},
}: UseMonitorStreamOptions): UseMonitorStreamReturn {
  const currentProfile = useProfileStore((state) => state.currentProfile());
  const accessToken = useAuthStore((state) => state.accessToken);
  const settings = useSettingsStore(
    useShallow((state) => state.getProfileSettings(currentProfile?.id || ''))
  );
  const regenerateConnKey = useMonitorStore((state) => state.regenerateConnKey);

  const [connKey, setConnKey] = useState(0);
  const [cacheBuster, setCacheBuster] = useState(Date.now());
  const [displayedImageUrl, setDisplayedImageUrl] = useState<string>('');
  const imgRef = useRef<HTMLImageElement>(null);

  // Regenerate connKey on mount and when monitor changes
  useEffect(() => {
    log.monitor(`Regenerating connkey for monitor ${monitorId}`);
    const newKey = regenerateConnKey(monitorId);
    setConnKey(newKey);
    setCacheBuster(Date.now());
  }, [monitorId, regenerateConnKey]);

  // Snapshot mode: periodic refresh
  useEffect(() => {
    if (settings.viewMode !== 'snapshot') return;

    const interval = setInterval(() => {
      setCacheBuster(Date.now());
    }, settings.snapshotRefreshInterval * 1000);

    return () => clearInterval(interval);
  }, [settings.viewMode, settings.snapshotRefreshInterval]);

  // Cleanup: abort image loading on unmount to release connection
  useEffect(() => {
    const currentImg = imgRef.current;
    return () => {
      if (currentImg) {
        log.monitor(`Cleaning up stream for monitor ${monitorId}`);
        // Set to empty data URI to abort the connection
        currentImg.src =
          'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      }
    };
  }, [monitorId]);

  // Build stream URL
  const streamUrl = currentProfile
    ? getStreamUrl(currentProfile.cgiUrl, monitorId, {
      mode: settings.viewMode === 'snapshot' ? 'single' : 'jpeg',
      scale: settings.streamScale,
      maxfps:
        settings.viewMode === 'streaming'
          ? settings.streamMaxFps
          : undefined,
      token: accessToken || undefined,
      connkey: connKey,
      cacheBuster: cacheBuster,
      // Only use multi-port in streaming mode, not snapshot
      minStreamingPort:
        settings.viewMode === 'streaming'
          ? currentProfile.minStreamingPort
          : undefined,
      ...streamOptions,
    })
    : '';

  // Preload images in snapshot mode to avoid flickering
  useEffect(() => {
    // In streaming mode or if no URL, just use the streamUrl directly
    if (settings.viewMode !== 'snapshot') {
      setDisplayedImageUrl(streamUrl);
      return;
    }

    // In snapshot mode, preload the image to avoid flickering
    if (!streamUrl) {
      setDisplayedImageUrl('');
      return;
    }

    // Note: We previously attempted to use native HTTP fetch for snapshots on native platforms
    // to bypass CORS, but it caused NSURLErrorDomain errors on iOS.
    // We now rely on standard Image preloading which works fine.

    const img = new Image();
    img.onload = () => {
      // Only update the displayed URL when the new image is fully loaded
      setDisplayedImageUrl(streamUrl);
    };
    img.onerror = () => {
      // On error, still update to trigger the error handler
      setDisplayedImageUrl(streamUrl);
    };
    img.src = streamUrl;
  }, [streamUrl, settings.viewMode]);

  const regenerateConnection = () => {
    log.monitor(`Manually regenerating connection for monitor ${monitorId}`);
    const newKey = regenerateConnKey(monitorId);
    setConnKey(newKey);
    setCacheBuster(Date.now());
  };

  return {
    streamUrl,
    displayedImageUrl,
    imgRef,
    regenerateConnection,
  };
}
