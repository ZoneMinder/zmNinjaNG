/**
 * How many events each monitor has recorded since the user last looked at it.
 *
 * One query per monitor. The alternative, a single query OR-ing every
 * MonitorId, starves: ZoneMinder ORs repeated MonitorId segments, so one busy
 * camera consumes the whole page limit and every other monitor reads zero.
 *
 * A monitor with no watermark is seeded from its first response and reports
 * zero, so a fresh install shows no backlog (refs #239).
 */

import { useEffect, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { getMonitorEventsSince } from '../api/events';
import { queryKeys } from '../lib/query/query-keys';
import { useMonitorSeenStore } from '../stores/monitorSeen';
import { useCurrentProfile } from './useCurrentProfile';
import { useAuthStore } from '../stores/auth';
import { useBandwidthSettings } from './useBandwidthSettings';

interface MonitorNewEvents {
  counts: Record<string, number>;
  newest: Record<string, string | null>;
}

export function useMonitorNewEvents(monitorIds: string[]): MonitorNewEvents {
  const { currentProfile } = useCurrentProfile();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const bandwidth = useBandwidthSettings();

  const profileId = currentProfile?.id;
  const profileWatermarks = useMonitorSeenStore((s) => s.profileWatermarks);
  const seed = useMonitorSeenStore((s) => s.seed);

  const watermarks = useMemo(
    () => (profileId ? (profileWatermarks[profileId] ?? {}) : {}),
    [profileWatermarks, profileId]
  );

  const results = useQueries({
    queries: monitorIds.map((monitorId) => {
      const since = watermarks[monitorId] ?? null;
      return {
        queryKey: queryKeys.monitorEventsSince(profileId, monitorId, since),
        queryFn: () => getMonitorEventsSince(monitorId, since),
        enabled: !!profileId && isAuthenticated,
        refetchInterval: bandwidth.monitorNewEventsInterval,
      };
    }),
  });

  // Seed on first response. Effect, not render: seeding writes to a store, and
  // a write during render would tear the tree.
  useEffect(() => {
    if (!profileId) return;
    monitorIds.forEach((monitorId, i) => {
      const data = results[i]?.data;
      if (!data) return;
      seed(profileId, monitorId, data.newest);
    });
  }, [profileId, monitorIds, results, seed]);

  return useMemo(() => {
    const counts: Record<string, number> = {};
    const newest: Record<string, string | null> = {};

    monitorIds.forEach((monitorId, i) => {
      const data = results[i]?.data;
      if (!data) return;
      newest[monitorId] = data.newest;
      // Unseeded monitors report zero: the response that seeds them is also
      // the one that would otherwise show their whole history as new.
      const seeded = Object.prototype.hasOwnProperty.call(watermarks, monitorId);
      counts[monitorId] = seeded ? data.count : 0;
    });

    return { counts, newest };
  }, [monitorIds, results, watermarks]);
}
