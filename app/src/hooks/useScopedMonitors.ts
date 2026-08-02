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

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import { getMonitors } from '../api/monitors';
import { getSession } from '../services/sessions';
import { filterEnabledMonitors } from '../lib/monitor/filters';
import { useProfileScope } from './useProfileScope';
import { useBandwidthSettings } from './useBandwidthSettings';
import { useAuthStore } from '../stores/auth';
import { queryKeys } from '../lib/query/query-keys';
import type { Scoped, ProfileError } from '../api/scoped-types';
import type { MonitorData, ProfileId } from '../api/types';

export interface UseScopedMonitorsOptions {
  /** Whether the queries are enabled (default: true) */
  enabled?: boolean;
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
  const profiles = scope?.profiles ?? [];

  // Can't call useAuthSlice in a loop - select the whole slices map once and
  // derive per-profile enablement below (mirrors useMonitors' semantics: a
  // profile whose server requires auth and isn't authenticated yet doesn't
  // fetch).
  const slices = useAuthStore(useShallow((s) => s.slices));

  const queries = useQueries({
    queries: profiles.map((p) => {
      const slice = slices[p.id];
      const authOk = !!slice && (slice.isAuthenticated || !slice.requiresAuth);
      return {
        queryKey: queryKeys.monitors(p.id),
        queryFn: () => getMonitors(getSession(p.id).client, p.id),
        enabled: (options?.enabled ?? true) && authOk,
        // ponytail: plain shared interval for v1; if N-profile refetches land
        // as a synchronized burst on the server in the field, upgrade to a
        // per-query offset scheduler instead of this identical interval.
        refetchInterval: bandwidth.monitorStatusInterval,
      };
    }),
  });

  return useMemo(() => {
    const monitors: Scoped<MonitorData>[] = [];
    const errors: ProfileError[] = [];
    let anyHasData = false;

    profiles.forEach((p, i) => {
      const q = queries[i];
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

    const refetchProfile = (id: ProfileId): void => {
      const index = profiles.findIndex((p) => p.id === id);
      if (index === -1) return;
      queries[index]?.refetch();
    };

    return {
      monitors,
      errors,
      isLoading: !anyHasData,
      refetchProfile,
    };
  }, [queries, profiles]);
}
