/**
 * The analysis-frames setting, shared by the toolbar button and the menu item.
 *
 * Profile-scoped and remembered, and one value covers every live view: turning
 * it on in montage leaves it on in the single-monitor view. Extracted from
 * AnalysisFramesToggle when the same setting gained a second home in the view
 * menus - two copies of the write path would eventually disagree about which
 * bucket they write to, which is exactly the bug #337 spent a release fixing.
 */

import { useCurrentProfile } from './useCurrentProfile';
import { usePageViewMode } from './useViewPrefs';
import { useProfileStore } from '../stores/profile';
import { useSettingsStore } from '../stores/settings';

interface UseAnalysisFramesSettingOptions {
  /**
   * Set by views that stream regardless of the profile's Streaming Mode (the
   * single-monitor page forces 'streaming'), so the control stays usable there
   * while the profile sits on snapshot.
   */
  alwaysStreaming?: boolean;
}

interface AnalysisFramesSetting {
  isOn: boolean;
  /** Snapshot mode: zms serves one image and never looks at the frame type. */
  unavailable: boolean;
  toggle: () => void;
}

export function useAnalysisFramesSetting({
  alwaysStreaming = false,
}: UseAnalysisFramesSettingOptions = {}): AnalysisFramesSetting {
  const { settings } = useCurrentProfile();
  // Write target: the real profile in single mode, the active aggregate's id
  // while aggregating, matching the bucket `settings` above already reads
  // (refs #337).
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);

  // Not settings.viewMode: under "Per server" the active aggregate's bucket
  // imposes no Streaming Mode, and reading its own would disable a control
  // that still governs every streaming server's tiles (refs #337).
  const pageViewMode = usePageViewMode();
  const isOn = settings.showAnalysisFrames;

  return {
    isOn,
    unavailable: (!alwaysStreaming && pageViewMode === 'snapshot') || !currentProfileId,
    toggle: () => {
      if (!currentProfileId) return;
      updateSettings(currentProfileId, { showAnalysisFrames: !isOn });
    },
  };
}
