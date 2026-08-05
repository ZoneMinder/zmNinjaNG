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
import { useProfileStore } from '../stores/profile';
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
  const { settings } = useCurrentProfile();
  const { selectedGroupId } = useGroupFilter();
  // Write target: the real profile id in single mode, the active aggregate's
  // id while aggregating (currentProfile is null there). Montage layout is a
  // view preference, so the aggregate's own bucket owns it - the same bucket
  // `settings` above already reads from, keeping read and write on one key
  // (refs #337).
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  const updateMontageGroupLayout = useSettingsStore(
    (state) => state.updateMontageGroupLayout
  );

  const groupKey = selectedGroupId ?? ALL_GROUPS_KEY;
  const bucket = settings.montageByGroup?.[groupKey] ?? DEFAULT_MONTAGE_GROUP_LAYOUT;

  const update = useCallback(
    (patch: Partial<MontageGroupLayout>) => {
      if (!currentProfileId) return;
      updateMontageGroupLayout(currentProfileId, groupKey, patch);
    },
    [currentProfileId, groupKey, updateMontageGroupLayout]
  );

  return { groupKey, bucket, update };
}
