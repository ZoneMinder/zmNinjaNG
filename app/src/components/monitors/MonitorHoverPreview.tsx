/**
 * Monitor Hover Preview
 *
 * Desktop-only wrapper that shows an enlarged live MJPEG stream of a
 * monitor on hover. Each open generates a fresh connkey via
 * `useStreamLifecycle`; closing the preview unmounts the inner component
 * which sends CMD_QUIT to tear down the extra stream on the ZM server.
 */

import { useRef, useState, type ReactNode } from 'react';
import { getStreamUrl } from '../../api/monitors';
import { resolveMinStreamingPort } from '../../lib/monitor/multiport';
import { useProfileById } from '../../hooks/useCurrentProfile';
import { useStreamLifecycle } from '../../hooks/useStreamLifecycle';
import { useFreshAccessToken } from '../../hooks/useFreshAccessToken';
import { parseMonitorRotation } from '../../lib/monitor/monitor-rotation';
import { log } from '../../lib/logger';
import type { Monitor, ProfileId } from '../../api/types';
import { HoverPreview } from '../ui/hover-preview';
import { VideoOff } from 'lucide-react';

interface MonitorHoverPreviewProps {
  monitor: Monitor;
  children: ReactNode;
  /**
   * Id of the profile that owns this monitor. Defaults to the current
   * profile when omitted (single mode). Mirrors LiveMonitorPlayer's
   * profileId prop (refs #337) so an All-mode hover preview streams from the
   * owning profile's server instead of the globally-selected one.
   */
  profileId?: ProfileId | null;
}

function computeNumericAspectRatio(monitor: Monitor): number {
  const w = Number(monitor.Width);
  const h = Number(monitor.Height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return 16 / 9;
  }
  const rotation = parseMonitorRotation(monitor.Orientation);
  if (rotation.kind === 'degrees') {
    const normalized = ((rotation.degrees % 360) + 360) % 360;
    if (normalized === 90 || normalized === 270) return h / w;
  }
  return w / h;
}

export function MonitorHoverPreview({ monitor, children, profileId }: MonitorHoverPreviewProps) {
  const aspectRatio = computeNumericAspectRatio(monitor);

  return (
    <HoverPreview
      aspectRatio={aspectRatio}
      testId="monitor-hover-preview"
      renderPreview={() => <MonitorLivePreview monitor={monitor} profileId={profileId} />}
    >
      {children}
    </HoverPreview>
  );
}

/**
 * Live stream body: only mounted while the preview is open.
 * Mount → new connkey. Unmount → CMD_QUIT via useStreamLifecycle.
 */
function MonitorLivePreview({ monitor, profileId }: { monitor: Monitor; profileId?: ProfileId | null }) {
  const { profile: currentProfile, settings } = useProfileById(profileId);
  const { token: accessToken, isFresh: isAccessTokenFresh } = useFreshAccessToken(profileId);
  const imgRef = useRef<HTMLImageElement>(null);
  // Same rule as the player: nothing paints until this src has produced a
  // frame, so a stream that fails or never arrives shows the no-video
  // placeholder rather than the browser's broken-image glyph. refs #352
  const [hasFrame, setHasFrame] = useState(false);
  const effectiveMinStreamingPort = resolveMinStreamingPort(
    currentProfile?.minStreamingPort,
    settings.forceDisableMultiPort,
  );

  const { connKey } = useStreamLifecycle({
    monitorId: monitor.Id,
    monitorName: monitor.Name,
    portalUrl: currentProfile?.portalUrl,
    accessToken,
    viewMode: 'streaming',
    mediaRef: imgRef,
    logFn: log.monitor,
    enabled: true,
    minStreamingPort: effectiveMinStreamingPort,
    profileId: currentProfile?.id,
  });

  const noVideoPlaceholder = (
    <div
      className="absolute inset-0 flex items-center justify-center bg-muted/30"
      data-testid="monitor-hover-preview-novideo"
    >
      <VideoOff className="h-8 w-8 text-muted-foreground/40" />
    </div>
  );

  if (!currentProfile || connKey === 0 || !isAccessTokenFresh) {
    return <div className="relative w-full h-full">{noVideoPlaceholder}</div>;
  }

  const streamUrl = getStreamUrl(currentProfile.cgiUrl, monitor.Id, {
    mode: 'jpeg',
    token: accessToken || undefined,
    connkey: connKey,
    minStreamingPort: effectiveMinStreamingPort,
  });

  return (
    <div className="relative w-full h-full">
      {!hasFrame && noVideoPlaceholder}
      <img
        ref={imgRef}
        src={streamUrl}
        // Empty on purpose: alt text is what the browser draws beside its
        // broken-image glyph, and the card behind this popover names the monitor.
        alt=""
        data-testid="monitor-hover-preview-img"
        className="w-full h-full object-contain bg-black"
        style={{ visibility: hasFrame ? 'visible' : 'hidden' }}
        onLoad={() => setHasFrame(true)}
        onError={() => setHasFrame(false)}
      />
    </div>
  );
}
