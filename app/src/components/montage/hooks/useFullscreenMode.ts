/**
 * Hook for fullscreen mode management
 *
 * Handles fullscreen state and persistence. Controls are always visible
 * (no toggle/auto-hide logic needed).
 */

import { useCallback } from 'react';
import { useSettingsStore } from '../../../stores/settings';
import type { Profile } from '../../../api/types';
import type { ProfileSettings } from '../../../stores/settings';

interface UseFullscreenModeOptions {
  currentProfile: Profile | null;
  settings: ProfileSettings;
}

interface UseFullscreenModeReturn {
  isFullscreen: boolean;
  handleToggleFullscreen: (fullscreen: boolean) => void;
}

export function useFullscreenMode({
  currentProfile,
  settings,
}: UseFullscreenModeOptions): UseFullscreenModeReturn {
  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);

  // The profile setting is the state. It was previously mirrored into local
  // state and resynced by an effect, which only ever restated what the store
  // already held: the sole writer below updates the store too, and it returns
  // early without a profile, so the two could not diverge (refs #281).
  const handleToggleFullscreen = useCallback(
    (fullscreen: boolean) => {
      if (!currentProfile) return;
      updateSettings(currentProfile.id, {
        montageIsFullscreen: fullscreen,
      });
    },
    [currentProfile, updateSettings]
  );

  return {
    isFullscreen: settings.montageIsFullscreen,
    handleToggleFullscreen,
  };
}
