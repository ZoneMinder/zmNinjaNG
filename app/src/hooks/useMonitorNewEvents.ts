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
import { getCurrentSession, getSession } from '../services/sessions';
import { queryKeys } from '../lib/query/query-keys';
import { useMonitorSeenStore } from '../stores/monitorSeen';
import { useCurrentProfile } from './useCurrentProfile';
import { useAuthSlice } from '../stores/auth';
import { useBandwidthSettings } from './useBandwidthSettings';
import { staggeredRefetchInterval } from '../lib/query/stagger-interval';
import type { ProfileId } from '../api/types';

interface MonitorNewEvents {
  counts: Record<string, number>;
  newest: Record<string, string | null>;
}

export function useMonitorNewEvents(monitorIds: string[]): MonitorNewEvents {
  const { currentProfile } = useCurrentProfile();
  const isAuthenticated = useAuthSlice(currentProfile?.id ?? null).isAuthenticated;
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
        queryFn: () => getMonitorEventsSince(getCurrentSession().client, monitorId, since),
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

/** A (profile, monitor) pair whose new-event count is fetched under that
 *  profile's own session, regardless of which profile is globally selected. */
export interface ScopedMonitorRef {
  profileId: ProfileId;
  monitorId: string;
}

interface ScopedMonitorNewEvents {
  /** Keyed by `scopedMonitorEventKey(profileId, monitorId)`. */
  counts: Record<string, number>;
  newest: Record<string, string | null>;
}

/** Key shared between useScopedMonitorNewEvents' output and its callers, so
 *  a page never hand-rolls the join key and risks it drifting out of sync. */
export function scopedMonitorEventKey(profileId: ProfileId, monitorId: string): string {
  return `${profileId}:${monitorId}`;
}

/**
 * All-mode counterpart to useMonitorNewEvents: fans the same per-monitor
 * events-since query out across every (profile, monitor) pair the caller
 * supplies, using each pair's OWNING profile - never the globally-selected
 * current profile - for the query key, the session client, and the seen
 * watermark. Single mode keeps using useMonitorNewEvents unchanged; this
 * exists for All mode, where a monitor's badge and its "mark seen" watermark
 * both belong to the server that monitor actually lives on (refs #337).
 */
export function useScopedMonitorNewEvents(items: ScopedMonitorRef[]): ScopedMonitorNewEvents {
  const bandwidth = useBandwidthSettings();
  const profileWatermarks = useMonitorSeenStore((s) => s.profileWatermarks);
  const seed = useMonitorSeenStore((s) => s.seed);

  const results = useQueries({
    queries: items.map(({ profileId, monitorId }, i) => {
      const since = profileWatermarks[profileId]?.[monitorId] ?? null;
      return {
        queryKey: queryKeys.monitorEventsSince(profileId, monitorId, since),
        queryFn: () => getMonitorEventsSince(getSession(profileId).client, monitorId, since),
        // No isAuthenticated gate: same rationale as useScopedMonitors - an
        // All-mode profile that has never authenticated this session still
        // gets a query, and the API client's own proactiveLogin self-heals
        // it on first request (refs #337). Its TLS trust-on-first-use rides
        // the same concurrent fan-out; cert pinning order across profiles
        // is best-effort, not guaranteed (refs #337, W8).
        enabled: true,
        // Desynchronizes the per-(profile, monitor) refetch bursts (W8) -
        // see stagger-interval.ts for the exact semantics.
        refetchInterval: staggeredRefetchInterval(i, items.length, bandwidth.monitorNewEventsInterval),
      };
    }),
  });

  // Seed on first response. Effect, not render: seeding writes to a store,
  // and a write during render would tear the tree.
  useEffect(() => {
    items.forEach(({ profileId, monitorId }, i) => {
      const data = results[i]?.data;
      if (!data) return;
      seed(profileId, monitorId, data.newest);
    });
  }, [items, results, seed]);

  return useMemo(() => {
    const counts: Record<string, number> = {};
    const newest: Record<string, string | null> = {};

    items.forEach(({ profileId, monitorId }, i) => {
      const data = results[i]?.data;
      if (!data) return;
      const key = scopedMonitorEventKey(profileId, monitorId);
      newest[key] = data.newest;
      const watermarks = profileWatermarks[profileId] ?? {};
      const seeded = Object.prototype.hasOwnProperty.call(watermarks, monitorId);
      counts[key] = seeded ? data.count : 0;
    });

    return { counts, newest };
  }, [items, results, profileWatermarks]);
}
