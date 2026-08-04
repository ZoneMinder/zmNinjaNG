/**
 * useViewPrefs / usePageViewMode
 *
 * Resolves the view-level preferences a rendered stream must honor.
 *
 * Preferences are two-tier (refs #337): All Servers mode keeps its own
 * settings bucket, separate from every individual profile's. Page-level
 * controls get that for free - they read `useCurrentProfile().settings`,
 * which already resolves to the ALL bucket through the sentinel profile id.
 * The stream path does not: a montage tile owned by profile B resolves its
 * URLs, ports and token against profile B, so reading its view preferences
 * from the same place would leave the All Servers settings governing nothing.
 *
 * So the owning profile answers "where does this stream come from" and these
 * hooks answer "which settings is the user actually looking at". In single
 * mode they are the same profile and behavior is unchanged.
 *
 * Streaming Mode is a TRI-state while aggregating, because two states cannot
 * say "leave each server alone". It lives in its own ALL-bucket setting,
 * `allModeViewMode`, whose 'per-server' default sends each tile back to its
 * owning profile - so entering All mode never changes how anything streams
 * until the user asks. Reusing `viewMode` in the ALL bucket and treating
 * "unset" as per-server does not work: the first write of any key to a bucket
 * materializes the whole defaults shape, so unset is not a state that bucket
 * can stay in. Analysis frames stay two-state: off is a coherent default.
 *
 * Only preferences that describe the view belong here. Connection-level
 * settings (timeouts, multi-port, bandwidth) stay with the owning profile,
 * since they describe that server rather than what the user is looking at.
 */

import { useProfileById } from './useCurrentProfile';
import { useProfileScope } from './useProfileScope';
import { useProfileStore } from '../stores/profile';

import { ALL_PROFILES_ID } from '../api/types';
import type { ProfileId } from '../api/types';
import { useSettingsStore } from '../stores/settings';
import type { ProfileSettings, ViewMode } from '../stores/settings';

export type ViewPrefs = Pick<ProfileSettings, 'viewMode' | 'showAnalysisFrames'>;

/**
 * View preferences for one rendered monitor.
 *
 * @param owningProfileId - Profile that owns the monitor being rendered.
 *   Defaults to the current profile.
 */
export function useViewPrefs(owningProfileId?: ProfileId | null): ViewPrefs {
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  const isAllMode = currentProfileId === ALL_PROFILES_ID;

  const { settings: owningSettings } = useProfileById(owningProfileId);
  const { settings: allSettings } = useProfileById(ALL_PROFILES_ID);

  if (!isAllMode) {
    return {
      viewMode: owningSettings.viewMode,
      showAnalysisFrames: owningSettings.showAnalysisFrames,
    };
  }

  const imposed = allSettings.allModeViewMode;
  return {
    viewMode: imposed === 'per-server' ? owningSettings.viewMode : imposed,
    showAnalysisFrames: allSettings.showAnalysisFrames,
  };
}

/**
 * The Streaming Mode a page-level control should describe, where there is no
 * single owning monitor to ask.
 *
 * In All mode under "Per server" the answer differs per tile, so this reports
 * streaming when ANY server in scope streams: a control that would still
 * affect some tiles has to stay live. It reads each profile's merged settings
 * through the store's own getter, so the defaults stay in one place.
 */
export function usePageViewMode(): ViewMode {
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  const isAllMode = currentProfileId === ALL_PROFILES_ID;

  const scope = useProfileScope();
  const { settings } = useProfileById();
  const { settings: allSettings } = useProfileById(ALL_PROFILES_ID);
  // Returns a boolean, so no fresh object reaches the subscription.
  const anyServerStreams = useSettingsStore((state) =>
    (scope?.profiles ?? []).some(
      (profile) => state.getProfileSettings(profile.id).viewMode === 'streaming'
    )
  );

  if (!isAllMode) return settings.viewMode;
  const imposed = allSettings.allModeViewMode;
  if (imposed !== 'per-server') return imposed;
  return anyServerStreams ? 'streaming' : 'snapshot';
}
