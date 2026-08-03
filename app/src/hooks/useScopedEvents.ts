/**
 * useScopedEvents Hook
 *
 * Aggregates events across the active profile scope (see useProfileScope):
 * one profile in single mode, every profile in All mode. Fans out via
 * useQueries with the SAME query key useEvents/Events.tsx uses
 * (queryKeys.eventsList(id, filters, limit, monitorId, isGroupFilterActive,
 * eventIds, tagIds)), so single mode shares its cache entry with the
 * existing single-profile Events page instead of double-fetching. v1
 * applies the CALLER-SUPPLIED filter params identically to every profile in
 * scope; per-profile monitor exclusions already ride the getEvents/api gate.
 *
 * Each result is wrapped with its owning profile's id/name (Scoped<T>) so
 * colliding event ids across two servers stay distinct entries. A profile's
 * query failing does not fail the others - it becomes one ProfileError
 * entry while the rest of the scope keeps rendering.
 *
 * Merged events are sorted descending by true absolute instant (eventInstant,
 * lib/event/event-instant.ts), not by the server-local StartDateTime string,
 * so events from profiles in different timezones interleave correctly.
 *
 * Polling is opt-in: `options.refetchInterval` is undefined unless the
 * caller passes one. The Events page's own query has no polling today, so
 * this hook must not invent it - a caller that wants live refresh sources
 * the interval itself via useBandwidthSettings (Polling contract stays at
 * the call site) and passes it through.
 */

import { useCallback } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { getEvents } from '../api/events';
import type { EventFilters } from '../api/events';
import { getSession } from '../services/sessions';
import { useProfileScope } from './useProfileScope';
import { queryKeys } from '../lib/query/query-keys';
import { eventInstant } from '../lib/event/event-instant';
import type { Scoped, ProfileError } from '../api/scoped-types';
import type { EventData, ProfileId } from '../api/types';

export interface UseScopedEventsOptions {
  /** Base filters, applied identically to every profile in scope - the same
   *  object the caller's single-profile query passes as `filters`. */
  filters: EventFilters;
  /** Shared page size fanned to every profile (v1, see paging note below). */
  limit: number;
  monitorId?: string;
  isGroupFilterActive: boolean;
  eventIds?: string[];
  tagIds?: string[];
  /** Whether the queries are enabled (default: true) */
  enabled?: boolean;
  /** Refetch interval in ms. Undefined (default) means no polling - the
   *  caller opts in explicitly, e.g. with a bandwidth-settings field. */
  refetchInterval?: number;
}

export interface UseScopedEventsReturn {
  /** Events across all profiles, sorted descending by true absolute instant */
  events: Scoped<EventData>[];
  /** One entry per profile whose query failed */
  errors: ProfileError[];
  /** True only while NO profile has data yet */
  isLoading: boolean;
  /** Refetch exactly one profile's query */
  refetchProfile: (id: ProfileId) => void;
}

export function useScopedEvents(options: UseScopedEventsOptions): UseScopedEventsReturn {
  const scope = useProfileScope();
  const queryClient = useQueryClient();
  const profiles = scope?.profiles ?? [];
  const { filters, limit, monitorId, isGroupFilterActive, eventIds, tagIds, enabled, refetchInterval } = options;

  // combine is the only useQueries path that gets reference-stable output -
  // see useScopedMonitors.ts for the full rationale (QueriesObserver diffs
  // combine's OUTPUT with replaceEqualDeep and reuses old references for
  // unchanged sub-trees; without it every poll tick would produce brand-new
  // array identities even when the underlying data hasn't changed).
  const { events, errors, isLoading } = useQueries({
    queries: profiles.map((p) => ({
      queryKey: queryKeys.eventsList(p.id, filters, limit, monitorId, isGroupFilterActive, eventIds, tagIds),
      queryFn: () =>
        getEvents(getSession(p.id).client, p.id, {
          ...filters,
          monitorId,
          eventIds,
          tagIds,
          limit,
        }),
      // A profile in scope always gets an enabled query, whether or not it
      // has ever bootstrapped/authenticated this session - see
      // useScopedMonitors.ts for why (the API client self-heals via its own
      // proactiveLogin path; a real auth failure still surfaces as this
      // profile's ProfileError). Refs #337.
      enabled: enabled ?? true,
      // Opt-in only - see the module doc comment. When the caller does pass
      // one, ponytail: plain shared interval for v1, same tradeoff
      // useScopedMonitors documents for monitorStatusInterval; upgrade to a
      // per-query offset scheduler together with it (W8/Task 7) if N-profile
      // refetches land as a synchronized burst in the field.
      refetchInterval,
    })),
    combine: (results) => {
      // Owning profile's timezone for eventInstant - falls back to 'UTC'
      // exactly like getSession does, so an untimezoned profile still sorts
      // deterministically instead of throwing.
      const timezoneById = new Map(profiles.map((p) => [p.id, p.timezone ?? 'UTC']));

      const events: Scoped<EventData>[] = [];
      const errors: ProfileError[] = [];
      let anyHasData = false;

      profiles.forEach((p, i) => {
        const q = results[i];
        if (!q) return;
        if (q.data) {
          anyHasData = true;
          for (const item of q.data.events) {
            events.push({ profileId: p.id, profileName: p.name, item });
          }
        }
        if (q.error) {
          errors.push({ profileId: p.id, profileName: p.name, error: q.error });
        }
      });

      // ponytail: v1 paging is one shared page/limit fanned to every profile
      // and merged client-side (up to N-profiles * limit items in memory,
      // sorted by true instant). A per-profile cursor that advances only the
      // profiles whose slice is exhausted ("load more") is the natural
      // upgrade if that becomes visible with more than a couple of profiles
      // in scope.
      events.sort((a, b) => {
        const aInstant = eventInstant(a.item, timezoneById.get(a.profileId) ?? 'UTC');
        const bInstant = eventInstant(b.item, timezoneById.get(b.profileId) ?? 'UTC');
        return bInstant - aInstant;
      });

      return { events, errors, isLoading: !anyHasData };
    },
  });

  // Keyed refetch instead of indexing into useQueries' per-render array -
  // exact query key match refetches precisely that profile, independent of
  // combine's shape.
  const refetchProfile = useCallback(
    (id: ProfileId): void => {
      void queryClient.refetchQueries({
        queryKey: queryKeys.eventsList(id, filters, limit, monitorId, isGroupFilterActive, eventIds, tagIds),
        exact: true,
      });
    },
    [queryClient, filters, limit, monitorId, isGroupFilterActive, eventIds, tagIds]
  );

  return { events, errors, isLoading, refetchProfile };
}
