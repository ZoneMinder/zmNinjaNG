/**
 * useProfileScope Hook
 *
 * Resolves the active scope for data-fetching consumers: either a single
 * profile or the virtual "all profiles" aggregate (ALL_PROFILES_ID
 * sentinel). `profiles` is always an array so consumers fan out over
 * `scope.profiles` identically in both modes, with no branches.
 *
 * IMPORTANT: mirrors useCurrentProfile's selector discipline — stable
 * primitives from the profile store, useShallow for arrays/objects, and
 * settings merged inside useMemo. Do NOT call getProfileSettings() inside a
 * selector; it allocates a new object on every call and causes infinite
 * re-renders.
 */

import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useProfileStore } from '../stores/profile';
import { useSettingsStore, mergeProfileSettings } from '../stores/settings';
import { ALL_PROFILES_ID } from '../api/types';
import type { Profile } from '../api/types';
import type { ProfileSettings } from '../stores/settings';

export type ProfileScope =
  | { mode: 'single'; profile: Profile; profiles: [Profile]; settings: ProfileSettings }
  | { mode: 'all'; profile: null; profiles: Profile[]; settings: ProfileSettings };

/**
 * Hook to get the active profile scope.
 *
 * @returns The active scope, or null when no profile is selected.
 */
export function useProfileScope(): ProfileScope | null {
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  const profiles = useProfileStore(useShallow((state) => state.profiles)) ?? [];

  const isAllMode = currentProfileId === ALL_PROFILES_ID;

  const currentProfile = useMemo(
    () => profiles.find((p) => p.id === currentProfileId) ?? null,
    [profiles, currentProfileId]
  );

  // Select the RAW profile settings object - NOT the getProfileSettings
  // function, which creates a new object on every call. useShallow ensures
  // shallow comparison. The ALL bucket is keyed by ALL_PROFILES_ID in the
  // same profileSettings map - existing machinery, no store changes needed.
  const settingsKey = isAllMode ? ALL_PROFILES_ID : (currentProfileId ?? '');
  const rawSettings = useSettingsStore(useShallow((state) => state.profileSettings?.[settingsKey]));

  const settings = useMemo((): ProfileSettings => mergeProfileSettings(rawSettings), [rawSettings]);

  return useMemo((): ProfileScope | null => {
    if (isAllMode) {
      return { mode: 'all', profile: null, profiles, settings };
    }
    if (!currentProfile) return null;
    return { mode: 'single', profile: currentProfile, profiles: [currentProfile], settings };
  }, [isAllMode, profiles, currentProfile, settings]);
}
