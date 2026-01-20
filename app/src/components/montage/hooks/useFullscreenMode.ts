/**
 * Hook for fullscreen mode management
 *
 * Handles fullscreen state, overlay visibility, and auto-hide timer.
 */

import { useState, useEffect, useCallback } from 'react';
import { useSettingsStore } from '../../../stores/settings';
import type { Profile } from '../../../api/types';
import type { ProfileSettings } from '../../../stores/settings';

interface UseFullscreenModeOptions {
  currentProfile: Profile | null;
  settings: ProfileSettings;
}

interface UseFullscreenModeReturn {
  isFullscreen: boolean;
  showFullscreenOverlay: boolean;
  handleToggleFullscreen: (fullscreen: boolean) => void;
  setShowFullscreenOverlay: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useFullscreenMode({
  currentProfile,
  settings,
}: UseFullscreenModeOptions): UseFullscreenModeReturn {
  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);

  const [isFullscreen, setIsFullscreen] = useState(settings.montageIsFullscreen);
  const [showFullscreenOverlay, setShowFullscreenOverlay] = useState(false);

  // Update fullscreen state when profile changes
  useEffect(() => {
    setIsFullscreen(settings.montageIsFullscreen);
  }, [currentProfile?.id, settings.montageIsFullscreen]);

  // Auto-hide overlay after 5 seconds (only on desktop)
  useEffect(() => {
    if (showFullscreenOverlay && window.innerWidth >= 768) {
      const timer = setTimeout(() => {
        setShowFullscreenOverlay(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [showFullscreenOverlay]);

  const handleToggleFullscreen = useCallback(
    (fullscreen: boolean) => {
      if (!currentProfile) return;

      setIsFullscreen(fullscreen);
      updateSettings(currentProfile.id, {
        montageIsFullscreen: fullscreen,
      });

      if (!fullscreen) {
        setShowFullscreenOverlay(false);
      }
    },
    [currentProfile, updateSettings]
  );

  return {
    isFullscreen,
    showFullscreenOverlay,
    handleToggleFullscreen,
    setShowFullscreenOverlay,
  };
}
