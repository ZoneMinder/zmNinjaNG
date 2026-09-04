import { useCallback } from 'react';
import { useMonitorFlag } from './useMonitorFlag';
import type { ProfileId } from '../api/types';

/**
 * Per-monitor mute state for live Go2RTC video, persisted in the owning
 * profile's `unmutedMonitorIds` (refs #463). Stored inverted because tiles
 * start muted: an absent monitor is a muted one.
 */
export function useMonitorMuted(
  profileId: ProfileId | null | undefined,
  monitorId: string,
): [isMuted: boolean, setMuted: (muted: boolean) => void] {
  const [unmuted, setUnmuted] = useMonitorFlag(profileId, monitorId, 'unmutedMonitorIds');
  const setMuted = useCallback((muted: boolean) => setUnmuted(!muted), [setUnmuted]);
  return [!unmuted, setMuted];
}
