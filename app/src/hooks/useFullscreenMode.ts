/**
 * Fullscreen state for a page, persisted in that page's own profile setting.
 *
 * The key is a parameter rather than a constant because more than one page
 * has a fullscreen mode and each needs its own memory of it. A shared key
 * would mean going fullscreen on one page silently put the other one in
 * fullscreen as well (refs #313).
 *
 * Controls stay visible in fullscreen; there is no auto-hide logic here.
 */

import { useCallback } from 'react';
import { useSettingsStore } from '../stores/settings';
import type { Profile } from '../api/types';
import type { ProfileSettings } from '../stores/settings';

/** The profile settings that record a page's fullscreen state. */
export type FullscreenSettingKey = 'montageIsFullscreen' | 'liveActivityIsFullscreen';

interface UseFullscreenModeOptions {
  currentProfile: Profile | null;
  settings: ProfileSettings;
  settingKey: FullscreenSettingKey;
}

interface UseFullscreenModeReturn {
  isFullscreen: boolean;
  handleToggleFullscreen: (fullscreen: boolean) => void;
}

export function useFullscreenMode({
  currentProfile,
  settings,
  settingKey,
}: UseFullscreenModeOptions): UseFullscreenModeReturn {
  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);

  // The profile setting is the state. It was previously mirrored into local
  // state and resynced by an effect, which only ever restated what the store
  // already held: the sole writer below updates the store too, and it returns
  // early without a profile, so the two could not diverge (refs #281).
  const handleToggleFullscreen = useCallback(
    (fullscreen: boolean) => {
      if (!currentProfile) return;
      updateSettings(currentProfile.id, { [settingKey]: fullscreen });
    },
    [currentProfile, updateSettings, settingKey]
  );

  return {
    isFullscreen: settings[settingKey],
    handleToggleFullscreen,
  };
}
