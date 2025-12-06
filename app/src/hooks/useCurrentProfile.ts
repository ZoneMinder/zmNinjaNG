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
 * - Uses shallow comparison for settings to prevent unnecessary re-renders
 */

import { useShallow } from 'zustand/react/shallow';
import { useProfileStore } from '../stores/profile';
import { useSettingsStore } from '../stores/settings';
import type { Profile } from '../api/types';
import type { ProfileSettings } from '../stores/settings';

export interface UseCurrentProfileReturn {
  /** Current active profile (null if no profile selected) */
  currentProfile: Profile | null;
  /** Settings for the current profile */
  settings: ProfileSettings;
  /** Helper to check if profile exists */
  hasProfile: boolean;
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
  const currentProfile = useProfileStore((state) => state.currentProfile());

  const settings = useSettingsStore(
    useShallow((state) => state.getProfileSettings(currentProfile?.id || ''))
  );

  return {
    currentProfile,
    settings,
    hasProfile: currentProfile !== null,
  };
}
