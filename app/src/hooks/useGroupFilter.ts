/**
 * useGroupFilter Hook
 *
 * Manages the group filter state for filtering monitors.
 * Persists selection in profile settings.
 *
 * Features:
 * - Reads/writes selectedGroupId from profile settings
 * - Computes filtered monitor IDs (includes child group monitors)
 * - Provides helper functions to manage filter state
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useCurrentProfile } from './useCurrentProfile';
import { useGroups } from './useGroups';
import { useSettingsStore } from '../stores/settings';

export interface UseGroupFilterReturn {
  /** Currently selected group ID (null = show all) */
  selectedGroupId: string | null;
  /** Set the selected group ID */
  setSelectedGroup: (groupId: string | null) => void;
  /** Clear the group filter (show all monitors) */
  clearGroupFilter: () => void;
  /** Whether a group filter is currently active */
  isFilterActive: boolean;
  /** Monitor IDs that belong to the selected group (empty = show all) */
  filteredMonitorIds: string[];
  /** Name of the selected group (for display) */
  selectedGroupName: string | null;
  /**
   * Whether the filter is resolved enough to drive rendering. False only while
   * a filter is active and the groups query has not settled yet, so callers can
   * gate tile rendering until filteredMonitorIds is final. Pages must not render
   * monitor tiles before this is true: a mounted tile starts its stream.
   */
  isFilterReady: boolean;
}

/**
 * Hook to manage group filter state.
 *
 * @returns Group filter state and manipulation functions
 *
 * @example
 * ```typescript
 * const { selectedGroupId, setSelectedGroup, isFilterActive, filteredMonitorIds } = useGroupFilter();
 *
 * // Filter monitors by group
 * const displayedMonitors = isFilterActive
 *   ? monitors.filter(m => filteredMonitorIds.includes(m.Monitor.Id))
 *   : monitors;
 * ```
 */
export function useGroupFilter(): UseGroupFilterReturn {
  const { currentProfile, settings } = useCurrentProfile();
  const { groups, getGroupMonitorIds, isSuccess, error } = useGroups();
  const updateProfileSettings = useSettingsStore((state) => state.updateProfileSettings);

  const selectedGroupId = settings.selectedGroupId;

  const setSelectedGroup = useCallback(
    (groupId: string | null) => {
      if (currentProfile?.id) {
        updateProfileSettings(currentProfile.id, { selectedGroupId: groupId });
      }
    },
    [currentProfile?.id, updateProfileSettings]
  );

  const clearGroupFilter = useCallback(() => {
    setSelectedGroup(null);
  }, [setSelectedGroup]);

  // Self-heal a dangling selection: if the selected group was deleted on the
  // server, reset to the All-monitors bucket. Gate on a confirmed successful
  // fetch (isSuccess), not isLoading. The groups query is disabled until the
  // profile is loaded and authenticated, and React Query v5 reports
  // isLoading=false for a disabled query. Guarding on isLoading let the empty
  // disabled-state list wipe a valid persisted selection during cold start.
  useEffect(() => {
    if (!isSuccess) return;
    if (!selectedGroupId) return;
    const exists = groups.some((g) => g.Group.Id === selectedGroupId);
    if (!exists) setSelectedGroup(null);
  }, [isSuccess, selectedGroupId, groups, setSelectedGroup]);

  const isFilterActive = selectedGroupId !== null;

  // With no active filter there is nothing to wait for. With an active filter,
  // gate on the groups query settling (success or error) so callers never
  // render tiles against a half-resolved membership list.
  const isFilterReady = !isFilterActive || isSuccess || error != null;

  const filteredMonitorIds = useMemo(() => {
    if (!selectedGroupId) return [];
    return getGroupMonitorIds(selectedGroupId);
  }, [selectedGroupId, getGroupMonitorIds]);

  const selectedGroupName = useMemo(() => {
    if (!selectedGroupId) return null;
    const group = groups.find((g) => g.Group.Id === selectedGroupId);
    return group?.Group.Name ?? null;
  }, [selectedGroupId, groups]);

  return {
    selectedGroupId,
    setSelectedGroup,
    clearGroupFilter,
    isFilterActive,
    filteredMonitorIds,
    selectedGroupName,
    isFilterReady,
  };
}
