/**
 * Montage Page
 *
 * Displays a customizable grid of live monitor streams.
 * Supports drag-and-drop layout, resizing, and fullscreen mode.
 */

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/query/query-keys';
import { getMonitors } from '../api/monitors';
import { GRID_LAYOUT } from '../lib/zmninja-ng-constants';
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { useBandwidthSettings } from '../hooks/useBandwidthSettings';
import { useMonitorNewEvents } from '../hooks/useMonitorNewEvents';
import { useAuthSlice } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTvKeyHandler } from '../hooks/useTvKeyHandler';
import { useTvMode } from '../hooks/useTvMode';
import { Button } from '../components/ui/button';
import { MontageMonitor } from '../components/monitors/MontageMonitor';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Video, Maximize, Pencil, ArrowLeftRight } from 'lucide-react';
import { RefreshButton } from '../components/common/RefreshButton';
import { AnalysisFramesToggle } from '../components/monitors/AnalysisFramesToggle';
import { ErrorBanner } from '../components/ui/query-state';
import { resolveQueryError } from '../lib/query/query-error';
import { EmptyState } from '../components/ui/empty-state';
import { filterEnabledMonitors, filterMonitorsByGroup } from '../lib/monitor/filters';
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
import { internalColsForCols } from '../components/montage/hooks/useMontageGrid';

const WrappedGridLayout = WidthProvider(GridLayout);

export default function Montage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const bandwidth = useBandwidthSettings();
  const { currentProfile, settings } = useCurrentProfile();
  const authSlice = useAuthSlice(currentProfile?.id ?? null);
  const accessToken = authSlice.accessToken;
  const isAuthenticated = authSlice.isAuthenticated;

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.monitors(currentProfile?.id),
    queryFn: () => getMonitors(),
    enabled: !!currentProfile && isAuthenticated,
    refetchInterval: bandwidth.monitorStatusInterval,
  });
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

  // Show enabled monitors only, filtered by group if active
  const enabledMonitors = useMemo(
    () => (data?.monitors ? filterEnabledMonitors(data.monitors) : []),
    [data]
  );

  const hiddenSet = useMemo(
    () => new Set(bucket.hiddenMonitorIds),
    [bucket.hiddenMonitorIds]
  );

  const monitors = useMemo(() => {
    let list = enabledMonitors;
    // When a group filter is active, show only its monitors. An empty id list
    // means the group resolved to nothing (or groups have not loaded yet), so
    // render none rather than falling back to streaming every monitor.
    if (isFilterActive) {
      list = filteredMonitorIds.length > 0
        ? filterMonitorsByGroup(list, filteredMonitorIds)
        : [];
    }
    if (hiddenSet.size > 0) list = list.filter((m) => !hiddenSet.has(m.Monitor.Id));
    return list;
  }, [enabledMonitors, isFilterActive, filteredMonitorIds, hiddenSet]);

  const monitorIds = useMemo(() => monitors.map(({ Monitor }) => Monitor.Id), [monitors]);
  const { counts: newEventCounts, newest: newestEventAt } = useMonitorNewEvents(monitorIds);

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
    monitors,
    currentProfile,
    settings,
    isEditMode,
    groupKey,
  });

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
        const total = monitors.length;
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
    [monitors.length, estimatedCols]
  );

  const handleDpadEnter = useCallback(() => {
    const mon = monitors[focusedMonitorIndex];
    if (mon) {
      navigate(`/monitors/${mon.Monitor.Id}`, { state: { from: '/montage' } });
    }
  }, [monitors, focusedMonitorIndex, navigate]);

  useTvKeyHandler({
    ArrowLeft: () => handleDpadNav('left'),
    ArrowRight: () => handleDpadNav('right'),
    ArrowUp: () => handleDpadNav('up'),
    ArrowDown: () => handleDpadNav('down'),
    Enter: handleDpadEnter,
  });

  // Focus the monitor element when index changes in TV mode
  useEffect(() => {
    if (!isTvMode || monitors.length === 0) return;
    const el = document.querySelector(
      `[data-testid="montage-monitor-${monitors[focusedMonitorIndex]?.Monitor.Id}"]`
    ) as HTMLElement | null;
    el?.focus();
  }, [isTvMode, focusedMonitorIndex, monitors]);

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
  // frame before the group narrows would open every stream.
  if (isLoading || !isFilterReady) {
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

  // Error state. A background refetch error while cached monitors are
  // already loaded falls through to the normal grid below instead of this
  // error wall; the OfflineBanner in AppLayout covers that case. Only a cold
  // start with no cached data hits the error wall.
  if (error && !data) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-bold tracking-tight">{t('montage.title')}</h1>
        </div>
        <ErrorBanner message={resolveQueryError(error, t)} />
      </div>
    );
  }

  // Empty state
  if (monitors.length === 0) {
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
              <GroupFilterSelect />
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
                monitors={enabledMonitors.map((m) => m.Monitor)}
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
            <WrappedGridLayout
              layout={layout}
              cols={internalColsForCols(gridCols)}
              rowHeight={GRID_LAYOUT.montageRowHeight}
              margin={[0, 0]}
              containerPadding={[0, 0]}
              compactType="vertical"
              preventCollision={false}
              isResizable={isEditMode}
              isDraggable={isEditMode}
              resizeHandles={['se', 'sw', 'ne', 'nw']}
              draggableCancel=".pin-locked,.no-drag"
              onLayoutChange={handleLayoutChange}
              onDragStop={handleDragStop}
              onResizeStop={handleResizeStop}
            >
              {monitors.map(({ Monitor, Monitor_Status }, idx) => (
                <div
                  key={Monitor.Id}
                  className={cn(
                    "relative focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    isMonitorPinned(Monitor.Id) && "pin-locked",
                    isTvMode && idx === focusedMonitorIndex && "ring-2 ring-primary"
                  )}
                  role="button"
                  aria-label={Monitor.Name}
                  data-testid={`montage-monitor-${Monitor.Id}`}
                  tabIndex={isEditMode ? -1 : 0}
                  onClick={() => !isEditMode && navigate(`/monitors/${Monitor.Id}`, { state: { from: '/montage' } })}
                  onKeyDown={handleKeyClick}
                >
                  <MontageTileErrorBoundary monitorId={Monitor.Id} monitorName={Monitor.Name}>
                    <MontageMonitor
                      monitor={Monitor}
                      status={Monitor_Status}
                      currentProfile={currentProfile}
                      accessToken={accessToken}
                      navigate={navigate}
                      isFullscreen={isFullscreen}
                      isEditing={isEditMode}
                      isPinned={isMonitorPinned(Monitor.Id)}
                      onPinToggle={() => togglePinMonitor(Monitor.Id)}
                      objectFit={settings.montageFeedFit}
                      showOverlay={showMonitorLabels}
                      newEventCount={newEventCounts[Monitor.Id]}
                      newestEventAt={newestEventAt[Monitor.Id]}
                    />
                  </MontageTileErrorBoundary>
                </div>
              ))}
            </WrappedGridLayout>
          </div>
        </div>
      </div>

      {isEditMode && !isFullscreen && <MontageScrollPad targetRef={scrollContainerRef} />}
    </div>
  );
}
