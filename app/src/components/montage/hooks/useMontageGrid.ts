/**
 * Hook for Montage grid layout management
 *
 * Uses a fixed 12-column internal grid. The user's "display columns" setting
 * (1–5) controls the default item width (12/displayCols). Items can be resized
 * to any width 1–12 for mixed sizes; vertical compaction reflows items.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { GRID_LAYOUT, MONTAGE_GRID } from '../../../lib/zmninja-ng-constants';
import { useSettingsStore, DEFAULT_MONTAGE_GROUP_LAYOUT } from '../../../stores/settings';
import { getMonitorAspectRatio } from '../../../lib/monitor/monitor-rotation';
import { monitorCacheKey } from '../../../stores/monitors';
import type { Layout } from 'react-grid-layout';
import type { Monitor, MonitorData, ProfileId } from '../../../api/types';
import type { Profile } from '../../../api/types';
import type { ProfileSettings } from '../../../stores/settings';

/** A montage tile's monitor data, plus its owning profile in All mode
 *  (undefined in single mode, where the tile id degrades to the bare
 *  monitor id via monitorCacheKey - single mode stays byte-identical). */
export type MontageTileMonitorData = MonitorData & { profileId?: ProfileId };

/** Tile identity used for layout tracking (react-grid-layout `i`) and the
 *  monitor lookup map. Two profiles on independent servers can share a raw
 *  monitor id, so All-mode tiles are keyed by profileId:monitorId instead
 *  (refs #337, Phase 4 Task 1). */
export const tileIdFor = (item: MontageTileMonitorData): string =>
  monitorCacheKey(item.profileId, item.Monitor.Id);

/**
 * Sub-units per display column. Re-exported from MONTAGE_GRID. Each default
 * tile is one column wide (COL_SUBDIVISION units); a tile can be resized down
 * to 1 unit (1/COL_SUBDIVISION of a column) for fine-grained arrangements.
 */
export const COL_SUBDIVISION = MONTAGE_GRID.colSubdivision;

/**
 * Total internal grid columns for a given display column count. The grid is
 * proportional to the selection so N columns always renders exactly N.
 */
export const internalColsForCols = (displayCols: number): number =>
  Math.max(1, Math.round(displayCols)) * COL_SUBDIVISION;

const parseAspectRatioValue = (monitor: Monitor): number => {
  const ratio = getMonitorAspectRatio(monitor.Width, monitor.Height, monitor.Orientation);

  if (!ratio) return 9 / 16;

  const match = ratio.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (!match) return 9 / 16;

  const width = Number(match[1]);
  const height = Number(match[2]);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 9 / 16;
  }

  return height / width;
};

const calculateHeightUnits = (
  monitorMap: Map<string, Monitor>,
  monitorId: string,
  widthUnits: number,
  gridWidth: number,
  margin: number,
  internalCols: number
): number => {
  const monitor = monitorMap.get(monitorId);
  if (!monitor) return 200;

  const aspectRatio = parseAspectRatioValue(monitor);
  const columnWidth = (gridWidth - margin * (internalCols - 1)) / internalCols;
  const itemWidth = columnWidth * widthUnits + margin * (widthUnits - 1);
  const videoPx = itemWidth * aspectRatio;
  const heightPx = videoPx + MONTAGE_GRID.cardHeaderHeightPx;
  const unit = (heightPx + margin) / (GRID_LAYOUT.montageRowHeight + margin);

  return Math.max(2, Math.ceil(unit));
};

/**
 * Detect layouts saved before the internal grid became proportional to the
 * column count (the old fixed 12-column grid, or the even older `w=1` format).
 * Those layouts must be rebuilt because a non-divisor column count (5, 7, 8, 9,
 * 10) rendered the wrong number of columns on the fixed grid (issue #220).
 *
 * The proportional grid for N columns spans `N * COL_SUBDIVISION` units, so for
 * 2+ columns a current layout has a rightmost edge beyond one subdivision block;
 * a layout whose rightmost edge fits within COL_SUBDIVISION is legacy. For a
 * single column the legacy and proportional spaces coincide, so nothing needs
 * migrating.
 */
export const isLegacyLayout = (stored: Layout[], displayCols: number): boolean => {
  if (stored.length === 0) return false;
  if (displayCols < 2) return false;
  const maxRight = Math.max(...stored.map((item) => item.x + item.w));
  return maxRight <= COL_SUBDIVISION;
};

const areLayoutsEqual = (a: Layout[], b: Layout[]): boolean => {
  if (a.length !== b.length) return false;
  const map = new Map(a.map((item) => [item.i, item]));
  for (const item of b) {
    const match = map.get(item.i);
    if (!match) return false;
    if (match.x !== item.x || match.y !== item.y || match.w !== item.w || match.h !== item.h) {
      return false;
    }
  }
  return true;
};

interface UseMontageGridOptions {
  monitors: MontageTileMonitorData[];
  currentProfile: Profile | null;
  settings: ProfileSettings;
  isEditMode: boolean;
  groupKey: string;
}

interface UseMontageGridReturn {
  layout: Layout[];
  gridCols: number;
  currentWidthRef: React.MutableRefObject<number>;
  handleApplyGridLayout: (cols: number) => void;
  handleLoadSavedLayout: (savedLayout: Layout[], displayCols: number) => void;
  handleLayoutChange: (nextLayout: Layout[]) => void;
  handleResizeStop: (layout: Layout[], oldItem: Layout, newItem: Layout) => void;
  handleWidthChange: (width: number) => void;
  handleDragStop: (layout: Layout[], oldItem: Layout, newItem: Layout) => void;
  handleFillWidth: () => void;
  togglePinMonitor: (monitorId: string) => void;
  isMonitorPinned: (monitorId: string) => boolean;
}

export function useMontageGrid({
  monitors,
  currentProfile,
  settings,
  isEditMode,
  groupKey,
}: UseMontageGridOptions): UseMontageGridReturn {
  const { t } = useTranslation();
  const updateMontageGroupLayout = useSettingsStore(
    (state) => state.updateMontageGroupLayout
  );

  // displayCols = user's chosen number of visible columns (1–5)
  const bucketGridCols =
    settings.montageByGroup?.[groupKey]?.gridCols ?? DEFAULT_MONTAGE_GROUP_LAYOUT.gridCols;
  const [displayCols, setDisplayCols] = useState<number>(bucketGridCols);
  // Mirror of displayCols for stable access inside callbacks (width/resize/fill).
  const displayColsRef = useRef(bucketGridCols);
  useEffect(() => { displayColsRef.current = displayCols; }, [displayCols]);
  const [layout, setLayout] = useState<Layout[]>([]);
  const [hasWidth, setHasWidth] = useState(false);
  // Track whether initial layout has been built (prevent re-running on monitor refetch)
  const initializedRef = useRef(false);
  // Skip the restore effect when handleApplyGridLayout/handleLoadSavedLayout already set layout
  const skipRestoreRef = useRef(false);

  const currentWidthRef = useRef(0);
  // Width at which heights were last calculated: used to skip trivial changes
  const lastCalcWidthRef = useRef(0);

  // Refs for stable access in callbacks without causing re-renders
  const monitorMapRef = useRef<Map<string, Monitor>>(new Map());
  const isEditModeRef = useRef(isEditMode);
  const currentProfileRef = useRef(currentProfile);
  const settingsRef = useRef(settings);

  useEffect(() => { isEditModeRef.current = isEditMode; }, [isEditMode]);
  useEffect(() => { currentProfileRef.current = currentProfile; }, [currentProfile]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const groupKeyRef = useRef(groupKey);
  useEffect(() => { groupKeyRef.current = groupKey; }, [groupKey]);

  const monitorMap = useMemo(() => {
    return new Map(monitors.map((item) => [tileIdFor(item), item.Monitor]));
  }, [monitors]);

  useEffect(() => { monitorMapRef.current = monitorMap; }, [monitorMap]);

  const buildDefaultLayout = useCallback(
    (monitorList: MontageTileMonitorData[], cols: number, gridWidth: number): Layout[] => {
      // Each default tile is exactly one column wide. perRow == cols exactly,
      // so N columns always renders N regardless of whether N divides evenly.
      const w = COL_SUBDIVISION;
      const perRow = Math.max(1, Math.round(cols));
      const internalCols = internalColsForCols(cols);
      const map = monitorMapRef.current;
      return monitorList.map((item, index) => {
        const id = tileIdFor(item);
        const h = calculateHeightUnits(map, id, w, gridWidth, 0, internalCols);
        return {
          i: id,
          x: (index % perRow) * w,
          y: Math.floor(index / perRow) * h,
          w,
          h,
          minW: 1,
          minH: 50,
        };
      });
    },
    [] // Uses ref, stable identity
  );

  const recalcHeights = useCallback(
    (current: Layout[], gridWidth: number, cols: number): Layout[] => {
      const map = monitorMapRef.current;
      const internalCols = internalColsForCols(cols);
      return current.map((item) => ({
        ...item,
        w: Math.min(item.w, internalCols),
        x: Math.min(item.x, internalCols - item.w),
        h: calculateHeightUnits(map, item.i, item.w, gridWidth, 0, internalCols),
      }));
    },
    [] // Uses ref, stable identity
  );

  // Update displayCols when profile changes (external change only)
  useEffect(() => {
    setDisplayCols(bucketGridCols);
  }, [currentProfile?.id, groupKey, bucketGridCols]);

  // Build initial layout once when we have monitors + width.
  // Also re-runs when displayCols changes (user picked a new column count).
  useEffect(() => {
    if (monitors.length === 0) return;
    if (!hasWidth || currentWidthRef.current === 0) return;

    // handleApplyGridLayout / handleLoadSavedLayout already set layout directly
    if (skipRestoreRef.current) {
      skipRestoreRef.current = false;
      initializedRef.current = true;
      return;
    }

    const stored = settingsRef.current.montageByGroup?.[groupKeyRef.current]?.workingLayout;
    let nextLayout: Layout[];
    // Layouts saved on the old fixed 12-column grid are rebuilt once: their
    // arrangement can encode the wrong column count (issue #220), so the
    // rebuilt layout is persisted to replace the stale coordinates.
    const legacy = !!stored && isLegacyLayout(stored, displayCols);

    if (stored && stored.length > 0 && !legacy) {
      const existingIds = new Set(monitors.map(tileIdFor));
      const filtered = stored.filter((item) => existingIds.has(item.i));
      const presentIds = new Set(filtered.map((item) => item.i));
      const missing = monitors.filter((item) => !presentIds.has(tileIdFor(item)));
      const defaults = buildDefaultLayout(missing, displayCols, currentWidthRef.current);
      nextLayout = [...filtered, ...defaults];
    } else {
      nextLayout = buildDefaultLayout(monitors, displayCols, currentWidthRef.current);
    }

    const normalized = recalcHeights(nextLayout, currentWidthRef.current, displayCols);
    setLayout((prev) => (areLayoutsEqual(prev, normalized) ? prev : normalized));
    if (legacy && currentProfileRef.current) {
      updateMontageGroupLayout(currentProfileRef.current.id, groupKeyRef.current, {
        workingLayout: normalized,
      });
    }
    initializedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayCols, hasWidth, groupKey]);

  // When the monitor list changes (new/removed monitors), add missing ones
  // but don't reset existing positions.
  useEffect(() => {
    if (!initializedRef.current) return;
    if (monitors.length === 0) return;

    setLayout((prev) => {
      const existingIds = new Set(prev.map((item) => item.i));
      const newMonitors = monitors.filter((m) => !existingIds.has(tileIdFor(m)));
      if (newMonitors.length === 0) {
        // No new monitors; just remove items for monitors that no longer exist
        const currentIds = new Set(monitors.map(tileIdFor));
        const filtered = prev.filter((item) => currentIds.has(item.i));
        return filtered.length === prev.length ? prev : filtered;
      }
      const defaults = buildDefaultLayout(newMonitors, displayCols, currentWidthRef.current);
      return [...prev, ...defaults];
    });
  }, [monitors, displayCols, buildDefaultLayout]);

  const handleApplyGridLayout = useCallback(
    (cols: number) => {
      if (!currentProfileRef.current) return;

      const nextLayout = buildDefaultLayout(monitors, cols, currentWidthRef.current);

      skipRestoreRef.current = true;
      setDisplayCols(cols);
      setLayout(nextLayout);

      const profileId = currentProfileRef.current.id;
      updateMontageGroupLayout(profileId, groupKeyRef.current, {
        gridCols: cols,
        workingLayout: nextLayout,
      });

      toast.success(t('montage.grid_applied', { columns: cols }));
    },
    [monitors, updateMontageGroupLayout, buildDefaultLayout, t]
  );

  const handleLoadSavedLayout = useCallback(
    (savedLayout: Layout[], cols: number) => {
      if (!currentProfileRef.current) return;

      skipRestoreRef.current = true;
      const normalized = recalcHeights(savedLayout, currentWidthRef.current, cols);
      setDisplayCols(cols);
      setLayout(normalized);

      const profileId = currentProfileRef.current.id;
      updateMontageGroupLayout(profileId, groupKeyRef.current, {
        gridCols: cols,
        workingLayout: normalized,
      });
    },
    [updateMontageGroupLayout, recalcHeights]
  );

  const handleWidthChange = useCallback(
    (width: number) => {
      const isFirstMeasurement = lastCalcWidthRef.current === 0;
      currentWidthRef.current = width;

      if (isFirstMeasurement) {
        lastCalcWidthRef.current = width;
        setHasWidth(true);
        return;
      }

      // Recalculate heights to match new column pixel widths so aspect
      // ratios stay correct (especially for "Fit"/contain mode).
      // Jiggle is prevented by handleLayoutChange being a no-op in
      // non-edit mode: RGL compaction won't trigger re-render loops.
      lastCalcWidthRef.current = width;
      setLayout((prev) => recalcHeights(prev, width, displayColsRef.current));
    },
    [recalcHeights]
  );

  // onLayoutChange fires on EVERY re-render due to RGL compaction.
  // Do NOT persist here: it overwrites our layout with compacted positions.
  const handleLayoutChange = useCallback(
    (_nextLayout: Layout[]) => { /* no-op */ },
    []
  );

  // Save layout only when user finishes a drag
  const handleDragStop = useCallback(
    (nextLayout: Layout[]) => {
      if (!isEditModeRef.current || !currentProfileRef.current) return;
      setLayout(nextLayout);
      updateMontageGroupLayout(currentProfileRef.current.id, groupKeyRef.current, {
        workingLayout: nextLayout,
      });
    },
    [updateMontageGroupLayout]
  );

  const handleResizeStop = useCallback(
    (_layout: Layout[], _oldItem: Layout, newItem: Layout) => {
      const map = monitorMapRef.current;
      const adjustedHeight = calculateHeightUnits(
        map,
        newItem.i,
        newItem.w,
        currentWidthRef.current,
        0,
        internalColsForCols(displayColsRef.current)
      );

      setLayout((prev) => {
        const nextLayout = prev.map((item) =>
          item.i === newItem.i ? { ...item, h: adjustedHeight, w: newItem.w } : item
        );
        if (isEditModeRef.current && currentProfileRef.current) {
          updateMontageGroupLayout(currentProfileRef.current.id, groupKeyRef.current, {
            workingLayout: nextLayout,
          });
        }
        return areLayoutsEqual(prev, nextLayout) ? prev : nextLayout;
      });
    },
    [updateMontageGroupLayout]
  );

  // Proportionally scale the entire layout so it fills the full grid width
  const handleFillWidth = useCallback(() => {
    const profileId = currentProfileRef.current?.id;
    if (!profileId) return;

    const cols = displayColsRef.current;
    const internalCols = internalColsForCols(cols);
    setLayout((prev) => {
      // Find the rightmost edge of any item
      const maxRight = Math.max(...prev.map((item) => item.x + item.w));
      if (maxRight <= 0 || maxRight === internalCols) return prev;

      const scale = internalCols / maxRight;

      const nextLayout = prev.map((item) => ({
        ...item,
        x: Math.round(item.x * scale),
        w: Math.max(1, Math.round(item.w * scale)),
      }));

      // Recalculate heights for new widths
      const recalculated = recalcHeights(nextLayout, currentWidthRef.current, cols);

      updateMontageGroupLayout(profileId, groupKeyRef.current, {
        workingLayout: recalculated,
      });

      return recalculated;
    });
  }, [recalcHeights, updateMontageGroupLayout]);

  // Pinned monitors: prevents accidental drag/resize of the pinned item.
  // Uses per-item isDraggable/isResizable on the layout: does NOT use `static`.
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());

  const togglePinMonitor = useCallback((monitorId: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(monitorId)) next.delete(monitorId);
      else next.add(monitorId);
      return next;
    });
  }, []);

  const isMonitorPinned = useCallback((monitorId: string) => {
    return pinnedIds.has(monitorId);
  }, [pinnedIds]);

  return {
    layout,
    gridCols: displayCols,
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
  };
}
