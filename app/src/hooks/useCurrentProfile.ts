/**
 * useCurrentProfile Hook
 *
 * Centralized hook for accessing current profile and its settings.
 * Replaces the duplicated pattern of fetching profile and settings separately.
 *
 * Features:
 * - Gets current profile from profile store
 * - Gets profile-specific settings from settings store
 * - Returns both in a single hook call
 * - Uses proper selectors to prevent infinite re-renders
 * 
 * IMPORTANT: Do NOT call getProfileSettings() inside a selector as it creates
 * new object references on every call, causing infinite re-renders.
 */

import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useProfileStore } from '../stores/profile';
import { useSettingsStore, mergeProfileSettings } from '../stores/settings';
import { isAggregateProfileId } from '../api/types';
import type { Profile, ProfileId } from '../api/types';
import type { ProfileSettings } from '../stores/settings';

export interface UseCurrentProfileReturn {
  /** Current active profile (null if no profile selected, and null in All mode) */
  currentProfile: Profile | null;
  /** Settings for the current profile */
  settings: ProfileSettings;
  /** Helper to check if profile exists */
  hasProfile: boolean;
  /** True while aggregating: All Servers or a group is the active selection */
  isAllMode: boolean;
}

/**
 * Hook to get the current profile and its settings.
 *
 * @returns Current profile, settings, and helper flags
 *
 * @example
 * ```typescript
 * const { currentProfile, settings, hasProfile } = useCurrentProfile();
 *
 * if (!hasProfile) {
 *   return <Navigate to="/setup" />;
 * }
 * ```
 */
export function useCurrentProfile(): UseCurrentProfileReturn {
  // Select currentProfileId as a stable primitive
  const currentProfileId = useProfileStore((state) => state.currentProfileId);

  // True whenever an aggregate is selected: the All Servers sentinel or a
  // group. Consumers ask "am I aggregating", never which aggregate - the
  // scope answers that (useProfileScope's aggregateId). currentProfile stays
  // null and hasProfile stays false either way (no real profile matches an
  // aggregate id), keeping single-mode-only surfaces unchanged. Refs #337.
  const isAllMode = isAggregateProfileId(currentProfileId);
  
  // Use useShallow for the profiles array to prevent re-renders when
  // unrelated parts of the profile store change
  const profiles = useProfileStore(useShallow((state) => state.profiles));

  // Derive current profile from stable references
  const currentProfile = useMemo(
    () => (profiles ?? []).find((p) => p.id === currentProfileId) ?? null,
    [profiles, currentProfileId]
  );

  // Select the RAW profile settings object - NOT the getProfileSettings function
  // which creates a new object on every call. useShallow ensures shallow comparison.
  // Guard against undefined profileSettings (can happen in test mocks).
  const rawProfileSettings = useSettingsStore(
    useShallow((state) => state.profileSettings?.[currentProfileId ?? ''])
  );

  // Merge with defaults in useMemo - only recreates when rawProfileSettings
  // changes. Goes through mergeProfileSettings (not a raw spread) so native
  // profiles get coerced off the on-device backend here too, since this is the
  // reactive path the assistant chat and header actually read (refs #246).
  const settings = useMemo(
    (): ProfileSettings => mergeProfileSettings(rawProfileSettings),
    [rawProfileSettings]
  );

  return {
    currentProfile,
    settings,
    hasProfile: currentProfile !== null,
    isAllMode,
  };
}

export interface UseProfileByIdReturn {
  /** The requested profile, or null when unknown/unset */
  profile: Profile | null;
  /** Settings for that profile */
  settings: ProfileSettings;
}

/**
 * Hook to get a specific profile and its settings by id, defaulting to the
 * current profile when no id is given. Used by the stream-URL chain
 * (useServerUrls, useFreshAccessToken, useMonitorStream) so an All-mode
 * monitor tile owned by a non-current profile can resolve that profile's
 * URLs and token instead of always reading the globally-selected one.
 *
 * @param profileId - Profile to resolve; defaults to the current profile.
 */
export function useProfileById(profileId?: ProfileId | null): UseProfileByIdReturn {
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  const effectiveProfileId = profileId ?? currentProfileId;

  const profiles = useProfileStore(useShallow((state) => state.profiles));
  const profile = useMemo(
    () => (profiles ?? []).find((p) => p.id === effectiveProfileId) ?? null,
    [profiles, effectiveProfileId]
  );

  const rawProfileSettings = useSettingsStore(
    useShallow((state) => state.profileSettings?.[effectiveProfileId ?? ''])
  );

  const settings = useMemo(
    (): ProfileSettings => mergeProfileSettings(rawProfileSettings),
    [rawProfileSettings]
  );

  return { profile, settings };
}
