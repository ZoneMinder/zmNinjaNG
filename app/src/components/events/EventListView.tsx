/**
 * Event List View
 *
 * List view of events with thumbnails and metadata.
 */

import { memo, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { EventCard } from './EventCard';
import { type EventFilters } from '../../api/events';
import { getPortalUrlForMonitor, getServerMapVersion, subscribeServerMap } from '../../lib/zm/server-resolver';
import { buildThumbnailChain, eventHasAlarmFrame } from '../../lib/event/thumbnail-chain';
import { calculateThumbnailDimensions, EVENT_GRID_CONSTANTS, getMonitorDimensions } from '../../lib/event/event-utils';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import type { EventData, Monitor, Tag } from '../../api/types';
import type { ThumbnailFallbackEntry } from '../../stores/settings';

interface EventListViewProps {
  events: EventData[];
  monitors: Array<{ Monitor: Monitor }>;
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

// Helper to render a single event item
// Memoized: with a stable monitorMap and stable callback/array props from the
// parent, this skips re-rendering rows unaffected by a given state change.
const EventItem = memo(function EventItem({
  event,
  monitorMap,
  thumbnailFit,
  portalUrl,
  accessToken,
  eventTagMap,
  eventFilters,
  minStreamingPort,
  thumbnailChain,
}: {
  event: EventData;
  monitorMap: Map<string, Monitor>;
  thumbnailFit: 'contain' | 'cover' | 'none' | 'scale-down';
  portalUrl: string;
  accessToken?: string;
  eventTagMap?: Map<string, Tag[]>;
  eventFilters?: EventFilters;
  minStreamingPort?: number;
  thumbnailChain: ThumbnailFallbackEntry[];
}) {
  const { Event } = event;
  // O(1) lookup via the id -> Monitor map built once per monitors change,
  // instead of an O(monitors) `.find()` per row per render.
  const monitorData = monitorMap.get(Event.MonitorId);

  const { width: monitorWidth, height: monitorHeight } = getMonitorDimensions(monitorData, Event.Width, Event.Height);

  const { width: thumbnailWidth, height: thumbnailHeight } = calculateThumbnailDimensions(
    monitorWidth,
    monitorHeight,
    monitorData?.Orientation ?? Event.Orientation,
    EVENT_GRID_CONSTANTS.LIST_VIEW_TARGET_SIZE
  );

  // Resolve the portal URL directly from the already-looked-up monitor
  // instead of getPortalUrlForEvent(), which would re-run its own
  // O(monitors) find() over the full monitors array.
  const eventPortalUrl = getPortalUrlForMonitor(monitorData?.ServerId, portalUrl);
  const thumbnailUrls = buildThumbnailChain(eventPortalUrl, Event.Id, thumbnailChain, {
    token: accessToken,
    width: thumbnailWidth,
    height: thumbnailHeight,
    minStreamingPort,
    monitorId: Event.MonitorId,
    hasAlarmFrame: eventHasAlarmFrame(Event),
  });

  // Full-size image chain used by the desktop hover preview. No width/height
  // is passed so ZM returns the original image, which the view scales down.
  const largeThumbnailUrls = buildThumbnailChain(eventPortalUrl, Event.Id, thumbnailChain, {
    token: accessToken,
    minStreamingPort,
    monitorId: Event.MonitorId,
    hasAlarmFrame: eventHasAlarmFrame(Event),
  });

  const monitorName = monitorData?.Name || `Camera ${Event.MonitorId}`;

  return (
    <div className="pb-3">
      <EventCard
        event={Event}
        monitorName={monitorName}
        thumbnailUrls={thumbnailUrls}
        largeThumbnailUrls={largeThumbnailUrls}
        objectFit={thumbnailFit}
        thumbnailWidth={thumbnailWidth}
        thumbnailHeight={thumbnailHeight}
        tags={eventTagMap?.get(Event.Id)}
        eventFilters={eventFilters}
      />
    </div>
  );
});

export const EventListView = ({
  events,
  monitors,
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
}: EventListViewProps) => {
  const { t } = useTranslation();
  const { settings } = useCurrentProfile();
  const thumbnailChain = settings.thumbnailFallbackChain;

  // Re-render when the server map changes (e.g. multi-server bootstrap
  // populating it after this list's first render). EventItem below is
  // memo()-wrapped and resolves its portal URL from that module-global map
  // directly in getPortalUrlForMonitor, so without this the memoized rows
  // would keep the stale (possibly empty) URL forever once mounted.
  const serverMapVersion = useSyncExternalStore(subscribeServerMap, getServerMapVersion);

  // id -> Monitor lookup, rebuilt when the monitors array reference changes
  // or the server map version bumps (see above). Replaces a monitors.find()
  // per event per render (O(events x monitors)) with an O(1) map.get() per
  // event, while still forcing memoized EventItem rows to refresh their
  // per-server URLs once the server map arrives.
  const monitorMap = useMemo(
    () => new Map(monitors.map((m) => [m.Monitor.Id, m.Monitor])),
    [monitors, serverMapVersion]
  );

  const isLoadingData = isFetching;
  const hasMore = totalCount !== undefined ? events.length < totalCount : false;
  const remaining = totalCount !== undefined ? Math.min(batchSize, totalCount - events.length) : batchSize;

  // Status header - shows "Showing X of Y events" at the top
  const header = (
    <div className="text-xs text-muted-foreground pb-3 flex items-center gap-2">
      {isFetching && <Loader2 className="h-3 w-3 animate-spin" />}
      {totalCount !== undefined
        ? t('events.showing_of_total', { showing: events.length, total: totalCount })
        : t('events.showing_events', { count: events.length })}
    </div>
  );

  // Footer with Load More button
  const footer = hasMore ? (
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
  ) : null;

  return (
    <div className="min-h-0" data-testid="event-list">
      {header}
      {events.map((event) => (
        <EventItem
          key={event.Event.Id}
          event={event}
          monitorMap={monitorMap}
          thumbnailFit={thumbnailFit}
          portalUrl={portalUrl}
          accessToken={accessToken}
          eventTagMap={eventTagMap}
          eventFilters={eventFilters}
          minStreamingPort={minStreamingPort}
          thumbnailChain={thumbnailChain}
        />
      ))}
      {footer}
    </div>
  );
};
