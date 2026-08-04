/**
 * useViewPrefs Hook
 *
 * Resolves the view-level preferences a rendered stream must honor.
 *
 * Preferences are two-tier (refs #337): All Servers mode keeps its own
 * settings bucket, separate from every individual profile's. Page-level
 * controls get that for free - they read `useCurrentProfile().settings`,
 * which already resolves to the ALL bucket through the sentinel profile id.
 * The stream path does not: a montage tile owned by profile B resolves its
 * URLs, ports and token against profile B, so reading its view preferences
 * from the same place would leave the All Servers toolbar's Streaming Mode
 * and analysis-frames toggles governing nothing while each tile streamed
 * under its own server's settings instead.
 *
 * So the owning profile answers "where does this stream come from" and this
 * hook answers "which settings is the user actually looking at". In single
 * mode they are the same profile and behavior is unchanged.
 *
 * Only preferences that describe the view belong here. Connection-level
 * settings (timeouts, multi-port, bandwidth) stay with the owning profile,
 * since they describe that server rather than what the user is looking at.
 */

import { useProfileById } from './useCurrentProfile';
import { useProfileStore } from '../stores/profile';
import { ALL_PROFILES_ID } from '../api/types';
import type { ProfileId } from '../api/types';
import type { ProfileSettings } from '../stores/settings';

export type ViewPrefs = Pick<ProfileSettings, 'viewMode' | 'showAnalysisFrames'>;

/**
 * @param owningProfileId - Profile that owns the monitor being rendered.
 *   Defaults to the current profile.
 */
export function useViewPrefs(owningProfileId?: ProfileId | null): ViewPrefs {
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  const isAllMode = currentProfileId === ALL_PROFILES_ID;

  const { settings } = useProfileById(isAllMode ? ALL_PROFILES_ID : owningProfileId);

  return {
    viewMode: settings.viewMode,
    showAnalysisFrames: settings.showAnalysisFrames,
  };
}
