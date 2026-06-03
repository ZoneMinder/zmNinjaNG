/**
 * useMontageGroupState Hook
 *
 * Resolves the current montage group key (selected group ID or the All-monitors
 * sentinel) and returns that group's montage bucket plus a patch updater.
 * Centralizes group-keyed read/write so pages and the grid hook do not hand-roll
 * settings.montageByGroup spreads.
 */

import { useCallback } from 'react';
import { useCurrentProfile } from './useCurrentProfile';
import { useGroupFilter } from './useGroupFilter';
import {
  useSettingsStore,
  ALL_GROUPS_KEY,
  DEFAULT_MONTAGE_GROUP_LAYOUT,
  type MontageGroupLayout,
} from '../stores/settings';

export interface UseMontageGroupStateReturn {
  /** Active group key: selected group ID, or ALL_GROUPS_KEY when none selected. */
  groupKey: string;
  /** The montage bucket for the active group (defaults when absent). */
  bucket: MontageGroupLayout;
  /** Merge a patch into the active group's bucket. */
  update: (patch: Partial<MontageGroupLayout>) => void;
}

export function useMontageGroupState(): UseMontageGroupStateReturn {
  const { currentProfile, settings } = useCurrentProfile();
  const { selectedGroupId } = useGroupFilter();
  const updateMontageGroupLayout = useSettingsStore(
    (state) => state.updateMontageGroupLayout
  );

  const groupKey = selectedGroupId ?? ALL_GROUPS_KEY;
  const bucket = settings.montageByGroup[groupKey] ?? DEFAULT_MONTAGE_GROUP_LAYOUT;

  const update = useCallback(
    (patch: Partial<MontageGroupLayout>) => {
      if (!currentProfile) return;
      updateMontageGroupLayout(currentProfile.id, groupKey, patch);
    },
    [currentProfile, groupKey, updateMontageGroupLayout]
  );

  return { groupKey, bucket, update };
}
