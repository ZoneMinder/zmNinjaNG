/**
 * useProfileScope Hook
 *
 * Resolves the active scope for data-fetching consumers: either a single
 * profile or the virtual "all profiles" aggregate (ALL_PROFILES_ID
 * sentinel). `profiles` is always an array so consumers fan out over
 * `scope.profiles` identically in both modes, with no branches.
 *
 * IMPORTANT: mirrors useCurrentProfile's selector discipline: stable
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
  // Fallback lives inside the selector so useShallow can dedupe repeated
  // empty-array snapshots to the same reference; a `?? []` applied outside
  // the selector allocates a new array every render and defeats the
  // useMemo below (react-hooks/exhaustive-deps).
  const profiles = useProfileStore(useShallow((state) => state.profiles ?? []));

  const isAllMode = currentProfileId === ALL_PROFILES_ID;

  // Disabled profiles are excluded from the All-mode aggregate. This is the
  // single filter every aggregate surface inherits (monitors, events,
  // badges, notification overview, pickers, token refresh) since they all
  // fan out over scope.profiles rather than the raw store list. Refs #337.
  const enabledProfiles = useMemo(() => profiles.filter((p) => !p.disabled), [profiles]);

  const currentProfile = useMemo(() => {
    const found = profiles.find((p) => p.id === currentProfileId) ?? null;
    // A disabled profile can never be current in normal operation -
    // switchProfile's guard rejects switching to one. This only matters if
    // persisted state is ever edited externally to hold a disabled profile
    // as current; treat that the same as "no profile selected" so it routes
    // to the setup redirect like any other unresolvable current id.
    return found && !found.disabled ? found : null;
  }, [profiles, currentProfileId]);

  // Select the RAW profile settings object - NOT the getProfileSettings
  // function, which creates a new object on every call. useShallow ensures
  // shallow comparison. The ALL bucket is keyed by ALL_PROFILES_ID in the
  // same profileSettings map - existing machinery, no store changes needed.
  // isAllMode implies currentProfileId === ALL_PROFILES_ID, so this key is
  // just currentProfileId either way.
  const rawSettings = useSettingsStore(useShallow((state) => state.profileSettings?.[currentProfileId ?? '']));

  const settings = useMemo((): ProfileSettings => mergeProfileSettings(rawSettings), [rawSettings]);

  return useMemo((): ProfileScope | null => {
    if (isAllMode) {
      // Deleting profiles one-by-one while in All mode can leave the
      // sentinel selected with zero real profiles left (deleteProfile only
      // resets currentProfileId when it equals the deleted id, never for
      // the sentinel). Collapse to null so it means "nothing to show, route
      // to setup" uniformly in both modes (refs #337). Same collapse
      // applies when every remaining profile is disabled.
      if (enabledProfiles.length === 0) return null;
      return { mode: 'all', profile: null, profiles: enabledProfiles, settings };
    }
    if (!currentProfile) return null;
    return { mode: 'single', profile: currentProfile, profiles: [currentProfile], settings };
  }, [isAllMode, enabledProfiles, currentProfile, settings]);
}
