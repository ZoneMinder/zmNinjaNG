/**
 * Montage Page
 *
 * Displays a customizable grid of live monitor streams.
 * Supports drag-and-drop layout, resizing, and fullscreen mode.
 */

import { GRID_LAYOUT, MONTAGE_GRID } from '../lib/zmninja-ng-constants';
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { useProfileScope } from '../hooks/useProfileScope';
import { useScopedMonitors } from '../hooks/useScopedMonitors';
import { useMonitorNewEvents, useScopedMonitorNewEvents, scopedMonitorEventKey } from '../hooks/useMonitorNewEvents';
import { useAuthSlice } from '../stores/auth';
import { useProfileStore } from '../stores/profile';
import { useSettingsStore } from '../stores/settings';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTvKeyHandler } from '../hooks/useTvKeyHandler';
import { useTvMode } from '../hooks/useTvMode';
import { Button } from '../components/ui/button';
import { MontageMonitor } from '../components/monitors/MontageMonitor';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Video, Maximize, Pencil, ArrowLeftRight, Layers } from 'lucide-react';
import { RefreshButton } from '../components/common/RefreshButton';
import { AnalysisFramesToggle } from '../components/monitors/AnalysisFramesToggle';
import { ErrorBanner } from '../components/ui/query-state';
import { resolveQueryError } from '../lib/query/query-error';
import { EmptyState } from '../components/ui/empty-state';
import { filterMonitorsByGroup } from '../lib/monitor/filters';
import { useGroupFilter } from '../hooks/useGroupFilter';
import { useMontageGroupState } from '../hooks/useMontageGroupState';
import { GroupFilterSelect } from '../components/filters/GroupFilterSelect';
import { cn } from '../lib/utils';
import { handleKeyClick } from '../lib/tv/tv-a11y';
import { useTranslation } from 'react-i18next';
import { usePinchZoom } from '../hooks/usePinchZoom';
import { useInsomnia } from '../hooks/useInsomnia';
import { NotificationBadge } from '../components/NotificationBadge';
import GridLayout, { WidthProvider } from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';
import type { MonitorData, ProfileId } from '../api/types';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

// Extracted hooks and components
import {
  GridLayoutControls,
  FullscreenControls,
  MontageKebabMenu,
  MontageTileErrorBoundary,
  MontageScrollPad,
  useMontageGrid,
  useContainerResize,
} from '../components/montage';
import { useFullscreenMode } from '../hooks/useFullscreenMode';
import { internalColsForCols, tileIdFor, type MontageTileMonitorData } from '../components/montage/hooks/useMontageGrid';

/** One montage tile's render data. profileId/profileChip are set only in
 *  All mode (see useScopedMonitors), mirroring Monitors.tsx's MonitorGridItem. */
interface MontageTileItem extends MontageTileMonitorData {
  profileChip?: string;
}

const WrappedGridLayout = WidthProvider(GridLayout);

export default function Montage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { currentProfile, settings, isAllMode } = useCurrentProfile();
  const authSlice = useAuthSlice(currentProfile?.id ?? null);
  const accessToken = authSlice.accessToken;
  // Settings-update target: the real profile id in single mode, the ALL
  // bucket sentinel in All mode (currentProfile stays null there) - same
  // resolution Monitors.tsx uses for its server-grouping toggle.
  const currentProfileId = useProfileStore((state) => state.currentProfileId);

  const scope = useProfileScope();
  // Owning-profile lookup for All-mode tiles: MontageMonitor needs the real
  // Profile object (zmVersion, settings, go2rtcUrl all key off its id), not
  // just the id useScopedMonitors tags each tile with.
  const profilesById = useMemo(
    () => new Map((scope?.profiles ?? []).map((p) => [p.id, p])),
    [scope]
  );

  // Single code path for both modes, same as Monitors.tsx: one profile in
  // single mode, N in All mode, sharing useMonitors' queryKeys.monitors(id)
  // cache entry. Already filters to enabled monitors (refs #337).
  const {
    monitors: scopedMonitors,
    errors: profileErrors,
    isLoading: scopedLoading,
    refetchProfile,
  } = useScopedMonitors();

  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);
  const updateMontageGroupLayout = useSettingsStore((state) => state.updateMontageGroupLayout);
  const { isFilterActive, filteredMonitorIds, isFilterReady } = useGroupFilter();
  const { groupKey, bucket } = useMontageGroupState();

  // Keep screen awake when Insomnia is enabled
  useInsomnia({ enabled: settings.insomnia });

  // Detect mobile viewport
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const hiddenSet = useMemo(
    () => new Set(bucket.hiddenMonitorIds),
    [bucket.hiddenMonitorIds]
  );

  // Raw per-profile monitor counts, independent of any filter/cap below:
  // decides whether a profile's error strip shows (a profile filtered/capped
  // to zero tiles still "has data"), mirroring Monitors.tsx.
  const monitorCountByProfile = useMemo(() => {
    const counts = new Map<ProfileId, number>();
    for (const s of scopedMonitors) {
      counts.set(s.profileId, (counts.get(s.profileId) ?? 0) + 1);
    }
    return counts;
  }, [scopedMonitors]);

  const monitors = useMemo((): MontageTileItem[] => {
    if (isAllMode) {
      // Group filter is current-profile-scoped (Monitors.tsx precedent) - All
      // mode skips it until it is extended across servers.
      return scopedMonitors.map((s) => ({
        Monitor: s.item.Monitor,
        Monitor_Status: s.item.Monitor_Status,
        profileId: s.profileId,
        profileChip: s.profileName,
      }));
    }
    let list: MonitorData[] = scopedMonitors.map((s) => ({ Monitor: s.item.Monitor, Monitor_Status: s.item.Monitor_Status }));
    // When a group filter is active, show only its monitors. An empty id list
    // means the group resolved to nothing (or groups have not loaded yet), so
    // render none rather than falling back to streaming every monitor.
    if (isFilterActive) {
      list = filteredMonitorIds.length > 0
        ? filterMonitorsByGroup(list, filteredMonitorIds)
        : [];
    }
    return list;
  }, [isAllMode, scopedMonitors, isFilterActive, filteredMonitorIds]);

  const visibleMonitors = useMemo(
    () => (hiddenSet.size > 0 ? monitors.filter((m) => !hiddenSet.has(m.Monitor.Id)) : monitors),
    [monitors, hiddenSet]
  );

  // Stream cap (refs #337, Phase 4 Task 1): All mode only - single mode stays
  // unlimited (byte-identical). Without it, N profiles each contributing every
  // enabled monitor could open dozens of simultaneous streams across
  // independent servers at once. useScopedMonitors already orders entries
  // profile-then-server, so the first N is deterministic.
  const overflowCount = isAllMode && visibleMonitors.length > MONTAGE_GRID.allModeMaxStreams
    ? visibleMonitors.length - MONTAGE_GRID.allModeMaxStreams
    : 0;
  const cappedMonitors = overflowCount > 0
    ? visibleMonitors.slice(0, MONTAGE_GRID.allModeMaxStreams)
    : visibleMonitors;

  // useMonitorNewEvents stays current-profile-scoped for single mode; All mode
  // fans the equivalent query out per owning profile (Monitors.tsx precedent).
  const monitorIds = useMemo(
    () => (isAllMode ? [] : cappedMonitors.map(({ Monitor }) => Monitor.Id)),
    [isAllMode, cappedMonitors]
  );
  const { counts: newEventCounts, newest: newestEventAt } = useMonitorNewEvents(monitorIds);

  const scopedMonitorRefs = useMemo(
    () =>
      isAllMode
        ? cappedMonitors
            .filter((item): item is MontageTileItem & { profileId: ProfileId } => item.profileId !== undefined)
            .map(({ Monitor, profileId }) => ({ profileId, monitorId: Monitor.Id }))
        : [],
    [isAllMode, cappedMonitors]
  );
  const { counts: scopedNewEventCounts, newest: scopedNewestEventAt } =
    useScopedMonitorNewEvents(scopedMonitorRefs);

  // Edit mode state lifted to page level
  const [isEditMode, setIsEditMode] = useState(false);

  // Active saved layout name (persisted in settings)
  const activeLayoutName = bucket.activeLayoutName;

  // Monitor label overlay toggle for fullscreen mode
  const [showMonitorLabels, setShowMonitorLabels] = useState(false);

  // Toolbar visibility (controlled from app header eye button)
  const showToolbar = settings.montageShowToolbar;

  // Fullscreen mode
  const { isFullscreen, handleToggleFullscreen } =
    useFullscreenMode({
      currentProfile,
      settings,
      settingKey: 'montageIsFullscreen',
    });


  // Grid layout management
  const {
    layout,
    gridCols,
    currentWidthRef,
    handleApplyGridLayout,
    handleLoadSavedLayout,
    handleLayoutChange,
    handleDragStop,
    handleFillWidth,
    handleResizeStop,
    handleWidthChange,
    togglePinMonitor,
    isMonitorPinned,
  } = useMontageGrid({
    monitors: cappedMonitors,
    currentProfile,
    settings,
    isEditMode,
    groupKey,
  });

  // layout is one flat array covering every tile (single WrappedGridLayout in
  // the ungrouped case); grouped rendering (below) slices it per profile so
  // each server gets its own independent grid region. x stays within
  // internalColsForCols(gridCols) regardless of subset size, so a section's
  // own vertical compaction is all that changes per instance.
  const layoutByTileId = useMemo(
    () => new Map(layout.map((item) => [item.i, item])),
    [layout]
  );
  const globalIndexByTileId = useMemo(() => {
    const map = new Map<string, number>();
    cappedMonitors.forEach((item, i) => map.set(tileIdFor(item), i));
    return map;
  }, [cappedMonitors]);

  // Container resize observation
  const { containerRef } = useContainerResize({
    onWidthChange: handleWidthChange,
    currentWidthRef,
  });

  // The same element also scrolls, and the scroll pad needs to reach it.
  // Composed in a stable callback so the resize observer is not torn down and
  // re-attached on every render.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const setScrollContainer = useCallback(
    (element: HTMLDivElement | null) => {
      scrollContainerRef.current = element;
      containerRef(element);
    },
    [containerRef]
  );

  // TV mode D-pad grid navigation
  const { isTvMode } = useTvMode();
  const [focusedMonitorIndex, setFocusedMonitorIndex] = useState(0);

  // Estimate columns from gridCols (display columns)
  const estimatedCols = gridCols;

  const handleDpadNav = useCallback(
    (direction: 'left' | 'right' | 'up' | 'down') => {
      setFocusedMonitorIndex((prev) => {
        const total = cappedMonitors.length;
        if (total === 0) return 0;
        let next = prev;
        switch (direction) {
          case 'left':
            next = prev - 1;
            break;
          case 'right':
            next = prev + 1;
            break;
          case 'up':
            next = prev - estimatedCols;
            break;
          case 'down':
            next = prev + estimatedCols;
            break;
        }
        return Math.max(0, Math.min(total - 1, next));
      });
    },
    [cappedMonitors.length, estimatedCols]
  );

  const handleDpadEnter = useCallback(() => {
    const mon = cappedMonitors[focusedMonitorIndex];
    if (mon) {
      navigate(
        mon.profileId ? `/all/monitors/${mon.profileId}/${mon.Monitor.Id}` : `/monitors/${mon.Monitor.Id}`,
        { state: { from: '/montage' } }
      );
    }
  }, [cappedMonitors, focusedMonitorIndex, navigate]);

  useTvKeyHandler({
    ArrowLeft: () => handleDpadNav('left'),
    ArrowRight: () => handleDpadNav('right'),
    ArrowUp: () => handleDpadNav('up'),
    ArrowDown: () => handleDpadNav('down'),
    Enter: handleDpadEnter,
  });

  // Focus the monitor element when index changes in TV mode
  useEffect(() => {
    if (!isTvMode || cappedMonitors.length === 0) return;
    const focused = cappedMonitors[focusedMonitorIndex];
    if (!focused) return;
    const el = document.querySelector(
      `[data-testid="montage-monitor-${tileIdFor(focused)}"]`
    ) as HTMLElement | null;
    el?.focus();
  }, [isTvMode, focusedMonitorIndex, cappedMonitors]);

  // Pinch-to-zoom (disabled in fullscreen to avoid gesture conflicts)
  const pinchZoom = usePinchZoom({
    minScale: 0.5,
    maxScale: 3,
    initialScale: 1,
    enabled: !isFullscreen,
  });

  const handleApplyGridLayoutWithClear = (cols: number) => {
    handleApplyGridLayout(cols);
    if (currentProfile) {
      updateMontageGroupLayout(currentProfile.id, groupKey, { activeLayoutName: null });
    }
  };

  const handleFeedFitChange = (value: string) => {
    if (!currentProfile) return;
    updateSettings(currentProfile.id, {
      montageFeedFit: value as typeof settings.montageFeedFit,
    });
  };

  // Saved layout handlers
  const handleSaveLayout = (name: string) => {
    if (!currentProfile) return;
    const entry = { name, layout: [...layout], displayCols: gridCols };
    updateMontageGroupLayout(currentProfile.id, groupKey, {
      savedLayouts: [...bucket.savedLayouts, entry],
      activeLayoutName: name,
    });
  };

  const handleLoadLayout = (saved: { name: string; layout: Layout[]; displayCols: number }) => {
    handleLoadSavedLayout(saved.layout, saved.displayCols);
    if (currentProfile) {
      updateMontageGroupLayout(currentProfile.id, groupKey, { activeLayoutName: saved.name });
    }
  };

  const handleDeleteLayout = (index: number) => {
    if (!currentProfile) return;
    const saved = [...bucket.savedLayouts];
    saved.splice(index, 1);
    updateMontageGroupLayout(currentProfile.id, groupKey, { savedLayouts: saved });
  };

  const handleToggleMonitorVisibility = useCallback(
    (id: string) => {
      if (!currentProfile) return;
      const current = bucket.hiddenMonitorIds;
      const next = current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id];
      updateMontageGroupLayout(currentProfile.id, groupKey, { hiddenMonitorIds: next });
    },
    [currentProfile, bucket.hiddenMonitorIds, groupKey, updateMontageGroupLayout]
  );

  const handleEditModeToggle = () => {
    setIsEditMode((prev) => !prev);
  };

  // Loading state. Also wait until the group filter has resolved (isFilterReady)
  // so we never mount monitor tiles against an unresolved group membership.
  // Mounting a tile starts its stream, so rendering all monitors for even one
  // frame before the group narrows would open every stream. isLoading never
  // clears on its own once any profile has errored (see useScopedMonitors),
  // so a profile that errored still falls through to the states below instead
  // of spinning forever (refs #337, Monitors.tsx Task 4 finding).
  const stillWaiting = scopedLoading && profileErrors.length === 0;
  if (stillWaiting || (!isAllMode && !isFilterReady)) {
    return (
      <div className="p-8 space-y-6">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="aspect-video bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // Single mode only: byte-identical to the pre-existing cold-start error
  // wall. scopedLoading only stays true until the (one, in single mode)
  // profile's monitors query has ever produced data - the same condition the
  // old `!data` check captured. All mode gets per-profile strips below
  // instead, added underneath the grid rather than replacing it, since one
  // failed server should not hide every other server's healthy tiles.
  if (!isAllMode && profileErrors.length > 0 && scopedLoading) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-bold tracking-tight">{t('montage.title')}</h1>
        </div>
        <ErrorBanner message={resolveQueryError(profileErrors[0].error, t)} />
      </div>
    );
  }

  // Empty state
  if (cappedMonitors.length === 0) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-bold tracking-tight">{t('montage.title')}</h1>
          <RefreshButton size="sm" />
        </div>
        <EmptyState icon={Video} title={t('montage.no_monitors')} />
      </div>
    );
  }

  // Per-profile errors, All mode only (single mode keeps the byte-identical
  // cold-start wall above and otherwise stays silent, same as before this
  // task - refs #337, Phase 4 Task 1). One strip per profile whose query
  // failed AND produced zero monitors; a profile with cached data and a
  // background refetch error renders that data with no strip, same
  // zero-data-suppression semantics as Monitors.tsx.
  const visibleErrors = isAllMode
    ? profileErrors.filter((err) => (monitorCountByProfile.get(err.profileId) ?? 0) === 0)
    : [];

  // Section cappedMonitors by owning server when the toggle is on. All mode
  // only - single mode never has more than one profile to group by.
  const groupedSections = isAllMode && settings.monitorsGroupByServer
    ? Array.from(
        cappedMonitors.reduce((byProfile, item) => {
          const key = item.profileId as ProfileId;
          const existing = byProfile.get(key);
          if (existing) {
            existing.items.push(item);
          } else {
            byProfile.set(key, { profileName: item.profileChip ?? '', items: [item] });
          }
          return byProfile;
        }, new Map<ProfileId, { profileName: string; items: MontageTileItem[] }>())
      )
    : null;

  const sharedGridLayoutProps = {
    cols: internalColsForCols(gridCols),
    rowHeight: GRID_LAYOUT.montageRowHeight,
    margin: [0, 0] as [number, number],
    containerPadding: [0, 0] as [number, number],
    compactType: 'vertical' as const,
    preventCollision: false,
    isResizable: isEditMode,
    isDraggable: isEditMode,
    resizeHandles: ['se', 'sw', 'ne', 'nw'] as Array<'s' | 'w' | 'e' | 'n' | 'sw' | 'nw' | 'se' | 'ne'>,
    draggableCancel: '.pin-locked,.no-drag',
    onLayoutChange: handleLayoutChange,
    onDragStop: handleDragStop,
    onResizeStop: handleResizeStop,
  };

  const renderTile = (item: MontageTileItem) => {
    const { Monitor, Monitor_Status, profileId, profileChip } = item;
    const tileId = tileIdFor(item);
    const idx = globalIndexByTileId.get(tileId) ?? -1;
    // The tile's owning profile: its own server in All mode, the page's
    // current profile in single mode (unchanged) - see MontageMonitor.
    const ownerProfile = profileId ? profilesById.get(profileId) ?? null : currentProfile;
    return (
      <div
        key={tileId}
        className={cn(
          "relative focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          isMonitorPinned(tileId) && "pin-locked",
          isTvMode && idx === focusedMonitorIndex && "ring-2 ring-primary"
        )}
        role="button"
        aria-label={Monitor.Name}
        data-testid={`montage-monitor-${tileId}`}
        tabIndex={isEditMode ? -1 : 0}
        onClick={() => !isEditMode && navigate(
          profileId ? `/all/monitors/${profileId}/${Monitor.Id}` : `/monitors/${Monitor.Id}`,
          { state: { from: '/montage' } }
        )}
        onKeyDown={handleKeyClick}
      >
        <MontageTileErrorBoundary monitorId={Monitor.Id} monitorName={Monitor.Name}>
          <MontageMonitor
            monitor={Monitor}
            status={Monitor_Status}
            currentProfile={ownerProfile}
            accessToken={accessToken}
            navigate={navigate}
            profileId={profileId}
            profileChip={profileChip}
            isFullscreen={isFullscreen}
            isEditing={isEditMode}
            isPinned={isMonitorPinned(tileId)}
            onPinToggle={() => togglePinMonitor(tileId)}
            objectFit={settings.montageFeedFit}
            showOverlay={showMonitorLabels}
            newEventCount={
              profileId
                ? scopedNewEventCounts[scopedMonitorEventKey(profileId, Monitor.Id)]
                : newEventCounts[Monitor.Id]
            }
            newestEventAt={
              profileId
                ? scopedNewestEventAt[scopedMonitorEventKey(profileId, Monitor.Id)]
                : newestEventAt[Monitor.Id]
            }
          />
        </MontageTileErrorBoundary>
      </div>
    );
  };

  return (
    <div
      className={cn(
        isFullscreen
          ? 'fixed inset-0 z-40 bg-black flex flex-col'
          : 'flex flex-col bg-background relative'
      )}
    >
      {/* Header - Hidden in fullscreen mode */}
      {!isFullscreen && (
        <>
          {/* Toolbar row - toggleable via eye button in app header */}
          {showToolbar && (
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap p-2 sm:p-3 border-b bg-card/50 backdrop-blur-sm shrink-0 z-10">
              {isAllMode ? (
                <Button
                  variant={settings.monitorsGroupByServer ? 'default' : 'outline'}
                  size="icon"
                  className="h-8 sm:h-9 w-8 sm:w-9"
                  aria-pressed={settings.monitorsGroupByServer}
                  title={t('monitors.group_by_server')}
                  aria-label={t('monitors.group_by_server')}
                  onClick={() => {
                    if (!currentProfileId) return;
                    // ALL bucket setting (currentProfile null in All mode) -
                    // reuses Monitors.tsx's server-grouping toggle rather than
                    // a new montage-only field (refs #337, Phase 4 Task 1).
                    updateSettings(currentProfileId, {
                      monitorsGroupByServer: !settings.monitorsGroupByServer,
                    });
                  }}
                  data-testid="montage-group-by-server"
                >
                  <Layers className="h-4 w-4" />
                </Button>
              ) : (
                <GroupFilterSelect />
              )}
              <GridLayoutControls
                isMobile={isMobile}
                gridCols={gridCols}
                activeLayoutName={activeLayoutName}
                onApplyGridLayout={handleApplyGridLayoutWithClear}
                savedLayouts={bucket.savedLayouts}
                onSaveLayout={handleSaveLayout}
                onLoadLayout={handleLoadLayout}
                onDeleteLayout={handleDeleteLayout}
              />
              <Select value={settings.montageFeedFit} onValueChange={handleFeedFitChange}>
                <SelectTrigger className="h-8 sm:h-9 w-[80px]" data-testid="montage-fit-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cover" data-testid="montage-fit-cover">
                    {t('montage.fit_crop')}
                  </SelectItem>
                  <SelectItem value="contain" data-testid="montage-fit-contain">
                    {t('montage.fit_fit')}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button
                onClick={handleEditModeToggle}
                variant={isEditMode ? 'default' : 'outline'}
                size="sm"
                className="h-8 sm:h-9"
                title={isEditMode ? t('montage.done_editing') : t('montage.edit_layout')}
                data-testid="montage-edit-toggle"
              >
                <Pencil className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">
                  {isEditMode ? t('montage.done_editing') : t('montage.edit_layout')}
                </span>
              </Button>
              {isEditMode && (
                <Button
                  onClick={handleFillWidth}
                  variant="outline"
                  size="sm"
                  className="h-8 sm:h-9"
                  title={t('montage.fill_width', 'Fill Width')}
                  data-testid="montage-fill-width"
                >
                  <ArrowLeftRight className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">{t('montage.fill_width', 'Fill')}</span>
                </Button>
              )}
              <AnalysisFramesToggle className="h-8 w-8 sm:h-9 sm:w-9" />
              <Button
                onClick={() => handleToggleFullscreen(true)}
                variant="default"
                size="sm"
                className="h-8 sm:h-9"
                title={t('montage.fullscreen')}
                data-testid="montage-fullscreen-button"
              >
                <Maximize className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">{t('montage.fullscreen')}</span>
              </Button>
              <RefreshButton size="sm" className="h-8 sm:h-9" data-testid="montage-refresh-button" />
              <MontageKebabMenu
                monitors={monitors.map((m) => m.Monitor)}
                hiddenMonitorIds={bucket.hiddenMonitorIds}
                onToggleVisibility={handleToggleMonitorVisibility}
              />
              <NotificationBadge />
            </div>
          )}
        </>
      )}

      {/* Fullscreen toolbar: always visible, thin, translucent */}
      {isFullscreen && (
        <FullscreenControls
          onExitFullscreen={() => handleToggleFullscreen(false)}
          showLabels={showMonitorLabels}
          onToggleLabels={() => setShowMonitorLabels((prev) => !prev)}
        />
      )}

      {/* Per-profile errors: All mode only, see visibleErrors above. */}
      {!isFullscreen && visibleErrors.length > 0 && (
        <div className="space-y-2 px-2 pt-2 sm:px-3">
          {visibleErrors.map((err) => (
            <div
              key={err.profileId}
              className="flex items-center gap-2"
              data-testid={`profile-error-strip-${err.profileId}`}
            >
              <ErrorBanner
                className="flex-1"
                message={`${err.profileName}: ${resolveQueryError(err.error, t, { fallbackKey: 'monitors.failed_to_load' })}`}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchProfile(err.profileId)}
                data-testid={`profile-error-strip-retry-${err.profileId}`}
              >
                {t('common.retry')}
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Grid Content */}
      <div
        ref={setScrollContainer}
        {...pinchZoom.bind()}
        className={cn(
          'flex-1 overflow-auto bg-muted/10',
          isFullscreen
            ? 'pt-[calc(2rem+var(--sai-top,env(safe-area-inset-top)))] overscroll-contain'
            : 'touch-pan-y'
        )}
      >
        <div
          style={{
            transform: `scale(${pinchZoom.scale})`,
            transformOrigin: 'top left',
            transition: pinchZoom.isPinching ? 'none' : 'transform 0.2s ease-out',
          }}
        >
          <div
            className={cn(
              'w-full',
              isFullscreen && 'pl-[var(--sai-left,env(safe-area-inset-left))] pr-[var(--sai-right,env(safe-area-inset-right))]'
            )}
            data-testid="montage-grid"
          >
            {groupedSections ? (
              <div className="space-y-6">
                {groupedSections.map(([sectionProfileId, section]) => {
                  const sectionLayout = section.items
                    .map((item) => layoutByTileId.get(tileIdFor(item)))
                    .filter((item): item is Layout => !!item);
                  return (
                    <div key={sectionProfileId}>
                      <h2
                        className="text-sm font-semibold text-muted-foreground mb-2 truncate px-1"
                        title={section.profileName}
                      >
                        {section.profileName}
                      </h2>
                      <WrappedGridLayout layout={sectionLayout} {...sharedGridLayoutProps}>
                        {section.items.map(renderTile)}
                      </WrappedGridLayout>
                    </div>
                  );
                })}
              </div>
            ) : (
              <WrappedGridLayout layout={layout} {...sharedGridLayoutProps}>
                {cappedMonitors.map(renderTile)}
              </WrappedGridLayout>
            )}
          </div>
          {overflowCount > 0 && (
            <p className="text-sm text-muted-foreground mt-3 px-1" data-testid="montage-stream-cap-overflow">
              {t('montage.stream_cap_overflow', { count: overflowCount })}
            </p>
          )}
        </div>
      </div>

      {isEditMode && !isFullscreen && <MontageScrollPad targetRef={scrollContainerRef} />}
    </div>
  );
}
