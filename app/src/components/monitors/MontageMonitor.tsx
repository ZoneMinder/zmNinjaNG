/**
 * Montage Monitor Component
 *
 * Individual monitor tile for the montage grid view.
 * Features:
 * - Live streaming or snapshot mode (MJPEG or WebRTC)
 * - WebRTC monitors start muted to avoid cacophony
 * - Auto-reconnection on stream failure
 * - Header bar with action buttons (download, events, timeline, maximize)
 * - Drag handle for grid repositioning (in edit mode)
 * - Click to navigate to monitor detail view
 * - Fullscreen mode: header slides in on hover from top edge
 */

import { useState, useRef, memo, useEffect, type ReactNode } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import type { Monitor, MonitorStatus, Profile, ProfileId } from '../../api/types';
import { useAuthSlice } from '../../stores/auth';
import { getMonitorRunState, monitorDotColor } from '../../lib/monitor/monitor-status';
import { MONITOR_UI } from '../../lib/zmninja-ng-constants';
import { useSettingsStore } from '../../stores/settings';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { ProfileChip } from '../ui/profile-chip';
import { LiveMonitorPlayer } from './LiveMonitorPlayer';
import { MonitorHoverPreview } from './MonitorHoverPreview';
import { Clock, ChartGantt, Download, Volume2, VolumeX, Pin, MoreVertical } from 'lucide-react';
import { cn } from '../../lib/utils';
import { downloadSnapshotFromElement } from '../../services/download';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useNotificationStore } from '../../stores/notifications';
import type { NotificationEvent } from '../../stores/notifications';
import { formatEventCount } from '../../lib/utils';
import { useOpenMonitorEvents } from '../../hooks/useOpenMonitorEvents';

// Stable empty-array reference so the selector doesn't force a re-render
// every time it returns "no events" for this monitor.
const NO_MONITOR_EVENTS: NotificationEvent[] = [];

interface MontageMonitorProps {
  monitor: Monitor;
  status: MonitorStatus | undefined;
  /** The tile's owning profile: the current profile in single mode, the
   *  monitor's OWN server in All mode (see useScopedMonitors). Drives
   *  zmVersion, settings, go2rtcUrl and the LiveMonitorPlayer `profile`
   *  prop, all keyed off its id. */
  currentProfile: Profile | null;
  accessToken: string | null;
  navigate: NavigateFunction;
  /**
   * All mode only: the same owning profile's id, threaded separately to
   * LiveMonitorPlayer's cache-key scoping and to the events watermark so a
   * monitor id shared by two servers cannot collide (refs #337, Phase 4
   * Task 1). Undefined in single mode - degrades to the pre-existing
   * unscoped cache key (monitorCacheKey), unchanged.
   */
  profileId?: ProfileId;
  /** All mode only: the owning profile's display name, shown as a small
   *  chip next to the monitor name (mirrors MonitorCard's profileChip). */
  profileChip?: string;
  isFullscreen?: boolean;
  isEditing?: boolean;
  isPinned?: boolean;
  onPinToggle?: () => void;
  objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  showOverlay?: boolean;
  /** Events recorded since the user last looked at this monitor (refs #239). */
  newEventCount?: number;
  newestEventAt?: string | null;
  /** Replaces the monitor name in the tile header. */
  titleOverride?: string;
  /**
   * Rendered ahead of the title in the header. A separate slot rather than a
   * widened `titleOverride` because that string is also the truncation
   * tooltip and has to stay a string (refs #313).
   */
  titleIcon?: ReactNode;
  /**
   * CSS aspect ratio for the video area, as `"width / height"`.
   *
   * Left unset the tile is sized by whatever contains it and the video takes
   * the height left over below the header, which is what Montage needs: its
   * react-grid-layout items already carry a computed pixel height. A page that
   * lays tiles out in a plain grid has no such height, so it passes the
   * camera's own ratio and the card grows to the header plus the video. The
   * ratio lands on the video area rather than the card for that reason: on the
   * card the header would eat into the camera's shape and the picture would
   * crop (refs #313).
   */
  mediaAspectRatio?: string;
  /**
   * Route this tile is rendered from. Travels as navigation state to the
   * events list and the timeline so both can offer a back link that returns
   * here. Defaults to the montage route, which is where tiles came from
   * before any other page reused them (refs #313).
   */
  fromRoute?: string;
  /**
   * Opens this monitor. Montage puts the same navigation on its grid wrapper,
   * which gives one tab stop per tile; Live Activity has no such wrapper, so
   * the media area itself becomes the target. It holds only the player and
   * pointer-events-none labels, so nothing interactive ends up nested inside
   * a button - unlike the whole-tile version, which wraps the header's own
   * buttons.
   */
  onMediaActivate?: () => void;
  /**
   * Wraps the player in the enlarged hover preview, as the monitor cards do.
   * The caller decides, because the setting that gates it is per surface.
   */
  hoverPreview?: boolean;
  /**
   * Ask ZM for a cheaper stream for this tile (All-mode "reduced" stream
   * tuning, refs #337). Decided by the page - Montage sets it while
   * aggregating, Live Activity does not - and forwarded untouched to the
   * player, which is where it turns into stream parameters.
   */
  reduceStream?: boolean;
  /**
   * Stop this tile's stream (All-mode pause-while-hidden, refs #337). Decided
   * by the page and forwarded to the player, which drops the connection.
   */
  paused?: boolean;
  /**
   * Force this tile's MJPEG view mode regardless of the Streaming Mode
   * setting, forwarded to the player. Montage passes 'snapshot' once the
   * All-mode idle downgrade fires (refs #337).
   */
  forceViewMode?: 'streaming' | 'snapshot';
}

function MontageMonitorComponent({
  monitor,
  status,
  currentProfile,
  accessToken: _accessToken,
  navigate,
  profileId,
  profileChip,
  isFullscreen = false,
  isEditing = false,
  isPinned = false,
  onPinToggle,
  objectFit,
  showOverlay = false,
  newEventCount,
  newestEventAt,
  titleOverride,
  titleIcon,
  mediaAspectRatio,
  fromRoute = '/montage',
  onMediaActivate,
  hoverPreview = false,
  reduceStream = false,
  paused = false,
  forceViewMode,
}: MontageMonitorProps) {
  const { t } = useTranslation();
  const zmVersion = useAuthSlice(currentProfile?.id ?? null).version;
  const runState = getMonitorRunState(monitor, status, zmVersion);
  const settings = useSettingsStore(
    useShallow((state) => state.getProfileSettings(currentProfile?.id || ''))
  );
  const [protocol, setProtocol] = useState('MJPEG');
  const [isMuted, setIsMuted] = useState(true);
  const mediaRef = useRef<HTMLImageElement | HTMLVideoElement>(null);
  const resolvedFit = objectFit ?? 'cover';
  const isRTC = monitor.Go2RTCEnabled === true && !!currentProfile?.go2rtcUrl;
  const openMonitorEvents = useOpenMonitorEvents();

  // Alarm pulse: select only this monitor's events out of the notifications
  // store, so mutations to other monitors/profiles/settings in that store
  // don't re-render this tile. useShallow keeps the filtered array reference
  // stable across renders when the underlying events for this monitor haven't
  // actually changed.
  const [isAlarming, setIsAlarming] = useState(false);
  const alarmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeenRef = useRef(0);
  const seedKeyRef = useRef<string | null>(null);

  const ownerProfileId = currentProfile?.id;
  const monitorId = monitor.Id;

  const monitorEvents = useNotificationStore(
    useShallow((state) => {
      const events = ownerProfileId ? state.profileEvents[ownerProfileId] : undefined;
      if (!events?.length) return NO_MONITOR_EVENTS;
      return events.filter((e) => String(e.MonitorId) === monitorId);
    })
  );

  useEffect(() => {
    const seedKey = `${ownerProfileId ?? ''}:${monitorId}`;
    const isNewKey = seedKeyRef.current !== seedKey;
    seedKeyRef.current = seedKey;

    const latest = monitorEvents[0];
    if (!latest) return;

    if (isNewKey) {
      // Seed lastSeen without triggering the alarm pulse for pre-existing events
      lastSeenRef.current = latest.receivedAt;
      return;
    }

    if (latest.receivedAt === lastSeenRef.current) return;
    lastSeenRef.current = latest.receivedAt;

    if (Date.now() - latest.receivedAt < MONITOR_UI.alarmPulseMs) {
      if (alarmTimerRef.current) clearTimeout(alarmTimerRef.current);
      setIsAlarming(true);
      alarmTimerRef.current = setTimeout(() => setIsAlarming(false), MONITOR_UI.alarmPulseMs);
    }
  }, [monitorEvents, ownerProfileId, monitorId]);

  useEffect(() => {
    return () => {
      if (alarmTimerRef.current) clearTimeout(alarmTimerRef.current);
    };
  }, []);

  // Handle snapshot download
  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (mediaRef.current) {
      downloadSnapshotFromElement(mediaRef.current, monitor.Name)
        .then(() => toast.success(t('montage.snapshot_saved', { name: monitor.Name })))
        .catch(() => toast.error(t('montage.snapshot_failed')));
    }
  };

  return (
    <Card
      className={cn(
        "h-full overflow-hidden flex flex-col rounded-none relative",
        isFullscreen
          ? "border-none shadow-none bg-black m-0 p-0"
          : "border-0 shadow-none bg-card",
      )}
    >
      {/* Edit mode border: rendered as overlay to avoid compact CSS !important overrides */}
      {isEditing && !isFullscreen && (
        <div
          className="absolute inset-0 z-10 pointer-events-none"
          style={{
            border: isPinned ? '2px solid rgba(96, 165, 250, 0.7)' : '2px solid rgba(250, 204, 21, 0.7)',
          }}
        />
      )}
      {/* Header / Drag Handle - Toggled via toolbar button in fullscreen mode */}
      <div
        className={cn(
          "flex items-center gap-1 px-2 h-8 shrink-0 select-none z-10",
          isFullscreen
            ? cn(
                "absolute top-0 left-0 right-0 bg-black/80 text-white transition-all duration-200",
                showOverlay ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"
              )
            : "bg-card border-b",
          isEditing && !isFullscreen ? "hover:bg-accent/50" : "cursor-default",
          isAlarming && "montage-alarm-pulse"
        )}
      >
        {/* Monitor status and name */}
        <div className="flex items-center gap-2 overflow-hidden flex-1 min-w-0">
          <Badge
            variant="default"
            className={cn(
              "h-1.5 w-1.5 p-0 rounded-full shrink-0",
              monitorDotColor(runState)
            )}
          />
          {titleIcon}
          <span className={cn(
            "text-xs font-medium truncate",
            isFullscreen && "text-white"
          )} title={titleOverride ?? monitor.Name}>
            {titleOverride ?? monitor.Name}
          </span>
          {profileChip && (
            <ProfileChip name={profileChip} testId="montage-profile-chip" />
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-6 w-6 relative",
              isFullscreen ? "text-white hover:bg-white/20" : "text-muted-foreground hover:text-foreground"
            )}
            onClick={(e) => {
              e.stopPropagation();
              openMonitorEvents({ monitorId: monitor.Id, newEventCount, newestEventAt, from: fromRoute, profileId });
            }}
            title={t('common.events')}
            aria-label={t('monitors.view_events')}
            data-testid="montage-events-btn"
          >
            <Clock className="h-3 w-3" />
            {newEventCount !== undefined && newEventCount > 0 && (
              <Badge
                variant="info"
                className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] rounded-full px-0.5 text-[8px] font-medium leading-none"
                data-testid="montage-new-events-badge"
                aria-label={t('monitors.new_events_count', { count: newEventCount })}
              >
                {formatEventCount(newEventCount)}
              </Badge>
            )}
          </Button>
          {isRTC && (
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-6 w-6",
                isFullscreen ? "text-white hover:bg-white/20" : "text-muted-foreground hover:text-foreground"
              )}
              onClick={(e) => {
                e.stopPropagation();
                setIsMuted((m) => !m);
              }}
              title={isMuted ? t('monitor_detail.unmute') : t('monitor_detail.mute')}
              aria-label={isMuted ? t('monitor_detail.unmute') : t('monitor_detail.mute')}
              data-testid="montage-volume-btn"
            >
              {isMuted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
            </Button>
          )}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-6 w-6",
                  isFullscreen ? "text-white hover:bg-white/20" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={(e) => e.stopPropagation()}
                title={t('montage.menu_more')}
                aria-label={t('montage.menu_more')}
                data-testid="montage-more-btn"
              >
                <MoreVertical className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" className="min-w-[140px]">
              <DropdownMenuItem
                onClick={(e) => { e.stopPropagation(); handleDownload(e as unknown as React.MouseEvent); }}
                data-testid="montage-download-btn"
              >
                <Download className="h-3.5 w-3.5 mr-2" />
                {t('montage.save_snapshot')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/timeline?monitorId=${monitor.Id}`, { state: { from: fromRoute } });
                }}
                data-testid="montage-timeline-btn"
              >
                <ChartGantt className="h-3.5 w-3.5 mr-2" />
                {t('sidebar.timeline')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Video Content. In Montage the click and keyboard navigation live on
          the tile wrapper (one tab stop per tile, not two) and this div only
          needs the pointer cursor hint; where there is no such wrapper, the
          caller passes onMediaActivate and this becomes the target. refs #217 */}
      <div
        className={cn(
          "relative overflow-hidden",
          // With a ratio the video area sizes itself and the card's height is
          // the header plus it; `flex-1` would set a zero flex basis and
          // collapse the ratio box in a container that has no height of its
          // own. Without one nothing changes for Montage.
          mediaAspectRatio ? "w-full shrink-0" : "flex-1",
          isFullscreen ? "bg-black" : "bg-black/90",
          !isFullscreen && "cursor-pointer",
          // Hover and focus both say "this opens", since a wall of tiles gives
          // no other clue that one is a link.
          onMediaActivate &&
            "ring-inset hover:ring-2 hover:ring-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        )}
        style={mediaAspectRatio ? { aspectRatio: mediaAspectRatio } : undefined}
        role={onMediaActivate ? 'button' : undefined}
        tabIndex={onMediaActivate ? 0 : undefined}
        aria-label={onMediaActivate ? monitor.Name : undefined}
        onClick={onMediaActivate}
        onKeyDown={
          onMediaActivate
            ? (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                onMediaActivate();
              }
            : undefined
        }
        data-testid="montage-monitor-media"
      >
        {(() => {
          const player = (
            <LiveMonitorPlayer
              monitor={monitor}
              profile={currentProfile}
              profileId={profileId}
              externalMediaRef={mediaRef}
              objectFit={resolvedFit}
              muted={isMuted}
              className="w-full h-full"
              onProtocolChange={setProtocol}
              reduceStream={reduceStream}
              paused={paused}
              forceViewMode={forceViewMode}
            />
          );
          // Same wrapper the monitor cards use, so the preview behaves the
          // same everywhere: desktop only, its own connkey, torn down on close.
          return hoverPreview ? (
            <MonitorHoverPreview monitor={monitor} profileId={profileId}>
              {player}
            </MonitorHoverPreview>
          ) : (
            player
          );
        })()}
        {settings.montageShowToolbar && settings.showProtocolLabel && (
          <span className="absolute bottom-1.5 right-1.5 z-30 text-[10px] px-1.5 py-0.5 rounded bg-black/50 text-white/90 font-medium pointer-events-none">
            {protocol}
          </span>
        )}
      </div>

      {/* Pin button: bottom-left corner, outside drag handle, edit mode only */}
      {isEditing && !isFullscreen && onPinToggle && (
        <button
          type="button"
          className={cn(
            "absolute bottom-1 left-1 z-30 rounded-full p-1.5 touch-manipulation transition-all no-drag",
            isPinned
              ? "bg-blue-500 text-white shadow-md"
              : "bg-black/50 text-white/70 hover:bg-black/70 hover:text-white"
          )}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); onPinToggle(); }}
          title={isPinned ? t('montage.unpin_monitor') : t('montage.pin_monitor')}
          data-testid={`montage-pin-${monitor.Id}`}
        >
          <Pin className={cn("h-4 w-4", isPinned && "fill-current")} />
        </button>
      )}
    </Card>
  );
}

// Wrap in React.memo to prevent unnecessary re-renders
// This is important because grid layout changes can trigger parent re-renders
// and we don't want to tear down and re-establish video streams unnecessarily
export const MontageMonitor = memo(MontageMonitorComponent);
