/**
 * Toolbar toggle for ZoneMinder's analysis frames.
 *
 * The setting is profile-scoped and remembered, so a view that opens with it
 * already on applies it to each stream as that stream's first frame arrives
 * (see useAnalysisFrames). One value covers every live view: turning it on in
 * montage leaves it on in the single-monitor view.
 *
 * Snapshot mode gets a disabled button rather than a hidden one. zms serves a
 * single image straight from the capture buffer and never looks at the frame
 * type, so the overlay is genuinely unavailable there, and a control that
 * silently did nothing would read as a bug.
 */

import { useTranslation } from 'react-i18next';
import { ScanEye } from 'lucide-react';
import { Button } from '../ui/button';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import { useProfileStore } from '../../stores/profile';
import { useSettingsStore } from '../../stores/settings';

interface AnalysisFramesToggleProps {
  className?: string;
  /**
   * Set by views that stream regardless of the profile's Streaming Mode (the
   * single-monitor page forces 'streaming'), so the button stays usable there
   * while the profile sits on snapshot.
   */
  alwaysStreaming?: boolean;
}

export function AnalysisFramesToggle({ className, alwaysStreaming = false }: AnalysisFramesToggleProps) {
  const { t } = useTranslation();
  const { settings } = useCurrentProfile();
  // Write target: the real profile in single mode, the ALL bucket sentinel in
  // All mode, matching the bucket `settings` above already reads (refs #337).
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);

  const unavailable = !alwaysStreaming && settings.viewMode === 'snapshot';
  const isOn = settings.showAnalysisFrames;
  const label = t('video.analysis_frames');
  const title = unavailable ? t('video.analysis_needs_streaming') : t('video.analysis_frames_hint');

  return (
    <Button
      variant={isOn ? 'default' : 'outline'}
      size="icon"
      className={className}
      disabled={unavailable || !currentProfileId}
      aria-pressed={isOn}
      aria-label={label}
      title={title}
      onClick={() => {
        if (!currentProfileId) return;
        updateSettings(currentProfileId, { showAnalysisFrames: !isOn });
      }}
      data-testid="analysis-frames-toggle"
    >
      <ScanEye className="h-4 w-4" />
    </Button>
  );
}
