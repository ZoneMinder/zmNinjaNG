import { useCallback } from 'react';
import { useSettingsStore } from '../stores/settings';
import type { ProfileId } from '../api/types';

/** Profile settings that are a list of monitor ids: one per-monitor boolean each. */
export type MonitorFlagKey = 'unmutedMonitorIds' | 'fullscreenMonitorIds';

/**
 * A per-monitor boolean persisted as membership in one of the owning
 * profile's monitor-id lists, so a tile or page that remounts starts in the
 * state the user last chose (refs #463). Without a profile the flag is
 * always false and setting it is a no-op.
 */
export function useMonitorFlag(
  profileId: ProfileId | null | undefined,
  monitorId: string,
  key: MonitorFlagKey,
): [value: boolean, setValue: (value: boolean) => void] {
  const value = useSettingsStore((state) =>
    profileId ? state.getProfileSettings(profileId)[key].includes(monitorId) : false,
  );
  const setValue = useCallback((next: boolean) => {
    if (!profileId) return;
    const { getProfileSettings, updateProfileSettings } = useSettingsStore.getState();
    const others = getProfileSettings(profileId)[key].filter((id) => id !== monitorId);
    updateProfileSettings(profileId, { [key]: next ? [...others, monitorId] : others });
  }, [profileId, monitorId, key]);
  return [value, setValue];
}
