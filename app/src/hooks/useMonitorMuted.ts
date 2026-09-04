import { useCallback } from 'react';
import { useSettingsStore } from '../stores/settings';
import type { ProfileId } from '../api/types';

/**
 * Per-monitor mute state for live Go2RTC tiles, persisted in the owning
 * profile's settings (`unmutedMonitorIds`) so a tile that remounts starts in
 * the state the user last chose (refs #463). Without a profile the tile is
 * always muted and toggling is a no-op.
 */
export function useMonitorMuted(
  profileId: ProfileId | null | undefined,
  monitorId: string,
): [isMuted: boolean, toggleMuted: () => void] {
  const isMuted = useSettingsStore((state) =>
    profileId ? !state.getProfileSettings(profileId).unmutedMonitorIds.includes(monitorId) : true,
  );
  const toggleMuted = useCallback(() => {
    if (!profileId) return;
    const { getProfileSettings, updateProfileSettings } = useSettingsStore.getState();
    const others = getProfileSettings(profileId).unmutedMonitorIds.filter((id) => id !== monitorId);
    updateProfileSettings(profileId, {
      unmutedMonitorIds: isMuted ? [...others, monitorId] : others,
    });
  }, [profileId, monitorId, isMuted]);
  return [isMuted, toggleMuted];
}
