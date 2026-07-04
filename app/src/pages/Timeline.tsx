import { useEffect, useMemo, useCallback, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { FilterX, Clock } from 'lucide-react';
import { PageContainer } from '../components/common/PageContainer';
import { ErrorBanner } from '../components/ui/query-state';
import { resolveQueryError } from '../lib/query/query-error';
import { subDays } from 'date-fns';
import { formatLocalDateTime } from '../lib/time';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../components/ui/empty-state';
import { NotificationBadge } from '../components/NotificationBadge';
import { useTimelineFilters } from '../hooks/useTimelineFilters';
import { useTimelineData } from '../hooks/useTimelineData';
import { useTvKeyHandler } from '../hooks/useTvKeyHandler';
import { useEventTagMapping } from '../hooks/useEventTags';
import { TimelineCanvas, type ViewportAction, type ViewportActionType } from '../components/timeline/TimelineCanvas';
import { TimelineFiltersPanel } from '../components/timeline/TimelineFiltersPanel';
import { TimelineToolbar } from '../components/timeline/TimelineToolbar';
import { TimelineStats } from '../components/timeline/TimelineStats';
import { DetectionFilterTabs } from '../components/timeline/DetectionFilterTabs';
import { useDetectionCategories } from '../components/timeline/useDetectionCategories';
import { EventPreviewPopover } from '../components/timeline/EventPreviewPopover';
import type { TimelineEvent } from '../components/timeline/timeline-layout';
import type { MonitorRow } from '../components/timeline/timeline-renderer';
import type { ScrubberState } from '../components/timeline/TimelineScrubber';

export default function Timeline() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const filters = useTimelineFilters();
  const { selectedMonitorIds, onlyDetectedObjects, causeFilter } = filters;

  // Stable default dates: computed once, not every render
  const defaultDates = useRef({
    start: formatLocalDateTime(subDays(new Date(), 1)),
    end: formatLocalDateTime(new Date()),
  });
  const startDate = filters.startDateInput || defaultDates.current.start;
  const endDate = filters.endDateInput || defaultDates.current.end;

  // Brush-to-zoom mode toggle
  const [brushMode, setBrushMode] = useState(false);

  // Live mode: subscribe to notification store for new events, fall back to polling
  const [liveMode, setLiveMode] = useState(false);

  // One-shot viewport actions; a new seq triggers the action in TimelineCanvas
  const [viewportAction, setViewportAction] = useState<ViewportAction | null>(null);
  const fireViewportAction = useCallback((type: ViewportActionType) => {
    setViewportAction((prev) => ({ type, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  useTvKeyHandler({
    ArrowLeft: () => fireViewportAction('panLeft'),
    ArrowRight: () => fireViewportAction('panRight'),
    ArrowUp: () => fireViewportAction('zoomIn'),
    ArrowDown: () => fireViewportAction('zoomOut'),
  });

  // Scrubber state: persisted to sessionStorage so it survives any back navigation
  const SCRUBBER_KEY = 'timeline-scrubber-state';
  const scrubberStateRef = useRef<ScrubberState | null>(null);
  const [initialScrubberState, setInitialScrubberState] = useState<ScrubberState | null>(null);

  // Re-check sessionStorage on every navigation to this page (location.key changes)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SCRUBBER_KEY);
      if (saved) {
        sessionStorage.removeItem(SCRUBBER_KEY);
        setInitialScrubberState(JSON.parse(saved));
      }
    } catch { /* ignore */ }
  }, [location.key]);

  const handleScrubberStateChange = useCallback((state: ScrubberState | null) => {
    scrubberStateRef.current = state;
  }, []);

  /** Navigate to event, saving scrubber state for return. */
  const navigateToEvent = useCallback((eventId: string) => {
    if (scrubberStateRef.current) {
      sessionStorage.setItem(SCRUBBER_KEY, JSON.stringify(scrubberStateRef.current));
    }
    navigate(`/events/${eventId}`, { state: { from: '/timeline' } });
  }, [navigate]);

  // Event preview popover state
  const [selectedEvent, setSelectedEvent] = useState<{
    event: TimelineEvent;
    position: { x: number; y: number };
  } | null>(null);

  const { data, isLoading, error, enabledMonitors, allTimelineEvents, eventIds, rawEventMap } = useTimelineData({
    startDate,
    endDate,
    liveMode,
    selectedMonitorIds,
    onlyDetectedObjects,
    causeFilter,
  });

  // In live mode, scroll to NOW after data arrives (not before, to avoid blank canvas)
  const prevDataRef = useRef(data);
  useEffect(() => {
    if (liveMode && data !== prevDataRef.current) {
      prevDataRef.current = data;
      fireViewportAction('followNow');
    }
  }, [liveMode, data, fireViewportAction]);

  // Build monitor lookup map
  const monitorNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const { Monitor } of enabledMonitors) {
      map.set(Monitor.Id, Monitor.Name);
    }
    return map;
  }, [enabledMonitors]);

  // Detection category state, counts, and filtered events
  const {
    category: detectionCategory,
    setCategory: setDetectionCategory,
    counts: detectionCounts,
    filteredEvents,
  } = useDetectionCategories(allTimelineEvents);

  // Build MonitorRow[] for canvas: only monitors that have events in the filtered set
  const monitorRows: MonitorRow[] = useMemo(() => {
    const activeIds = new Set(filteredEvents.map((ev) => ev.monitorId));
    const rows: MonitorRow[] = [];
    // Deduplicate and maintain stable order
    const seen = new Set<string>();
    for (const { Monitor } of enabledMonitors) {
      if (activeIds.has(Monitor.Id) && !seen.has(Monitor.Id)) {
        seen.add(Monitor.Id);
        rows.push({ id: Monitor.Id, name: Monitor.Name });
      }
    }
    return rows;
  }, [enabledMonitors, filteredEvents]);

  // Canvas time range: fit to actual event extent + "now" (with padding), fall back to filter range
  const { startMs, endMs } = useMemo(() => {
    const filterStart = new Date(startDate).getTime();
    const filterEnd = new Date(endDate).getTime();
    const now = Date.now();

    if (filteredEvents.length === 0) {
      return { startMs: filterStart, endMs: filterEnd };
    }

    let minMs = Infinity;
    let maxMs = -Infinity;
    for (const ev of filteredEvents) {
      if (ev.startMs < minMs) minMs = ev.startMs;
      if (ev.endMs > maxMs) maxMs = ev.endMs;
    }

    // Include "now" in the extent so the NOW marker is always visible on load
    if (now >= filterStart && now <= filterEnd) {
      if (now > maxMs) maxMs = now;
      if (now < minMs) minMs = now;
    }

    // Add 5% padding on each side so events aren't flush with edges
    const span = maxMs - minMs;
    const padding = Math.max(span * 0.05, 60_000); // at least 1 minute
    return {
      startMs: Math.max(filterStart, minMs - padding),
      endMs: maxMs + padding,
    };
  }, [filteredEvents, startDate, endDate]);

  // Fetch tags for loaded events
  const { getTagsForEvent } = useEventTagMapping({ eventIds });

  const handleEventClick = useCallback((ev: TimelineEvent) => {
    // Find the raw API event data for the popover
    const raw = rawEventMap.get(ev.id);
    if (!raw) return;
    // Position the popover near the center of the screen
    setSelectedEvent({
      event: ev,
      position: { x: window.innerWidth / 2 - 144, y: 200 },
    });
  }, [rawEventMap]);

  const handleEventHover = useCallback((_event: TimelineEvent | null, _x: number, _y: number) => {
    // Hover is handled by the canvas renderer (highlight effect)
  }, []);

  const handleOpenEvent = useCallback((eventId: string) => {
    setSelectedEvent(null);
    navigateToEvent(eventId);
  }, [navigateToEvent]);

  const handleClosePopover = useCallback(() => {
    setSelectedEvent(null);
  }, []);

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-lg font-bold mb-6">{t('timeline.title')}</h1>
        <ErrorBanner message={resolveQueryError(error, t, { fallbackKey: 'timeline.load_error' })} />
      </div>
    );
  }

  // Build popover event data from selected event
  const popoverEvent = selectedEvent ? (() => {
    const raw = rawEventMap.get(selectedEvent.event.id);
    if (!raw) return null;
    return {
      id: raw.Event.Id,
      monitorId: raw.Event.MonitorId,
      cause: raw.Event.Cause,
      startDateTime: raw.Event.StartDateTime,
      duration: raw.Event.Length,
      alarmFrames: raw.Event.AlarmFrames,
      notes: raw.Event.Notes,
      monitorName: monitorNameMap.get(raw.Event.MonitorId) ?? raw.Event.Name,
      tags: getTagsForEvent(raw.Event.Id).map((tag) => tag.Name),
    };
  })() : null;

  return (
    <PageContainer spacing="none" className="space-y-3 sm:space-y-4 md:space-y-6" data-testid="timeline-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base sm:text-lg font-bold tracking-tight">{t('timeline.title')}</h1>
            <NotificationBadge />
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 hidden sm:block">
            <span className="hidden sm:inline">{t('timeline.subtitle')}</span>
            {selectedMonitorIds.length > 0 && ` (${t('timeline.cameras_selected', { count: selectedMonitorIds.length })})`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => { filters.clearFilters(); filters.setActiveQuickRange(null); defaultDates.current = { start: formatLocalDateTime(subDays(new Date(), 1)), end: formatLocalDateTime(new Date()) }; }} variant="outline" size="sm" className="h-8 sm:h-9" data-testid="timeline-clear-button">
            <FilterX className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">{t('common.clear')}</span>
          </Button>
        </div>
      </div>

      {/* Filters */}
      <TimelineFiltersPanel
        filters={filters}
        startDate={startDate}
        endDate={endDate}
        monitors={enabledMonitors}
      />

      {/* Detection Filter Tabs */}
      {allTimelineEvents.length > 0 && (
        <div className="flex items-center justify-between gap-4" data-testid="timeline-detection-filters">
          <DetectionFilterTabs
            selected={detectionCategory}
            onSelect={setDetectionCategory}
            counts={detectionCounts}
          />
        </div>
      )}

      {/* Timeline Canvas */}
      <Card className="shadow-lg">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-[600px] gap-4" data-testid="timeline-loading">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
              <div className="text-muted-foreground">{t('timeline.loading')}</div>
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="h-[600px] flex items-center justify-center" data-testid="timeline-empty-state">
              <EmptyState
                icon={Clock}
                title={detectionCategory !== 'all' ? t('timeline.no_events_in_range') : t('timeline.no_events_found')}
                description={t('timeline.adjust_filters')}
              />
            </div>
          ) : (
            <div className="p-4" data-testid="timeline-content">
              <TimelineToolbar
                brushMode={brushMode}
                liveMode={liveMode}
                onToggleBrush={() => setBrushMode((b) => !b)}
                onToggleLive={() => setLiveMode((v) => !v)}
                onZoomIn={() => fireViewportAction('zoomIn')}
                onZoomOut={() => fireViewportAction('zoomOut')}
                onCenter={() => fireViewportAction('reset')}
                onGoToNow={() => fireViewportAction('goToNow')}
              />
              <TimelineCanvas
                monitors={monitorRows}
                events={filteredEvents}
                startMs={startMs}
                endMs={endMs}
                viewportAction={viewportAction}
                onEventClick={handleEventClick}
                onEventHover={handleEventHover}
                onScrubberEventTap={navigateToEvent}
                onScrubberStateChange={handleScrubberStateChange}
                initialScrubberState={initialScrubberState}
                brushMode={brushMode}
                liveMode={liveMode}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Event Preview Popover */}
      {selectedEvent && popoverEvent && (
        <EventPreviewPopover
          event={popoverEvent}
          position={selectedEvent.position}
          onOpenEvent={handleOpenEvent}
          onClose={handleClosePopover}
        />
      )}

      {/* Event Statistics */}
      <TimelineStats events={data?.events ?? []} />
    </PageContainer>
  );
}
