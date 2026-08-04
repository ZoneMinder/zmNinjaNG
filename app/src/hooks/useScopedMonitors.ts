/**
 * useScopedMonitors Hook
 *
 * Aggregates monitors across the active profile scope (see useProfileScope):
 * one profile in single mode, every profile in All mode. Fans out via
 * useQueries with the SAME query key useMonitors uses
 * (queryKeys.monitors(id)), so single mode shares its cache entry with
 * existing single-profile surfaces instead of double-fetching.
 *
 * Each result is wrapped with its owning profile's id/name (Scoped<T>) so
 * colliding monitor ids across two servers stay distinct entries. A
 * profile's query failing does not fail the others - it becomes one
 * ProfileError entry while the rest of the scope keeps rendering.
 */

import { useCallback } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { getMonitors } from '../api/monitors';
import { getSession } from '../services/sessions';
import { filterEnabledMonitors } from '../lib/monitor/filters';
import { useProfileScope } from './useProfileScope';
import { useBandwidthSettings } from './useBandwidthSettings';
import { queryKeys } from '../lib/query/query-keys';
import { staggeredRefetchInterval } from '../lib/query/stagger-interval';
import type { Scoped, ProfileError } from '../api/scoped-types';
import type { MonitorData, ProfileId } from '../api/types';

export interface UseScopedMonitorsOptions {
  /** Whether the queries are enabled (default: true) */
  enabled?: boolean;
  /**
   * Poll the monitor list on the bandwidth interval (default true). Consumers
   * that stay mounted for the whole session and only need a name/id lookup
   * table (the command palette, the keyboard shortcuts) pass false: they share
   * this query key with the Monitors page, and React Query polls a shared
   * query on the shortest interval any observer asks for, so leaving them on
   * the default turned a page-scoped refresh into an app-wide one, multiplied
   * by the number of profiles in scope (refs #337).
   */
  poll?: boolean;
}

export interface UseScopedMonitorsReturn {
  /** Enabled monitors, all profiles, profile order then server order */
  monitors: Scoped<MonitorData>[];
  /** One entry per profile whose query failed */
  errors: ProfileError[];
  /** True only while NO profile has data yet */
  isLoading: boolean;
  /** Refetch exactly one profile's query */
  refetchProfile: (id: ProfileId) => void;
}

export function useScopedMonitors(options?: UseScopedMonitorsOptions): UseScopedMonitorsReturn {
  const scope = useProfileScope();
  const bandwidth = useBandwidthSettings();
  const queryClient = useQueryClient();
  const profiles = scope?.profiles ?? [];

  // combine is the only useQueries path that gets reference-stable output
  // (QueriesObserver diffs the combined result with replaceEqualDeep). The
  // combine callback is a fresh closure every render, but that's fine: the
  // observer re-invokes it regardless and then deep-diffs the OUTPUT against
  // the previous combined result, reusing old references for unchanged
  // sub-trees. Without combine, useQueries hands back a brand-new top-level
  // array every render, so any merge done in an external useMemo keyed on
  // that array recomputes - and produces new object identities - on every
  // poll tick even when the underlying data hasn't changed, which would
  // re-render every memoized monitor card once an All-mode view consumes
  // this hook.
  const { monitors, errors, isLoading } = useQueries({
    queries: profiles.map((p, i) => ({
      queryKey: queryKeys.monitors(p.id),
      queryFn: () => getMonitors(getSession(p.id).client, p.id),
      // A profile in scope always gets an enabled query, whether or not it
      // has ever bootstrapped/authenticated this session: the API client
      // self-heals an unauthenticated request via its own proactiveLogin
      // path (api/client.ts), so gating on isAuthenticated here just meant
      // an untouched profile's query stayed disabled forever - no data, no
      // error strip, silently missing from All mode. A real auth failure
      // still surfaces as this profile's ProfileError. Refs #337. Every
      // profile's TLS trust-on-first-use also resolves through this same
      // concurrent fan-out; which profile's cert gets pinned first is
      // best-effort, not ordered (refs #337, W8).
      enabled: options?.enabled ?? true,
      // Desynchronizes the N profiles' refetch bursts (W8) - see
      // stagger-interval.ts for the exact semantics.
      refetchInterval: (options?.poll ?? true)
        ? staggeredRefetchInterval(i, profiles.length, bandwidth.monitorStatusInterval)
        : undefined,
    })),
    combine: (results) => {
      const monitors: Scoped<MonitorData>[] = [];
      const errors: ProfileError[] = [];
      let anyHasData = false;

      profiles.forEach((p, i) => {
        const q = results[i];
        if (!q) return;
        if (q.data) {
          anyHasData = true;
          for (const item of filterEnabledMonitors(q.data.monitors)) {
            monitors.push({ profileId: p.id, profileName: p.name, item });
          }
        }
        if (q.error) {
          errors.push({ profileId: p.id, profileName: p.name, error: q.error });
        }
      });

      return { monitors, errors, isLoading: !anyHasData };
    },
  });

  // Keyed refetch instead of indexing into useQueries' per-render array -
  // exact query key match refetches precisely that profile, independent of
  // combine's shape.
  const refetchProfile = useCallback(
    (id: ProfileId): void => {
      void queryClient.refetchQueries({ queryKey: queryKeys.monitors(id), exact: true });
    },
    [queryClient]
  );

  return { monitors, errors, isLoading, refetchProfile };
}
