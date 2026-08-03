/**
 * Event Montage View
 *
 * Grid view of events with thumbnails and metadata.
 * Features:
 * - Responsive grid layout
 * - Haptic feedback on downloads (native platforms)
 * - Touch-optimized download buttons
 */

import { memo, useMemo, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Download, Loader2 } from 'lucide-react';
import { getEventCauseIcon } from '../../lib/event/event-icons';
import { getObjectClassIconFromList } from '../../lib/event/object-class-icons';
import { useDateTimeFormat } from '../../hooks/useDateTimeFormat';
import { formatEventRelative, isWithinDays } from '../../lib/relative-time';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { EventThumbnail } from './EventThumbnail';
import { downloadEventVideo } from '../../services/download';
import { type EventFilters } from '../../api/events';
import { getPortalUrlForMonitor, getServerMapVersion, subscribeServerMap } from '../../lib/zm/server-resolver';
import { buildThumbnailChain, eventHasAlarmFrame } from '../../lib/event/thumbnail-chain';
import { useCurrentProfile, useProfileById } from '../../hooks/useCurrentProfile';
import { useFreshAccessToken } from '../../hooks/useFreshAccessToken';
import { resolveMinStreamingPort } from '../../lib/monitor/multiport';
import { EventThumbnailHoverPreview } from './EventThumbnailHoverPreview';
import { calculateThumbnailDimensions, getMonitorDimensions } from '../../lib/event/event-utils';
import { ZM_INTEGRATION, RELATIVE_TIME_LIST_WINDOW_DAYS } from '../../lib/zmninja-ng-constants';
import type { Event, Monitor, ProfileId, Tag } from '../../api/types';
import type { ThumbnailFallbackEntry } from '../../stores/settings';
import { Platform } from '../../lib/platform';
import { TagChipList } from './TagChip';
import { ReturnFlashArrow } from './ReturnFlashArrow';
import { useReturnFlash } from '../../hooks/useReturnFlash';
import { useReturnHighlightStore } from '../../stores/returnHighlight';
import { cn } from '../../lib/utils';
import type { ScopedEventItem } from './EventListView';

// Haptic feedback helper
const triggerHaptic = async () => {
  if (Platform.isNative) {
    try {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      // Haptics not available, silently ignore
    }
  }
};

interface EventMontageTileProps {
  event: Event;
  /** All mode only: this event's owning profile - resolves this tile's own
   *  portal URL/token instead of the page-level defaults, exactly like
   *  EventListView's EventItem (refs #337 Task 2). */
  profileId?: ProfileId;
  profileChip?: string;
  monitorMap: Map<string, Monitor>;
  thumbnailFit: 'contain' | 'cover' | 'none' | 'scale-down';
  thumbnailChain: ThumbnailFallbackEntry[];
  showHover: boolean;
  portalUrl: string;
  accessToken?: string;
  tags?: Tag[];
  eventFilters?: EventFilters;
  minStreamingPort?: number;
}

/**
 * One grid tile. Extracted from the parent's `.map()` so it can call
 * `useReturnFlash` per event: hooks cannot run inside a map callback.
 */
const EventMontageTile = memo(function EventMontageTile({
  event,
  profileId,
  profileChip,
  monitorMap,
  thumbnailFit,
  thumbnailChain,
  showHover,
  portalUrl,
  accessToken,
  tags,
  eventFilters,
  minStreamingPort,
}: EventMontageTileProps) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { fmtDateTimeShort } = useDateTimeFormat();
  const markViewed = useReturnHighlightStore((s) => s.markViewed);
  const flash = useReturnFlash(event.Id);

  // All mode: resolve this tile's OWN owning-profile client details instead
  // of the page-level defaults (which reflect no/whatever profile is
  // current - there isn't one in All mode). Single mode: profileId is
  // undefined, both hooks fall back to the current profile, matching prior
  // behavior exactly (same pattern as EventListView's EventItem, refs #337).
  const { profile: ownerProfile, settings: ownerSettings } = useProfileById(profileId);
  const { token: ownerToken, isFresh: ownerTokenFresh } = useFreshAccessToken(profileId);
  const effectivePortalUrl = profileId ? (ownerProfile?.portalUrl || portalUrl) : portalUrl;
  const effectiveAccessToken = profileId ? (ownerTokenFresh ? ownerToken ?? undefined : undefined) : accessToken;
  const effectiveMinStreamingPort = profileId
    ? resolveMinStreamingPort(ownerProfile?.minStreamingPort, ownerSettings.forceDisableMultiPort)
    : minStreamingPort;

  const monitorData = monitorMap.get(profileId ? `${profileId}:${event.MonitorId}` : event.MonitorId);
  const monitorName = monitorData?.Name || `Camera ${event.MonitorId}`;
  const startTime = new Date(event.StartDateTime.replace(' ', 'T'));

  const { width: monitorWidth, height: monitorHeight } = getMonitorDimensions(monitorData, event.Width, event.Height);

  const { width: thumbnailWidth, height: thumbnailHeight } = calculateThumbnailDimensions(
    monitorWidth,
    monitorHeight,
    monitorData?.Orientation ?? event.Orientation,
    ZM_INTEGRATION.eventMontageImageWidth
  );

  const eventPortalUrl = getPortalUrlForMonitor(monitorData?.ServerId, effectivePortalUrl, profileId);
  const thumbnailUrls = buildThumbnailChain(eventPortalUrl, event.Id, thumbnailChain, {
    token: effectiveAccessToken,
    width: thumbnailWidth,
    height: thumbnailHeight,
    minStreamingPort: effectiveMinStreamingPort,
    monitorId: event.MonitorId,
    hasAlarmFrame: eventHasAlarmFrame(event),
  });

  const hasVideo = event.Videoed === '1';
  const aspectRatio = thumbnailWidth / thumbnailHeight;

  const openEvent = () => {
    markViewed(event.Id);
    navigate(`/events/${event.Id}`, { state: { from: '/events', eventFilters } });
  };

  return (
    // The arrow straddles the tile's top edge, as it does on a list row. It has
    // to sit outside the Card, which clips its overflow to keep the thumbnail
    // inside the rounded corners.
    <div className="relative">
      {flash && <ReturnFlashArrow />}
      <Card
        data-testid="event-montage-tile"
        data-event-id={event.Id}
        className={cn(
          'overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary transition-all',
          flash && 'ring-2 ring-primary/60'
        )}
        onClick={openEvent}
      >
        <div className="relative bg-card" style={{ aspectRatio: aspectRatio.toString() }}>
          {showHover ? (
          <EventThumbnailHoverPreview event={event} aspectRatio={aspectRatio} profileId={profileId}>
            <EventThumbnail
              urls={thumbnailUrls}
              cacheKey={event.Id}
              alt={event.Name}
              className="w-full h-full"
              objectFit={thumbnailFit}
              loading="lazy"
            />
          </EventThumbnailHoverPreview>
        ) : (
          <EventThumbnail
            urls={thumbnailUrls}
            cacheKey={event.Id}
            alt={event.Name}
            className="w-full h-full"
            objectFit={thumbnailFit}
            loading="lazy"
          />
        )}
        <div className="absolute top-2 right-2 flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {event.Length}s
          </Badge>
          {hasVideo && (
            <Button
              variant="secondary"
              size="icon"
              className="h-8 w-8"
              onClick={async (e) => {
                e.stopPropagation();
                await triggerHaptic();
                downloadEventVideo(eventPortalUrl, event.Id, event.Name, effectiveAccessToken, effectiveMinStreamingPort, event.MonitorId);
                // Background task drawer will show download progress
              }}
              title={t('eventMontage.download_video')}
              aria-label={t('eventMontage.download_video')}
              data-testid="event-download-button"
            >
              <Download className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      <div className="p-3 space-y-1">
        <div className="font-medium text-sm truncate" title={event.Name}>
          {event.Name}
        </div>
        <div className="text-xs text-muted-foreground truncate">{monitorName}</div>
        {profileChip && (
          <span
            className="inline-block text-[10px] px-1.5 py-0 rounded bg-muted text-muted-foreground truncate max-w-[100px]"
            title={profileChip}
            data-testid="event-profile-chip"
          >
            {profileChip}
          </span>
        )}
        <div className="text-xs text-muted-foreground truncate">
          {fmtDateTimeShort(startTime)}
          {isWithinDays(startTime, RELATIVE_TIME_LIST_WINDOW_DAYS) && (
            <span data-testid="event-montage-relative-time">
              {` · ${formatEventRelative(startTime, i18n.language, t)}`}
            </span>
          )}
        </div>
        {event.Cause && (() => {
          const CauseIcon = getEventCauseIcon(event.Cause);
          return (
            <Badge variant="outline" className="text-xs gap-1">
              <CauseIcon className="h-3 w-3" />
              {event.Cause}
            </Badge>
          );
        })()}
        {event.Notes && (() => {
          const noteText = event.Notes.split('|')[0].trim();
          const isDetection = noteText.startsWith('detected:');
          const classList = isDetection ? noteText.slice('detected:'.length) : '';
          const NoteIcon = isDetection && classList ? getObjectClassIconFromList(classList) : null;
          return (
            <p className="flex items-center gap-1 text-[10px] text-muted-foreground truncate" title={event.Notes}>
              {NoteIcon && <NoteIcon className="h-3 w-3 shrink-0" />}
              <span className="truncate">{noteText}</span>
            </p>
          );
        })()}
        {/* Tags */}
        {tags && tags.length > 0 && (
          <TagChipList
            tags={tags}
            maxVisible={3}
            size="sm"
            overflowText={(count) => t('events.tags.moreCount', { count })}
          />
        )}
        </div>
      </Card>
    </div>
  );
});

interface EventMontageViewProps {
  events: ScopedEventItem[];
  /** All mode only: monitors carry their owning profileId so a colliding
   *  numeric id across two servers doesn't collapse into one map entry
   *  (same contract as EventListView's monitors prop). */
  monitors: Array<{ Monitor: Monitor; profileId?: ProfileId }>;
  gridCols: number;
  thumbnailFit: 'contain' | 'cover' | 'none' | 'scale-down';
  portalUrl: string;
  accessToken?: string;
  batchSize: number;
  totalCount?: number;
  isFetching?: boolean;
  onLoadMore: () => void;
  eventTagMap?: Map<string, Tag[]>;
  eventFilters?: EventFilters;
  minStreamingPort?: number;
}

export const EventMontageView = ({
  events,
  monitors,
  gridCols,
  thumbnailFit,
  portalUrl,
  accessToken,
  batchSize,
  totalCount,
  isFetching = false,
  onLoadMore,
  eventTagMap,
  eventFilters,
  minStreamingPort,
}: EventMontageViewProps) => {
  const { t } = useTranslation();
  const { settings } = useCurrentProfile();
  const thumbnailChain = settings.thumbnailFallbackChain;
  const showHover = settings.hoverPreview.eventsGrid;

  // Re-render when the server map changes (e.g. multi-server bootstrap
  // populating it after this grid's first render) - same reasoning as
  // EventListView's monitorMap (refs #337 Task 2).
  const serverMapVersion = useSyncExternalStore(subscribeServerMap, getServerMapVersion);

  // id -> Monitor lookup, same shape/reasoning as EventListView's monitorMap:
  // keyed by `${profileId}:${monitorId}` too so a colliding numeric id across
  // two servers doesn't collapse into one entry.
  const monitorMap = useMemo(() => {
    const map = new Map<string, Monitor>();
    for (const m of monitors) {
      map.set(m.Monitor.Id, m.Monitor);
      if (m.profileId) map.set(`${m.profileId}:${m.Monitor.Id}`, m.Monitor);
    }
    return map;
  }, [monitors, serverMapVersion]);

  const isLoadingData = isFetching;
  const hasMore = totalCount !== undefined ? events.length < totalCount : false;
  const remaining = totalCount !== undefined ? Math.min(batchSize, totalCount - events.length) : batchSize;

  return (
    <div className="min-h-0" data-testid="events-montage-grid">
      {/* Status header */}
      <div className="text-xs text-muted-foreground pb-3 flex items-center gap-2">
        {isFetching && <Loader2 className="h-3 w-3 animate-spin" />}
        {totalCount !== undefined
          ? t('events.showing_of_total', { showing: events.length, total: totalCount })
          : t('events.showing_events', { count: events.length })}
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}>
        {events.map((eventData) => (
          <EventMontageTile
            key={eventData.profileId ? `${eventData.profileId}:${eventData.Event.Id}` : eventData.Event.Id}
            event={eventData.Event}
            profileId={eventData.profileId}
            profileChip={eventData.profileChip}
            monitorMap={monitorMap}
            thumbnailFit={thumbnailFit}
            thumbnailChain={thumbnailChain}
            showHover={showHover}
            portalUrl={portalUrl}
            accessToken={accessToken}
            tags={eventTagMap?.get(eventData.Event.Id)}
            eventFilters={eventFilters}
            minStreamingPort={minStreamingPort}
          />
        ))}
      </div>

      {/* Load More button */}
      {hasMore && (
        <div className="text-center py-4">
          <Button
            onClick={onLoadMore}
            disabled={isLoadingData}
            variant="outline"
            size="sm"
            className="w-full"
            data-testid="events-load-more"
          >
            {isLoadingData ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t('events.loading_more', { count: remaining })}
              </>
            ) : (
              t('events.load_more')
            )}
          </Button>
        </div>
      )}
    </div>
  );
};
