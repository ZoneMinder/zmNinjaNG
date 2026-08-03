/**
 * Events Page
 *
 * Displays a list of events with filtering and infinite scrolling.
 * Uses virtualization for performance with large lists.
 */

import { useMemo, useRef, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/query/query-keys';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import type { EventFilters } from '../api/events';
import type { ProfileId } from '../api/types';
import { getCurrentSession } from '../services/sessions';
import { getMonitors } from '../api/monitors';
import { resolveMinStreamingPort } from '../lib/monitor/multiport';
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { useProfileScope } from '../hooks/useProfileScope';
import { useScopedEvents } from '../hooks/useScopedEvents';
import { useScopedMonitors } from '../hooks/useScopedMonitors';
import { useProfileStore } from '../stores/profile';
import { useAuthSlice } from '../stores/auth';
import { useFreshAccessToken } from '../hooks/useFreshAccessToken';
import { useSettingsStore, ALL_GROUPS_KEY, DEFAULT_EVENT_MONTAGE_GROUP_LAYOUT } from '../stores/settings';
import { useEventFilters, ALL_TAGS_FILTER_ID } from '../hooks/useEventFilters';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { useEventPagination } from '../hooks/useEventPagination';
import { useEventMontageGrid } from '../hooks/useEventMontageGrid';
import { useEventTags, useEventTagMapping } from '../hooks/useEventTags';
import { useScrollRestoration } from '../hooks/useScrollRestoration';
import { PullToRefreshIndicator } from '../components/ui/pull-to-refresh-indicator';
import { Button } from '../components/ui/button';
import { Filter, ArrowLeft, LayoutGrid, List, Clock, X } from 'lucide-react';
import { RefreshButton } from '../components/common/RefreshButton';
import { filterMonitorsByGroup, includedMonitorIdParam } from '../lib/monitor/filters';
import { useGroupFilter } from '../hooks/useGroupFilter';
import { GroupFilterSelect } from '../components/filters/GroupFilterSelect';
import { Popover, PopoverTrigger } from '../components/ui/popover';
import { EventHeatmap } from '../components/events/EventHeatmap';
import { EventMontageView } from '../components/events/EventMontageView';
import { EventListView, type ScopedEventItem } from '../components/events/EventListView';
import { EventsAllModeBar } from '../components/events/EventsAllModeBar';
import { EventMontageGridControls } from '../components/events/EventMontageGridControls';
import { EventsFilterPopover } from '../components/events/EventsFilterPopover';
import { QuickDateRangeButtons } from '../components/ui/quick-date-range-buttons';
import { useTranslation } from 'react-i18next';
import { formatForServer, formatLocalDateTime } from '../lib/time';
import { EmptyState } from '../components/ui/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { useEventFavoritesStore } from '../stores/eventFavorites';
import { NotificationBadge } from '../components/NotificationBadge';

export default function Events() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentProfile, settings, isAllMode } = useCurrentProfile();
  // Settings-update target: the real profile id in single mode, or the ALL
  // bucket sentinel in All mode (currentProfile stays null there) - same
  // pattern Monitors.tsx uses so view-level toggles persist in both modes.
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  const scope = useProfileScope();
  const totalScopeProfiles = scope?.profiles.length ?? 0;
  const normalizedThumbnailFit = settings.eventsThumbnailFit === 'fill'
    ? 'contain'
    : settings.eventsThumbnailFit;
  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);
  const updateEventMontageGroupLayout = useSettingsStore(
    (state) => state.updateEventMontageGroupLayout
  );
  const { token: accessToken, isFresh: isAccessTokenFresh } = useFreshAccessToken();
  const isAuthenticated = useAuthSlice(currentProfile?.id ?? null).isAuthenticated;
  const { selectedGroupId, isFilterActive: isGroupFilterActive, filteredMonitorIds: groupMonitorIds } = useGroupFilter();
  const groupKey = selectedGroupId ?? ALL_GROUPS_KEY;
  const eventCols =
    settings.eventMontageByGroup[groupKey]?.gridCols ??
    DEFAULT_EVENT_MONTAGE_GROUP_LAYOUT.gridCols;

  // Subscribe to the actual favorites data, not just the getter function
  // Use shallow comparison to avoid infinite re-renders from new array references
  const favoriteIds = useEventFavoritesStore(
    useShallow((state) =>
      currentProfile ? state.getFavorites(currentProfile.id) : []
    )
  );

  const parentRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  // Check if user came from another page (navigation state tracking)
  const referrer = location.state?.from as string | undefined;

  const {
    filters,
    selectedMonitorIds,
    selectedTagIds,
    startDateInput,
    endDateInput,
    favoritesOnly,
    archivedOnly,
    setSelectedMonitorIds,
    setSelectedTagIds,
    setStartDateInput,
    setEndDateInput,
    setFavoritesOnly,
    setArchivedOnly,
    onlyDetectedObjects,
    setOnlyDetectedObjects,
    activeQuickRange,
    setActiveQuickRange,
    applyFilters,
    clearFilters,
    clearDateRange,
    activeFilterCount,
  } = useEventFilters();

  // Fetch available tags and check if tags are supported
  const {
    availableTags,
    tagsSupported,
    isLoadingTags,
  } = useEventTags();

  const [viewMode, setViewMode] = useState<'list' | 'montage'>(() => {
    const paramView = searchParams.get('view');
    if (paramView === 'montage') {
      return 'montage';
    }
    return settings.eventsViewMode;
  });
  // Actual render mode: All mode gates montage off regardless of the stored
  // preference or a `?view=montage` deep link - see the montage-gate
  // comment at the toggle button below (refs #337 fix round 1).
  const effectiveViewMode = isAllMode ? 'list' : viewMode;

  // Fetch monitors for display in filter UI (single mode; unchanged query).
  const { data: monitorsData } = useQuery({
    queryKey: queryKeys.monitors(currentProfile?.id),
    queryFn: () => getMonitors(getCurrentSession().client, getCurrentSession().profileId),
    enabled: !!currentProfile && isAuthenticated,
  });

  // All mode: monitors across every profile in scope, for the server-grouped
  // filter picker and for EventListView's per-server thumbnail/name lookups.
  // Disabled in single mode (enabled ties to isAllMode), so this never
  // double-fetches what the query above already covers there.
  const { monitors: scopedMonitorsAll } = useScopedMonitors({ enabled: isAllMode });

  // All monitors (for filter popover display)
  const allMonitors = monitorsData?.monitors || [];

  // Monitors filtered by group (for filter popover when group is active).
  // Group filter is current-profile-scoped and skipped in All mode (see
  // useGroupFilter/Monitors.tsx - same Phase 3 boundary).
  const displayMonitors = useMemo(() => {
    if (!isGroupFilterActive) return allMonitors;
    return filterMonitorsByGroup(allMonitors, groupMonitorIds);
  }, [allMonitors, isGroupFilterActive, groupMonitorIds]);

  // Monitor list handed to EventListView: single mode passes the flat list
  // unchanged; All mode tags each monitor with its owning profileId so a
  // colliding numeric id across two servers resolves correctly per row.
  const eventListMonitors = useMemo(
    () => (isAllMode ? scopedMonitorsAll.map((s) => ({ ...s.item, profileId: s.profileId })) : displayMonitors),
    [isAllMode, scopedMonitorsAll, displayMonitors]
  );

  // Monitors grouped by owning server, for the All-mode filter popover.
  const monitorServerGroups = useMemo(() => {
    if (!isAllMode) return undefined;
    const byProfile = new Map<string, { profileId: string; profileName: string; monitors: typeof allMonitors }>();
    for (const s of scopedMonitorsAll) {
      const existing = byProfile.get(s.profileId);
      if (existing) {
        existing.monitors.push(s.item);
      } else {
        byProfile.set(s.profileId, { profileId: s.profileId, profileName: s.profileName, monitors: [s.item] });
      }
    }
    return Array.from(byProfile.values());
  }, [isAllMode, scopedMonitorsAll]);

  // Compute effective monitor IDs for API call:
  // 1. If user selected specific monitors in filter → use those
  // 2. Else if group filter is active → use group monitor IDs
  // 3. Else → undefined (fetch all)
  const effectiveMonitorId = useMemo(() => {
    // User's explicit filter takes priority
    if (filters.monitorId) {
      return filters.monitorId;
    }
    // Group filter - pass group monitor IDs to API
    if (isGroupFilterActive && groupMonitorIds.length > 0) {
      return groupMonitorIds.join(',');
    }
    // No explicit filter: if monitors are excluded, send the included set so the
    // server's totalCount and "Load More" exclude them too, instead of counting
    // events that get dropped after fetching (refs #205). Otherwise fetch all.
    return includedMonitorIdParam(allMonitors, settings.excludedMonitorIds);
  }, [filters.monitorId, isGroupFilterActive, groupMonitorIds, allMonitors, settings.excludedMonitorIds]);

  // Build filters with server-formatted dates for passing to EventDetail
  const serverFilters: EventFilters = useMemo(() => ({
    ...filters,
    startDateTime: filters.startDateTime ? formatForServer(new Date(filters.startDateTime)) : undefined,
    endDateTime: filters.endDateTime ? formatForServer(new Date(filters.endDateTime)) : undefined,
    monitorId: effectiveMonitorId,
  }), [filters, effectiveMonitorId]);

  // Favorites are stored locally, so push them into the server query as an
  // explicit ID set. This keeps the favorites filter consistent with pagination:
  // totalCount and "Load More" reflect the favorites, and favorites beyond the
  // first fetched page stay reachable (refs #205). undefined = no favorites filter.
  const eventIdFilter = useMemo(
    () => (favoritesOnly ? favoriteIds : undefined),
    [favoritesOnly, favoriteIds]
  );

  // Tags filter server-side too, so tagged events past the first page stay
  // reachable and "Load More" is accurate (refs #205). ZM cannot combine its
  // "Tags.Id:" filter with the favorites "Id IN:" query, so when favorites is
  // also on we leave tags to the client-side pass below (the favorite set is
  // fetched in full there, so that pass stays accurate). "All tags" expands to
  // every available tag id, i.e. events carrying any tag.
  const tagIdFilter = useMemo(() => {
    if (favoritesOnly || selectedTagIds.length === 0) return undefined;
    if (selectedTagIds.includes(ALL_TAGS_FILTER_ID)) {
      return availableTags.map((tag) => tag.Id);
    }
    return selectedTagIds;
  }, [favoritesOnly, selectedTagIds, availableTags]);

  // Manual "Load More" pagination. persistKey identifies the current result set
  // (everything the query key encodes except the limit itself) so the expanded
  // count survives the round-trip into an event and back, and resets when a
  // filter changes (refs #197). Opening an event unmounts this page, so a
  // component-local count would collapse back to the first page on return.
  const paginationKey = useMemo(
    () => JSON.stringify(
      queryKeys.eventsList(currentProfile?.id, filters, 0, effectiveMonitorId, isGroupFilterActive, eventIdFilter, tagIdFilter)
    ),
    [currentProfile?.id, filters, effectiveMonitorId, isGroupFilterActive, eventIdFilter, tagIdFilter]
  );
  const { eventLimit, batchSize, loadNextPage } = useEventPagination({
    defaultLimit: settings.defaultEventLimit || 100,
    persistKey: paginationKey,
  });

  // Fetch events with configured limit, aggregated across the active scope
  // (one profile in single mode, every profile in All mode - see
  // useScopedEvents). Single mode shares the SAME cache slot the page used
  // before: same queryKeys.eventsList(...) shape, filters passed RAW (not
  // pre-formatted - the hook converts dates per profile's own timezone).
  const {
    events: scopedEvents,
    errors: profileErrors,
    isLoading,
    isFetching,
    totalCount,
    refetchProfile,
    refetchAll,
  } = useScopedEvents({
    filters,
    limit: eventLimit,
    monitorId: effectiveMonitorId,
    isGroupFilterActive,
    eventIds: eventIdFilter,
    tagIds: tagIdFilter,
  });

  // A deep link from a monitor card / event detail / recent-events row in
  // All mode carries `?profileId=` alongside `monitorId` (refs #337): those
  // callers know which server the monitor id belongs to, so focus the
  // server filter down to just that profile instead of leaving the numeric
  // monitorId ambiguous across every server in scope. Runs once per
  // incoming profileId value, not on every render.
  const deepLinkedProfileId = isAllMode ? searchParams.get('profileId') : null;
  useEffect(() => {
    if (!deepLinkedProfileId || !currentProfileId) return;
    updateSettings(currentProfileId, { eventsServerFilter: [deepLinkedProfileId as ProfileId] });
  }, [deepLinkedProfileId, currentProfileId, updateSettings]);

  // Every profile in scope failed and none ever produced an event: distinct
  // from "no events match the filter" (same suppression semantics as
  // Monitors.tsx - refs #337, Task 4).
  const allFailed = profileErrors.length > 0 && profileErrors.length === totalScopeProfiles && scopedEvents.length === 0;
  // A strip only for a profile that produced zero events; one with cached
  // data and a background refetch error renders that data with no strip.
  const visibleErrors = profileErrors.filter(
    (err) => !scopedEvents.some((e) => e.profileId === err.profileId)
  );

  // ALL mode's server filter (settings.eventsServerFilter, null = every
  // profile) is applied client-side: useScopedEvents already fetched every
  // profile's slice, so narrowing the DISPLAYED list here is enough and
  // needs no extra query plumbing.
  const serverFilteredEvents = useMemo(() => {
    if (!isAllMode || !settings.eventsServerFilter) return scopedEvents;
    const included = new Set(settings.eventsServerFilter);
    return scopedEvents.filter((e) => included.has(e.profileId));
  }, [isAllMode, settings.eventsServerFilter, scopedEvents]);

  // Pull-to-refresh gesture
  const pullToRefresh = usePullToRefresh({
    containerRef: parentRef,
    onRefresh: refetchAll,
    enabled: true,
  });

  // Get event IDs for tag fetching. All mode: tag lookups stay
  // current-profile-scoped (v1 gap, same as Timeline) - events owned by a
  // non-current profile just show no tags rather than crashing.
  const eventIdsForTagFetch = useMemo(() =>
    serverFilteredEvents.map((e) => e.item.Event.Id),
    [serverFilteredEvents]
  );

  // Fetch tags for displayed events
  const { eventTagMap } = useEventTagMapping({
    eventIds: eventIdsForTagFetch,
    enabled: tagsSupported && eventIdsForTagFetch.length > 0,
  });

  // Memoize filtered events. The server applied monitor/group, date, favorites
  // (eventIds), and tags (tagIds). The one case left for the client is tags
  // while favorites is also on: ZM can't run both server-side, but the favorite
  // set is fetched in full above, so filtering it here by tag stays accurate.
  // Merges each item's Event with its owning profileId/profileChip
  // (undefined in single mode) for EventListView's per-row All-mode wiring.
  const allEvents: ScopedEventItem[] = useMemo(() => {
    let filtered = serverFilteredEvents;

    if (favoritesOnly && selectedTagIds.length > 0 && eventTagMap.size > 0) {
      const isAllTagsFilter = selectedTagIds.includes(ALL_TAGS_FILTER_ID);
      filtered = filtered.filter(({ item: { Event } }) => {
        const eventTags = eventTagMap.get(Event.Id) || [];
        if (isAllTagsFilter) {
          // "All" = show events that have at least one tag
          return eventTags.length > 0;
        }
        // Otherwise event must have at least one of the selected tags
        return eventTags.some(tag => selectedTagIds.includes(tag.Id));
      });
    }

    return filtered.map((e) => ({
      ...e.item,
      profileId: isAllMode ? e.profileId : undefined,
      profileChip: isAllMode ? e.profileName : undefined,
    }));
  }, [serverFilteredEvents, favoritesOnly, selectedTagIds, eventTagMap, isAllMode]);

  // Date range shown on the heatmap: explicit filters win, otherwise infer
  // the span from the loaded events.
  const heatmapDateRange = useMemo(() => {
    if (allEvents.length === 0) return null;

    if (filters.startDateTime && filters.endDateTime) {
      return { startDate: new Date(filters.startDateTime), endDate: new Date(filters.endDateTime) };
    }

    const eventDates = allEvents.map((e) => new Date(e.Event.StartDateTime));
    return {
      startDate: new Date(Math.min(...eventDates.map((d) => d.getTime()))),
      endDate: new Date(Math.max(...eventDates.map((d) => d.getTime()))),
    };
  }, [allEvents, filters.startDateTime, filters.endDateTime]);

  // Restore the list scroll position when returning from an event detail.
  // /events and /events/:id are sibling routes, so this component unmounts when
  // opening an event; without this the list snaps back to the top (refs #197).
  const restoreScrollRef = useScrollRestoration(location.key, !isLoading && allEvents.length > 0);

  // Use grid management hook (only active when in montage mode). Settings
  // writes below target currentProfileId (the ALL bucket sentinel in All
  // mode, the real profile id in single mode) so view-level toggles persist
  // in both modes, same as Monitors.tsx.
  const gridControls = useEventMontageGrid({
    initialCols: eventCols,
    containerRef: parentRef,
    onGridChange: (cols) => {
      if (currentProfileId) {
        updateEventMontageGroupLayout(currentProfileId, groupKey, { gridCols: cols });
      }
    },
  });

  useEffect(() => {
    const paramView = searchParams.get('view');
    if (paramView !== 'montage') return;
    setViewMode('montage');
    if (currentProfileId) {
      updateSettings(currentProfileId, { eventsViewMode: 'montage' });
    }
  }, [searchParams, currentProfileId, updateSettings]);

  useEffect(() => {
    if (!currentProfileId) return;
    setViewMode(settings.eventsViewMode);
    gridControls.setGridCols(eventCols);
    gridControls.setCustomCols(eventCols.toString());
  }, [currentProfileId, settings.eventsViewMode, groupKey, eventCols]);

  const handleViewModeChange = (mode: 'list' | 'montage') => {
    setViewMode(mode);
    if (currentProfileId) {
      updateSettings(currentProfileId, { eventsViewMode: mode });
    }
    const nextParams = new URLSearchParams(searchParams);
    if (mode === 'montage') {
      nextParams.set('view', 'montage');
    } else {
      nextParams.delete('view');
    }
    setSearchParams(nextParams, { replace: true });
  };

  const handleThumbnailFitChange = (value: string) => {
    if (!currentProfileId) return;
    updateSettings(currentProfileId, {
      eventsThumbnailFit: (value === 'fill' ? 'contain' : value) as typeof settings.eventsThumbnailFit,
    });
  };

  // isLoading never clears on a total outage (no profile ever gets data), so
  // the skeleton only shows while there's still a chance of that - once
  // every profile has errored, allFailed below takes over (refs #337, Task 4
  // finding - same as Monitors.tsx).
  const stillWaiting = isLoading && profileErrors.length === 0;
  if (stillWaiting) {
    return (
      <div className="flex flex-col h-full p-6 md:p-8 gap-6">
        <div className="flex justify-between flex-shrink-0">
          <div className="h-8 w-32 bg-muted rounded animate-pulse" />
          <div className="h-8 w-24 bg-muted rounded animate-pulse" />
        </div>
        <div className="flex-1 overflow-auto">
          <div className="grid grid-cols-1 gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="h-[140px] bg-muted rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        ref={(el) => {
          parentRef.current = el;
          restoreScrollRef(el);
        }}
        {...pullToRefresh.bind()}
        className="h-full overflow-auto p-3 sm:p-4 md:p-6 relative touch-pan-y"
        data-testid="events-scroll-container"
      >
        <PullToRefreshIndicator
          isPulling={pullToRefresh.isPulling}
          isRefreshing={pullToRefresh.isRefreshing}
          pullDistance={pullToRefresh.pullDistance}
          threshold={pullToRefresh.threshold}
        />
        <div className="flex flex-col gap-3 sm:gap-4 mb-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {referrer && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => navigate(referrer)}
                  title={t('common.go_back')}
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              )}
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base sm:text-lg font-bold tracking-tight">{t('events.title')}</h1>
                  <NotificationBadge />
                </div>
                <p className="text-xs text-muted-foreground hidden sm:block">{t('events.subtitle')}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <GroupFilterSelect />
              {/* Montage view in All mode would show every event with the
                  page-level (absent) current profile's portalUrl/token -
                  broken tiles for every event. Gated off for v1 rather than
                  wired: the fix is the same per-tile owning-profile pattern
                  EventItem already uses in EventListView, just for
                  EventMontageView's grid tiles too (ledger entry recorded;
                  see W-list). Single mode is unaffected. Refs #337 fix round 1. */}
              <span
                title={isAllMode ? t('events.montage_unavailable_all_mode') : undefined}
                data-testid={isAllMode ? 'events-montage-gate' : undefined}
              >
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => handleViewModeChange(viewMode === 'list' ? 'montage' : 'list')}
                  disabled={isAllMode}
                  title={isAllMode ? t('events.montage_unavailable_all_mode') : (viewMode === 'list' ? t('events.view_montage') : t('events.view_list'))}
                  aria-label={isAllMode ? t('events.montage_unavailable_all_mode') : (viewMode === 'list' ? t('events.view_montage') : t('events.view_list'))}
                  data-testid="events-view-toggle"
                >
                  {viewMode === 'list' ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}
                </Button>
              </span>
              <div className="flex items-center gap-2">
                <Select value={normalizedThumbnailFit} onValueChange={handleThumbnailFitChange}>
                  <SelectTrigger className="h-8 sm:h-9 w-[100px]" data-testid="events-thumbnail-fit-select">
                    <SelectValue placeholder={t('events.thumbnail_fit')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contain" data-testid="events-thumbnail-fit-contain">
                      {t('montage.fit_fit')}
                    </SelectItem>
                    <SelectItem value="cover" data-testid="events-thumbnail-fit-cover">
                      {t('montage.fit_crop')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {effectiveViewMode === 'montage' && (
                <EventMontageGridControls
                  gridCols={gridControls.gridCols}
                  customCols={gridControls.customCols}
                  isCustomGridDialogOpen={gridControls.isCustomGridDialogOpen}
                  onApplyGridLayout={gridControls.handleApplyGridLayout}
                  onCustomColsChange={gridControls.setCustomCols}
                  onCustomGridDialogOpenChange={gridControls.setIsCustomGridDialogOpen}
                  onCustomGridSubmit={gridControls.handleCustomGridSubmit}
                />
              )}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={activeFilterCount > 0 ? 'default' : 'outline'}
                    size="icon"
                    className="relative"
                    title={t('events.filters')}
                    aria-label={t('events.filters')}
                    data-testid="events-filter-button"
                  >
                    <Filter className="h-4 w-4" />
                    {activeFilterCount > 0 && (
                      <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-red-500 border-2 border-background" />
                    )}
                  </Button>
                </PopoverTrigger>
                <EventsFilterPopover
                  monitors={displayMonitors}
                  serverGroups={monitorServerGroups}
                  selectedMonitorIds={selectedMonitorIds}
                  onMonitorSelectionChange={setSelectedMonitorIds}
                  favoritesOnly={favoritesOnly}
                  onFavoritesOnlyChange={setFavoritesOnly}
                  archivedOnly={archivedOnly}
                  onArchivedOnlyChange={setArchivedOnly}
                  startDateInput={startDateInput}
                  onStartDateChange={setStartDateInput}
                  endDateInput={endDateInput}
                  onEndDateChange={setEndDateInput}
                  onQuickRangeSelect={({ start, end }) => {
                    setStartDateInput(formatLocalDateTime(start));
                    setEndDateInput(formatLocalDateTime(end));
                  }}
                  onApplyFilters={applyFilters}
                  onClearFilters={clearFilters}
                  tagsSupported={tagsSupported}
                  availableTags={availableTags}
                  selectedTagIds={selectedTagIds}
                  onTagSelectionChange={setSelectedTagIds}
                  isLoadingTags={isLoadingTags}
                  onlyDetectedObjects={onlyDetectedObjects}
                  onOnlyDetectedObjectsChange={setOnlyDetectedObjects}
                />
              </Popover>

              <RefreshButton
                aria-label={t('events.refresh')}
                data-testid="events-refresh-button"
              />
            </div>
          </div>
          {effectiveViewMode === 'montage' && gridControls.isScreenTooSmall && (
            <p className="text-xs text-destructive">{t('eventMontage.screen_too_small')}</p>
          )}

          {/* Per-profile error strips + All-mode server filter chips */}
          <EventsAllModeBar
            profiles={scope?.profiles ?? []}
            visibleErrors={visibleErrors}
            onRetryProfile={refetchProfile}
            serverFilter={settings.eventsServerFilter ?? null}
            onServerFilterChange={(next) => {
              if (currentProfileId) updateSettings(currentProfileId, { eventsServerFilter: next });
            }}
          />

          {/* Quick Date Range Buttons */}
          <div className="flex items-center gap-3">
            <QuickDateRangeButtons
              activeHours={activeQuickRange}
              onRangeSelect={({ start, end, hours }) => {
                const startInput = formatLocalDateTime(start);
                const endInput = formatLocalDateTime(end);
                setStartDateInput(startInput);
                setEndDateInput(endInput);
                setActiveQuickRange(hours);
                // Pass the new range explicitly: applyFilters still closes over the
                // pre-click date state, and the URL-readback effect would otherwise
                // reapply the previous window (refs #193).
                applyFilters({ startDateTime: startInput, endDateTime: endInput });
              }}
            />
            {/* Shows for any active date range, not only a quick-range chip, so a date
                range that arrived via URL (e.g. a monitor card's Events link) can also
                be cleared without losing the rest of the filter set (refs #239). The
                testid stays events-clear-quick-range: existing e2e steps depend on it. */}
            {(activeQuickRange !== null || startDateInput || endDateInput) && (
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground h-7 w-7"
                onClick={clearDateRange}
                title={t('common.clear')}
                data-testid="events-clear-quick-range"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Event Heatmap */}
        {heatmapDateRange && (
          <EventHeatmap
            events={allEvents}
            startDate={heatmapDateRange.startDate}
            endDate={heatmapDateRange.endDate}
            onTimeRangeClick={(startDateTime, endDateTime) => {
              setStartDateInput(formatLocalDateTime(new Date(startDateTime)));
              setEndDateInput(formatLocalDateTime(new Date(endDateTime)));
              applyFilters();
            }}
          />
        )}

        {/* Events List or Montage View */}
        {allEvents.length === 0 ? (
          <div data-testid={allFailed ? 'events-all-failed-state' : 'events-empty-state'}>
            <EmptyState
              icon={Clock}
              title={t(allFailed ? 'events.all_failed_title' : 'events.no_events')}
              action={
                filters.monitorId || filters.startDateTime || filters.endDateTime
                  ? {
                      label: t('events.clear_filters'),
                      onClick: clearFilters,
                      variant: 'link',
                    }
                  : undefined
              }
            />
          </div>
        ) : effectiveViewMode === 'montage' ? (
          <EventMontageView
            events={allEvents}
            monitors={eventListMonitors}
            gridCols={gridControls.gridCols}
            thumbnailFit={normalizedThumbnailFit}
            portalUrl={currentProfile?.portalUrl || ''}
            accessToken={isAccessTokenFresh ? accessToken ?? undefined : undefined}
            batchSize={batchSize}
            totalCount={totalCount}
            isFetching={isFetching}
            onLoadMore={loadNextPage}
            eventTagMap={eventTagMap}
            eventFilters={serverFilters}
            minStreamingPort={resolveMinStreamingPort(currentProfile?.minStreamingPort, settings.forceDisableMultiPort)}
          />
        ) : (
          <EventListView
            events={allEvents}
            monitors={eventListMonitors}
            thumbnailFit={normalizedThumbnailFit}
            portalUrl={currentProfile?.portalUrl || ''}
            accessToken={isAccessTokenFresh ? accessToken ?? undefined : undefined}
            batchSize={batchSize}
            totalCount={totalCount}
            isFetching={isFetching}
            onLoadMore={loadNextPage}
            eventTagMap={eventTagMap}
            eventFilters={serverFilters}
            minStreamingPort={resolveMinStreamingPort(currentProfile?.minStreamingPort, settings.forceDisableMultiPort)}
          />
        )}
      </div>
    </>
  );
}
