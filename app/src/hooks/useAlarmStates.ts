/**
 * Live alarm state for several monitors at once.
 *
 * One query per monitor. The alternative, a single combined request, is not
 * available: ZoneMinder's alarm endpoint is addressed by a single monitor id.
 * This matches the fanout useMonitorNewEvents already uses for the same
 * reason, and React Query dedupes and caches each monitor independently.
 *
 * The caller passes `enabled` so the fanout only runs while the Live Activity
 * page is actually on screen. There is no background polling cost anywhere
 * else in the app.
 */

import { useQueries } from '@tanstack/react-query';
import { getAlarmStatus } from '../api/monitors';
import { queryKeys } from '../lib/query/query-keys';
import { parseAlarmState, type MonitorAlarmState } from '../lib/monitor/alarm-state';
import { useCurrentProfile } from './useCurrentProfile';
import { useAuthStore } from '../stores/auth';

interface UseAlarmStatesOptions {
  /** Poll only while the page is visible. */
  enabled: boolean;
  /** Already reconciled against the bandwidth floor by the caller. */
  pollIntervalMs: number;
}

interface UseAlarmStatesReturn {
  /**
   * Total over `monitorIds`: every id passed in gets an entry, even before
   * its query has ever resolved. The downstream dwell reducer reads a
   * missing key as "the caller stopped watching this monitor" and drops it
   * without waiting out the dwell window, so a transiently-loading or
   * transiently-failed query must still report a value rather than being
   * left out of the map.
   *
   * Identity-stable: the same object comes back across renders while
   * nothing has changed. Consumers derive from it in effects, so a fresh
   * object per render is a render loop, not a wasted comparison.
   */
  states: Record<string, MonitorAlarmState>;
  isLoading: boolean;
  error: Error | null;
}

export function useAlarmStates(
  monitorIds: string[],
  { enabled, pollIntervalMs }: UseAlarmStatesOptions
): UseAlarmStatesReturn {
  const { currentProfile } = useCurrentProfile();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const profileId = currentProfile?.id;

  return useQueries({
    queries: monitorIds.map((monitorId) => ({
      queryKey: queryKeys.monitorAlarmStatus(profileId, monitorId),
      queryFn: () => getAlarmStatus(monitorId),
      enabled: enabled && !!profileId && isAuthenticated,
      refetchInterval: pollIntervalMs,
      // The page is only mounted while visible, so background refetching would
      // poll a screen nobody is looking at.
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
    })),
    // Reducing here rather than in a downstream useMemo is what keeps the
    // return value identity-stable. Without `combine`, useQueries re-maps its
    // results array on every render, so a useMemo listing it never hits and
    // every consumer sees a new `states` object each render. On the Live
    // Activity page that fed an effect which stamps Date.now() into the dwell
    // list, so the wall clock alone kept producing a new list: render, effect,
    // setState, render, forever (measured at 471 renders in 300ms with one
    // alarming monitor). TanStack runs replaceEqualDeep over whatever
    // `combine` returns, so an unchanged poll yields the very same object and
    // the loop never starts.
    combine: (results) => {
      const states: Record<string, MonitorAlarmState> = {};
      let isLoading = false;
      let error: Error | null = null;

      // Disabled means the caller is not watching any of these monitors right
      // now (page off screen), so the map is genuinely empty rather than
      // total. Once enabled, every requested id must get an entry: TanStack
      // still returns one result per query even for a per-query-disabled
      // fetch (e.g. no profile yet), so leaving that case out here would read
      // downstream as "no longer watched" and drop the monitor without its
      // dwell window.
      if (enabled) {
        results.forEach((result, i) => {
          if (result.isLoading) isLoading = true;
          // A failed poll reports the monitor's last known state, not
          // `unknown`. `unknown` is not alarming, so one dropped request on
          // flaky wifi would end the alarm, start the dwell countdown, and let
          // the next success count a *fresh* alarm: a single continuous alarm
          // displayed as "x7". React Query keeps the previous payload in
          // `data` across a failed refetch, so this holds steady instead. A
          // monitor that has never succeeded has no `data` and parses to
          // `unknown`, which keeps the map total.
          states[monitorIds[i]] = parseAlarmState(result.data);
          if (result.error && !error) error = result.error as Error;
        });
      }

      return { states, isLoading, error };
    },
  });
}
