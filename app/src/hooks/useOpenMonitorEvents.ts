/**
 * Opens the events list for a monitor, filtered to what is new since the
 * user's last visit.
 *
 * Extracted from MonitorCard's inline `openEvents` (refs #239) so the
 * montage view can reuse the same click behavior. See lib/event/watermark.ts
 * for the date arithmetic and stores/monitorSeen.ts for what a watermark is.
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrentProfile } from './useCurrentProfile';
import { useMonitorSeenStore } from '../stores/monitorSeen';
import { nextSecondAfter } from '../lib/event/watermark';
import type { ProfileId } from '../api/types';

export interface OpenMonitorEventsOptions {
  monitorId: string;
  newEventCount: number | undefined;
  newestEventAt: string | null | undefined;
  /** Route the caller navigated from, stored as navigation state for the back link. */
  from: string;
  /** All mode only: the monitor's owning profile. The Events page reads this
   *  to scope its All-mode server filter to just that profile, so the caller
   *  navigates directly instead of switching into it first (refs #337). Also
   *  the profile whose seen watermark this call marks - see below. */
  profileId?: ProfileId;
}

/**
 * Returns a function that marks a monitor's events as seen and navigates to
 * the events list, scoped to events recorded after the watermark that was in
 * effect before this click.
 */
export function useOpenMonitorEvents(): (opts: OpenMonitorEventsOptions) => void {
  const navigate = useNavigate();
  const { currentProfile } = useCurrentProfile();
  const markSeen = useMonitorSeenStore((s) => s.markSeen);

  return useCallback(
    ({ monitorId, newEventCount, newestEventAt, from, profileId }: OpenMonitorEventsOptions) => {
      // The card's own profile in All mode, the current profile in single
      // mode. markSeen must write THIS profile's watermark - the globally
      // selected profile isn't necessarily the one the clicked monitor
      // belongs to (refs #337, Task 5).
      const owningProfileId = profileId ?? currentProfile?.id;

      // Read the watermark BEFORE markSeen overwrites it: the date filter must
      // match what the badge counted, not what "seen" becomes after this click.
      const oldWatermark = owningProfileId
        ? useMonitorSeenStore.getState().getWatermark(owningProfileId, monitorId)
        : null;

      if (owningProfileId) {
        markSeen(owningProfileId, monitorId, newestEventAt ?? null);
      }

      const params = new URLSearchParams({ monitorId });
      // No date param when there is nothing new to show (quiet camera) or when
      // the watermark is null (the monitor was seeded with zero events, so the
      // whole history IS the new set).
      if (newEventCount !== undefined && newEventCount > 0 && oldWatermark !== null) {
        params.set('startDateTime', nextSecondAfter(oldWatermark));
      }
      if (profileId) params.set('profileId', profileId);
      navigate(`/events?${params.toString()}`, { state: { from } });
    },
    [navigate, currentProfile, markSeen]
  );
}
