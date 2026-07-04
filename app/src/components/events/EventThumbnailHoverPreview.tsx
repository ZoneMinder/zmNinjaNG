/**
 * Event Thumbnail Hover Preview
 *
 * Wrapper that plays the event via ZMS on hover. A fresh connkey is
 * generated when the preview opens; on close, CMD_QUIT is sent to tear
 * down the stream.
 */

import { useEffect, useMemo, type ReactNode } from 'react';
import { HoverPreview } from '../ui/hover-preview';
import { resolveMinStreamingPort } from '../../lib/monitor/multiport';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import { useFreshAccessToken } from '../../hooks/useFreshAccessToken';
import { getEventZmsUrl, getZmsControlUrl } from '../../lib/zm/url-builder';
import { log, LogLevel } from '../../lib/logger';
import { ZMS_COMMANDS } from '../../lib/zm/zm-constants';
import { sendDelayedCmdQuit, cancelPendingQuit } from '../../lib/zm/zms-quit';
import { DEFAULT_HOVER_PREVIEW_PLAYBACK_RATE } from '../../stores/settings';
import type { Event } from '../../api/types';

export interface EventZmsHoverDescriptor {
  eventId: string;
  monitorId: string;
  name?: string;
}

interface EventThumbnailHoverPreviewProps {
  event: Event;
  aspectRatio: number;
  /** Legacy props (kept for API compatibility, unused in ZMS playback path) */
  urls?: string[];
  cacheKey?: string;
  alt?: string;
  children: ReactNode;
}

export function EventThumbnailHoverPreview({
  event,
  aspectRatio,
  children,
}: EventThumbnailHoverPreviewProps) {
  return (
    <HoverPreview
      aspectRatio={aspectRatio}
      testId="event-thumbnail-hover-preview"
      renderPreview={() => (
        <EventZmsHoverPlayer
          descriptor={{ eventId: event.Id, monitorId: event.MonitorId, name: event.Name }}
        />
      )}
    >
      {children}
    </HoverPreview>
  );
}

/**
 * Inner player, only mounted while the preview is open.
 * Mount: new connkey + event ZMS stream. Unmount: CMD_QUIT.
 */
export function EventZmsHoverPlayer({ descriptor }: { descriptor: EventZmsHoverDescriptor }) {
  const { currentProfile, settings } = useCurrentProfile();
  const { token: accessToken, isFresh: isAccessTokenFresh } = useFreshAccessToken();

  const connkey = useMemo(
    () => Math.floor(Math.random() * 1_000_000_000).toString(),
    [],
  );

  const portalUrl = currentProfile?.portalUrl ?? '';
  const tokenOpts = {
    token: accessToken ?? undefined,
    apiUrl: currentProfile?.apiUrl,
    minStreamingPort: resolveMinStreamingPort(currentProfile?.minStreamingPort, settings.forceDisableMultiPort),
    monitorId: descriptor.monitorId,
  };

  const rate = settings.hoverPreviewPlaybackRate ?? DEFAULT_HOVER_PREVIEW_PLAYBACK_RATE;

  const streamUrl = portalUrl && isAccessTokenFresh
    ? getEventZmsUrl(portalUrl, descriptor.eventId, {
        ...tokenOpts,
        connkey,
        rate,
        maxfps: 30,
        replay: 'single',
      })
    : '';

  // Log when hover playback starts. Tear down the zms process on unmount,
  // but delay it so StrictMode's dev-mode remount can cancel the CMD_QUIT
  // and keep reusing the same connkey. A re-hover mounts a fresh instance
  // with a new connkey, so the old stream's quit still fires.
  useEffect(() => {
    // If a quit was pending for this connkey (dev remount), cancel it.
    // Otherwise, log the new start.
    const hadPendingQuit = cancelPendingQuit(connkey);
    if (!hadPendingQuit && streamUrl) {
      log.zmsEventPlayer('Hover preview stream started', LogLevel.INFO, {
        eventId: descriptor.eventId,
        monitorId: descriptor.monitorId,
        connkey,
        url: streamUrl,
      });
    }

    return () => {
      if (!portalUrl) return;
      const controlUrl = getZmsControlUrl(portalUrl, ZMS_COMMANDS.cmdQuit, connkey, tokenOpts);
      sendDelayedCmdQuit(controlUrl, connkey, {
        timeoutMs: settings.apiTimeoutSeconds > 0 ? settings.apiTimeoutSeconds * 1000 : undefined,
        logContext: { eventId: descriptor.eventId, monitorId: descriptor.monitorId },
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!streamUrl) {
    return <div className="w-full h-full bg-black" />;
  }

  return (
    <img
      src={streamUrl}
      alt={descriptor.name ?? ''}
      className="w-full h-full object-contain bg-black"
    />
  );
}
