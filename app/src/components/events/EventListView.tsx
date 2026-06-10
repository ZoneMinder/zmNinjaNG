/**
 * Event List View
 *
 * List view of events with thumbnails and metadata.
 * Rows are virtualized with @tanstack/react-virtual against the page
 * scroll container passed in via `scrollRef`.
 */

import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { EventCard } from './EventCard';
import { type EventFilters } from '../../api/events';
import { getPortalUrlForEvent } from '../../lib/server-resolver';
import { buildThumbnailChain } from '../../lib/thumbnail-chain';
import { calculateThumbnailDimensions, EVENT_GRID_CONSTANTS, getMonitorDimensions } from '../../lib/event-utils';
import { LIST_VIRTUALIZATION } from '../../lib/zmninja-ng-constants';
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
  isLoadingMore: boolean;
  isFetching?: boolean;
  onLoadMore: () => void;
  eventTagMap?: Map<string, Tag[]>;
  eventFilters?: EventFilters;
  minStreamingPort?: number;
  /** Scrollable ancestor that the virtualizer measures against. */
  scrollRef: RefObject<HTMLDivElement | null>;
}

// Helper to render a single event item
const EventItem = ({
  event,
  monitors,
  thumbnailFit,
  portalUrl,
  accessToken,
  eventTagMap,
  eventFilters,
  minStreamingPort,
  thumbnailChain,
}: {
  event: EventData;
  monitors: Array<{ Monitor: Monitor }>;
  thumbnailFit: 'contain' | 'cover' | 'none' | 'scale-down';
  portalUrl: string;
  accessToken?: string;
  eventTagMap?: Map<string, Tag[]>;
  eventFilters?: EventFilters;
  minStreamingPort?: number;
  thumbnailChain: ThumbnailFallbackEntry[];
}) => {
  const { Event } = event;
  const monitorData = monitors.find((m) => m.Monitor.Id === Event.MonitorId)?.Monitor;

  const { width: monitorWidth, height: monitorHeight } = getMonitorDimensions(monitorData, Event.Width, Event.Height);

  const { width: thumbnailWidth, height: thumbnailHeight } = calculateThumbnailDimensions(
    monitorWidth,
    monitorHeight,
    monitorData?.Orientation ?? Event.Orientation,
    EVENT_GRID_CONSTANTS.LIST_VIEW_TARGET_SIZE
  );

  const eventPortalUrl = getPortalUrlForEvent(Event.MonitorId, monitors, portalUrl);
  const thumbnailUrls = buildThumbnailChain(eventPortalUrl, Event.Id, thumbnailChain, {
    token: accessToken,
    width: thumbnailWidth,
    height: thumbnailHeight,
    minStreamingPort,
    monitorId: Event.MonitorId,
  });

  // Full-size image chain used by the desktop hover preview. No width/height
  // is passed so ZM returns the original image, which the view scales down.
  const largeThumbnailUrls = buildThumbnailChain(eventPortalUrl, Event.Id, thumbnailChain, {
    token: accessToken,
    minStreamingPort,
    monitorId: Event.MonitorId,
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
};

export const EventListView = ({
  events,
  monitors,
  thumbnailFit,
  portalUrl,
  accessToken,
  batchSize,
  totalCount,
  isLoadingMore,
  isFetching = false,
  onLoadMore,
  eventTagMap,
  eventFilters,
  minStreamingPort,
  scrollRef,
}: EventListViewProps) => {
  const { t } = useTranslation();
  const { settings } = useCurrentProfile();
  const thumbnailChain = settings.thumbnailFallbackChain;

  // Offset of the list inside the scroll container (header, heatmap, and
  // filter controls render above it). Re-read every render: the heatmap
  // appears and disappears with the data.
  const listRef = useRef<HTMLDivElement>(null);
  const listOffsetRef = useRef(0);
  useLayoutEffect(() => {
    listOffsetRef.current = listRef.current?.offsetTop ?? 0;
  });

  // getItemKey must keep a stable identity between renders: the virtualizer
  // treats a new function as a measurement-options change and schedules a
  // re-render during render, which loops forever.
  const getItemKey = useCallback((index: number) => events[index].Event.Id, [events]);

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LIST_VIRTUALIZATION.eventRowEstimate,
    overscan: LIST_VIRTUALIZATION.overscan,
    scrollMargin: listOffsetRef.current,
    getItemKey,
  });

  const isLoadingData = isLoadingMore || isFetching;
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
      <div
        ref={listRef}
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            ref={virtualizer.measureElement}
            data-index={virtualRow.index}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)` }}
          >
            <EventItem
              event={events[virtualRow.index]}
              monitors={monitors}
              thumbnailFit={thumbnailFit}
              portalUrl={portalUrl}
              accessToken={accessToken}
              eventTagMap={eventTagMap}
              eventFilters={eventFilters}
              minStreamingPort={minStreamingPort}
              thumbnailChain={thumbnailChain}
            />
          </div>
        ))}
      </div>
      {footer}
    </div>
  );
};
