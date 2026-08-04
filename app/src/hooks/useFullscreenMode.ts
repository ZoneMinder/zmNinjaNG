/**
 * Fullscreen state for a page, persisted in that page's own profile setting.
 *
 * The key is a parameter rather than a constant because more than one page
 * has a fullscreen mode and each needs its own memory of it. A shared key
 * would mean going fullscreen on one page silently put the other one in
 * fullscreen as well (refs #313).
 *
 * Controls stay visible in fullscreen; there is no auto-hide logic here.
 *
 * Takes a bucket id, not a `Profile`: in All mode there is no `Profile`
 * object (useCurrentProfile resolves `currentProfile` to null for the
 * ALL_PROFILES_ID sentinel), but the flag is still a view-level preference
 * that belongs in the shared ALL bucket, same as every other All-mode
 * view-level setting. Callers pass the raw currentProfileId - the real
 * profile id in single mode, ALL_PROFILES_ID in All mode - rather than
 * `currentProfile?.id`, which is null exactly when this would otherwise be
 * needed (refs #337).
 */

import { useCallback } from 'react';
import { useSettingsStore } from '../stores/settings';
import type { ProfileId } from '../api/types';
import type { ProfileSettings } from '../stores/settings';

/** The profile settings that record a page's fullscreen state. */
export type FullscreenSettingKey = 'montageIsFullscreen' | 'liveActivityIsFullscreen';

interface UseFullscreenModeOptions {
  profileId: ProfileId | null;
  settings: ProfileSettings;
  settingKey: FullscreenSettingKey;
}

interface UseFullscreenModeReturn {
  isFullscreen: boolean;
  handleToggleFullscreen: (fullscreen: boolean) => void;
}

export function useFullscreenMode({
  profileId,
  settings,
  settingKey,
}: UseFullscreenModeOptions): UseFullscreenModeReturn {
  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);

  // The profile setting is the state. It was previously mirrored into local
  // state and resynced by an effect, which only ever restated what the store
  // already held: the sole writer below updates the store too, and it returns
  // early without a bucket to write to, so the two could not diverge (refs #281).
  const handleToggleFullscreen = useCallback(
    (fullscreen: boolean) => {
      if (!profileId) return;
      updateSettings(profileId, { [settingKey]: fullscreen });
    },
    [profileId, updateSettings, settingKey]
  );

  return {
    isFullscreen: settings[settingKey],
    handleToggleFullscreen,
  };
}
