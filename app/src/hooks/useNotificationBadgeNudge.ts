/**
 * Nudges a monitor's "new events" badge to refetch as soon as a notification
 * for it arrives, instead of waiting for the next 60s poll
 * (bandwidth.monitorNewEventsInterval).
 *
 * Independent of the toast effect in NotificationHandler.tsx: that effect is
 * gated on settings.showToasts, but the badge must move with the bell
 * regardless of that setting. Keeps its own last-seen ref so the two effects
 * never interfere with each other.
 */

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, type ProfileId } from '../lib/query/query-keys';
import type { NotificationEvent } from '../stores/notifications';

export function useNotificationBadgeNudge(
  profileId: ProfileId | undefined,
  events: NotificationEvent[]
): void {
  const queryClient = useQueryClient();
  const lastNudgedEventId = useRef<number | null>(null);
  const seededProfileId = useRef<ProfileId | undefined>(undefined);

  useEffect(() => {
    const latest = events[0];

    // A profile switch re-seeds instead of nudging: the new profile's
    // pre-existing events are backlog, not something that just arrived.
    if (seededProfileId.current !== profileId) {
      seededProfileId.current = profileId;
      lastNudgedEventId.current = latest?.EventId ?? null;
      return;
    }

    if (!latest || !profileId) return;
    if (latest.EventId === lastNudgedEventId.current) return;

    lastNudgedEventId.current = latest.EventId;
    queryClient.invalidateQueries({
      queryKey: queryKeys.monitorEventsSinceMonitor(profileId, String(latest.MonitorId)),
    });
  }, [events, profileId, queryClient]);
}
