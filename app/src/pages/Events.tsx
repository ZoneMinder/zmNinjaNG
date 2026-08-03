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
import { eventInstant } from '../lib/event/event-instant';
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
  // favoritesOnly resolves to each profile's OWN favorites now (useScopedEvents,
  // refs #337 I7), so this key can no longer carry the resolved id list -
  // a sentinel that flips with the toggle is enough to reset pagination.
  const paginationKey = useMemo(
    () => JSON.stringify(
      queryKeys.eventsList(currentProfile?.id, filters, 0, effectiveMonitorId, isGroupFilterActive, favoritesOnly ? ['__favorites__'] : undefined, tagIdFilter)
    ),
    [currentProfile?.id, filters, effectiveMonitorId, isGroupFilterActive, favoritesOnly, tagIdFilter]
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
    totalCountByProfile,
    refetchProfile,
    refetchAll,
  } = useScopedEvents({
    filters,
    limit: eventLimit,
    monitorId: effectiveMonitorId,
    isGroupFilterActive,
    favoritesOnly,
    tagIds: tagIdFilter,
  });

  // A deep link from a monitor card / event detail / recent-events row in
  // All mode carries `?profileId=` alongside `monitorId` (refs #337): those
  // callers know which server the monitor id belongs to, so focus the
  // server filter down to just that profile instead of leaving the numeric
  // monitorId ambiguous across every server in scope. Transient: overlays
  // the persisted filter for this render only rather than writing it via
  // updateSettings, so one tap can't permanently narrow the user's saved
  // All-mode filter - navigating away (or clearing the param) reverts to
  // whatever was persisted before the link was opened (refs #337 I9).
  const deepLinkedProfileId = isAllMode ? searchParams.get('profileId') : null;
  // Reconciled here rather than in mergeProfileSettings (the Settings contract's
  // usual coercion spot): that merge is a pure function with no access to the
  // live profiles list - stores/settings.ts importing stores/profile.ts to get
  // one would cycle back through profile.ts's own useSettingsStore import.
  // Without this, a deleted profile's id lingers in the persisted filter
  // forever; if it was the ONLY id left, "no filter" silently became "hide
  // every real profile" the moment that profile was deleted (refs #337).
  const effectiveServerFilter = useMemo(() => {
    if (deepLinkedProfileId) return [deepLinkedProfileId as ProfileId];
    if (!settings.eventsServerFilter) return null;
    const liveIds = new Set((scope?.profiles ?? []).map((p) => p.id));
    const reconciled = settings.eventsServerFilter.filter((id) => liveIds.has(id));
    // Every persisted id named a since-deleted profile: fall back to "no
    // filter" instead of an effective list that hides every real profile.
    // An already-empty persisted list (user deselected every server) stays
    // empty - that is the deliberate hide-everything state.
    if (reconciled.length === 0 && settings.eventsServerFilter.length > 0) return null;
    return reconciled;
  }, [deepLinkedProfileId, settings.eventsServerFilter, scope?.profiles]);

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
    if (!isAllMode || !effectiveServerFilter) return scopedEvents;
    const included = new Set(effectiveServerFilter);
    return scopedEvents.filter((e) => included.has(e.profileId));
  }, [isAllMode, effectiveServerFilter, scopedEvents]);

  // "Showing X of Y": Y must match the server filter, not every profile in
  // scope - totalCount (from useScopedEvents) sums ALL of them regardless,
  // so a narrowed filter otherwise reported a Y the filtered list could never
  // reach (refs #337).
  const filteredTotalCount = useMemo(() => {
    if (!isAllMode || !effectiveServerFilter) return totalCount;
    return effectiveServerFilter.reduce((sum, id) => sum + (totalCountByProfile[id] ?? 0), 0);
  }, [isAllMode, effectiveServerFilter, totalCountByProfile, totalCount]);

  // Deselecting every server (an explicit empty filter, distinct from null's
  // "every profile") leaves zero events for a reason unrelated to the date/
  // monitor/tag filters below - the plain "no events" empty state (with its
  // "clear filters" action) doesn't explain it, so this gets its own hint.
  const serverFilterHidesEverything = isAllMode && effectiveServerFilter !== null && effectiveServerFilter.length === 0;

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

  // allEvents tagged with the OWNING profile's timezone, for EventHeatmap's
  // real-instant bucketing (eventInstant) instead of a naive local Date
  // parse - required once All mode can merge events from more than one
  // profile/timezone (refs #337). Single mode: one profile, one timezone.
  const tzById = useMemo(
    () => new Map((scope?.profiles ?? []).map((p) => [p.id, p.timezone ?? 'UTC'])),
    [scope]
  );
  const heatmapEvents = useMemo(
    () =>
      allEvents.map((item) => ({
        item,
        timezone: item.profileId ? (tzById.get(item.profileId) ?? 'UTC') : (currentProfile?.timezone ?? 'UTC'),
      })),
    [allEvents, tzById, currentProfile]
  );

  // Date range shown on the heatmap: explicit filters win, otherwise infer
  // the span from the loaded events. Derived from heatmapEvents' real
  // instants (eventInstant), not a naive local Date parse: the buckets
  // below already use real instants, so a naively-derived window can fall
  // short of them and silently drop events the buckets would otherwise show
  // (refs #337 - the other half of the timezone-bucket fix).
  const heatmapDateRange = useMemo(() => {
    if (heatmapEvents.length === 0) return null;

    if (filters.startDateTime && filters.endDateTime) {
      return { startDate: new Date(filters.startDateTime), endDate: new Date(filters.endDateTime) };
    }

    const eventDates = heatmapEvents.map(({ item, timezone }) => new Date(eventInstant(item, timezone)));
    return {
      startDate: new Date(Math.min(...eventDates.map((d) => d.getTime()))),
      endDate: new Date(Math.max(...eventDates.map((d) => d.getTime()))),
    };
  }, [heatmapEvents, filters.startDateTime, filters.endDateTime]);

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

  // Transient, same as the profileId deep link above: a `?view=montage` tap
  // switches THIS view only, never the persisted preference (refs #337 I9).
  useEffect(() => {
    const paramView = searchParams.get('view');
    if (paramView !== 'montage') return;
    setViewMode('montage');
  }, [searchParams]);

  useEffect(() => {
    if (!currentProfileId) return;
    // Skip while a `?view=montage` deep link is active (refs #337 round 2):
    // this effect and the deep-link effect above both fire on the same
    // mount, and without this guard this one's setViewMode(settings.
    // eventsViewMode) runs after the deep link's and wins, silently
    // reverting a single-mode montage deep link back to the persisted
    // (usually 'list') preference.
    if (searchParams.get('view') === 'montage') return;
    setViewMode(settings.eventsViewMode);
    gridControls.setGridCols(eventCols);
    gridControls.setCustomCols(eventCols.toString());
  }, [currentProfileId, settings.eventsViewMode, groupKey, eventCols, searchParams]);

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
              <Button
                variant="outline"
                size="icon"
                onClick={() => handleViewModeChange(viewMode === 'list' ? 'montage' : 'list')}
                title={viewMode === 'list' ? t('events.view_montage') : t('events.view_list')}
                aria-label={viewMode === 'list' ? t('events.view_montage') : t('events.view_list')}
                data-testid="events-view-toggle"
              >
                {viewMode === 'list' ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}
              </Button>
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
              {viewMode === 'montage' && (
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
          {viewMode === 'montage' && gridControls.isScreenTooSmall && (
            <p className="text-xs text-destructive">{t('eventMontage.screen_too_small')}</p>
          )}

          {/* Per-profile error strips + All-mode server filter chips */}
          <EventsAllModeBar
            profiles={scope?.profiles ?? []}
            visibleErrors={visibleErrors}
            onRetryProfile={refetchProfile}
            serverFilter={effectiveServerFilter ?? null}
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
            events={heatmapEvents}
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
          serverFilterHidesEverything ? (
            <div data-testid="events-filter-empty-hint">
              <EmptyState
                icon={Clock}
                title={t('events.filter_hides_everything')}
                action={{
                  label: t('events.show_all_servers'),
                  onClick: () => {
                    if (currentProfileId) updateSettings(currentProfileId, { eventsServerFilter: null });
                  },
                  variant: 'link',
                }}
              />
            </div>
          ) : (
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
          )
        ) : viewMode === 'montage' ? (
          <EventMontageView
            events={allEvents}
            monitors={eventListMonitors}
            gridCols={gridControls.gridCols}
            thumbnailFit={normalizedThumbnailFit}
            portalUrl={currentProfile?.portalUrl || ''}
            accessToken={isAccessTokenFresh ? accessToken ?? undefined : undefined}
            batchSize={batchSize}
            totalCount={filteredTotalCount}
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
            totalCount={filteredTotalCount}
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
