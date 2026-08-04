/**
 * useScopedEventTags Hook
 *
 * Event tags across the active profile scope (see useProfileScope): one
 * profile in single mode, every profile in All mode. Tags are per-server
 * entities, and so are the event ids they hang off, so this fans out one
 * query per profile - each asking only for the event ids that profile owns -
 * and keys the merged result by `${profileId}:${eventId}` (scopedEventKey).
 *
 * Before this, the Events page and the Timeline both called the
 * single-profile useEventTagMapping, whose queryFn resolves getCurrentSession()
 * - undefined for the ALL sentinel - so both simply disabled the query in All
 * mode and every row rendered with no tags at all (refs #337, audit D4).
 *
 * Query keys match queryKeys.eventTags(profileId, sortedEventIds) exactly, the
 * key useEventTagMapping already writes, so single mode shares that cache
 * entry instead of double-fetching. A profile whose fetch fails contributes no
 * tags while the others still render theirs; tags are decoration, so there is
 * no error surface here.
 */

import { useCallback, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { getTags, getEventTags, extractUniqueTags } from '../api/tags';
import { getSession } from '../services/sessions';
import { useProfileScope } from './useProfileScope';
import { queryKeys } from '../lib/query/query-keys';
import { scopedEventKey } from '../lib/event/scoped-event-key';
import type { Tag, ProfileId } from '../api/types';

/** One event, with the profile that owns it. */
export interface ScopedEventRef {
  profileId: ProfileId;
  eventId: string;
}

export interface UseScopedTagsReturn {
  /**
   * The tag list the filter UI offers. Single mode: that profile's own tags,
   * unchanged. All mode: one entry per distinct tag NAME across every profile
   * in scope, with the name standing in for `Id`.
   *
   * Tag ids are per-server and collide, so a shared id means nothing across
   * two servers - but users think in names ("person"), and a "person" tag on
   * one server means the same thing as a "person" tag on another. The name is
   * therefore the aggregate token: it is what the popover selects, what the
   * ALL settings bucket persists, and what `resolveOwnTagIds` maps back to
   * each profile's real ids before a query runs (refs #337, audit D4). Same
   * shape as the All-mode monitor filter's composite tokens.
   */
  availableTags: Tag[];
  /** True when at least one profile in scope answered the tags endpoint. */
  tagsSupported: boolean;
  isLoadingTags: boolean;
  /** Selected tokens resolved to one profile's own tag ids (see above). */
  resolveOwnTagIds: (tokens: string[], profileId: ProfileId) => string[];
}

export function useScopedTags(): UseScopedTagsReturn {
  const scope = useProfileScope();
  const profiles = scope?.profiles ?? [];
  const isAllMode = scope?.mode === 'all';

  const { tagEntries, availableTags, tagsSupported, isLoadingTags } = useQueries({
    queries: profiles.map((p) => ({
      queryKey: queryKeys.tags(p.id),
      queryFn: () => getTags(getSession(p.id).client),
      // Tags list rarely changes, use longer stale time - same as the
      // single-profile hook, whose cache slot this shares.
      staleTime: 5 * 60 * 1000,
      retry: 1,
    })),
    // Returns plain arrays, never a Map: QueriesObserver deep-diffs this
    // output with replaceEqualDeep, which only reuses references for plain
    // arrays and objects. A Map comes back brand new on every render, and
    // combine re-runs every render, so anything memoized on it would recompute
    // forever. The Maps are built once in useMemo below instead.
    combine: (results) => {
      const tagEntries: Array<[ProfileId, Tag[]]> = [];
      // Insertion order is profile order, so the offered list is stable and
      // the first server to define a name owns the row's position.
      const byName = new Map<string, Tag>();
      let tagsSupported = false;

      profiles.forEach((p, i) => {
        const data = results[i]?.data;
        if (!data) return;
        tagsSupported = true;
        const tags = extractUniqueTags(data);
        tagEntries.push([p.id, tags]);
        for (const tag of tags) {
          if (!byName.has(tag.Name)) byName.set(tag.Name, { ...tag, Id: tag.Name });
        }
      });

      return {
        tagEntries,
        availableTags: isAllMode
          ? Array.from(byName.values())
          : (tagEntries.find(([id]) => id === profiles[0]?.id)?.[1] ?? []),
        tagsSupported,
        isLoadingTags: results.some((r) => r?.isLoading),
      };
    },
  });

  const tagsByProfile = useMemo(() => new Map(tagEntries), [tagEntries]);

  const resolveOwnTagIds = useCallback(
    (tokens: string[], profileId: ProfileId): string[] => {
      // Single mode's tokens ARE that profile's tag ids already.
      if (!isAllMode) return tokens;
      const own = tagsByProfile.get(profileId) ?? [];
      const wanted = new Set(tokens);
      return own.filter((tag) => wanted.has(tag.Name)).map((tag) => tag.Id);
    },
    [isAllMode, tagsByProfile]
  );

  return { availableTags, tagsSupported, isLoadingTags, resolveOwnTagIds };
}

export interface UseScopedEventTagMappingOptions {
  /** Displayed events, each tagged with its owning profile. */
  events: ScopedEventRef[];
  /** Whether the queries are enabled (default: true) */
  enabled?: boolean;
}

export interface UseScopedEventTagMappingReturn {
  /**
   * eventId -> Tag[] in single mode, `${profileId}:${eventId}` -> Tag[] in All
   * mode. The key mirrors what a row carries: single-mode rows have no
   * profileId, so their lookups stay bare-keyed exactly as before.
   */
  eventTagMap: Map<string, Tag[]>;
  /** Tags for one event on one server; empty when that profile has none. */
  getTagsForEvent: (profileId: ProfileId | undefined, eventId: string) => Tag[];
}

export function useScopedEventTagMapping(
  options: UseScopedEventTagMappingOptions
): UseScopedEventTagMappingReturn {
  const scope = useProfileScope();
  const profiles = scope?.profiles ?? [];
  const isAllMode = scope?.mode === 'all';
  const { events, enabled = true } = options;

  // Event ids grouped by owner, deduped and sorted so the same displayed set
  // produces the same cache key regardless of the order rows arrived in.
  const idsByProfile = useMemo(() => {
    const grouped = new Map<ProfileId, Set<string>>();
    for (const e of events) {
      const own = grouped.get(e.profileId);
      if (own) own.add(e.eventId);
      else grouped.set(e.profileId, new Set([e.eventId]));
    }
    return new Map(Array.from(grouped, ([id, ids]) => [id, Array.from(ids).sort()]));
  }, [events]);

  // combine returns entry ARRAYS, not a Map, for the reason spelled out in
  // useScopedTags above: replaceEqualDeep stabilizes plain arrays/objects
  // only. The Map is assembled once in useMemo below, so its identity changes
  // only when the underlying tags actually do - Events.tsx keys its row-object
  // memo on it, and a churning identity remints every row and defeats
  // memo(EventItem) for every card.
  const tagEntries = useQueries({
    queries: profiles.map((p) => {
      const eventIds = idsByProfile.get(p.id) ?? [];
      return {
        queryKey: queryKeys.eventTags(p.id, eventIds),
        queryFn: () => getEventTags(getSession(p.id).client, eventIds),
        // A profile with nothing on screen has nothing to look up. Note this
        // is the ONLY gate: unlike the single-profile hook there is no
        // isAuthenticated check, because the API client self-heals an
        // unauthenticated request through proactiveLogin and gating on it
        // left an untouched profile's rows permanently tagless (refs #337).
        enabled: enabled && eventIds.length > 0,
        // Event tags change when tags are assigned; moderate stale time, same
        // as the single-profile hook.
        staleTime: 2 * 60 * 1000,
        retry: 1,
      };
    }),
    combine: (results) => {
      const merged: Array<[string, Tag[]]> = [];
      profiles.forEach((p, i) => {
        // null means "this server does not support tags"; an error means it
        // failed. Either way the other profiles' tags still render.
        const data = results[i]?.data;
        if (!data) return;
        for (const [eventId, tags] of data) {
          merged.push([scopedEventKey(isAllMode ? p.id : undefined, eventId), tags]);
        }
      });
      return merged;
    },
  });

  const eventTagMap = useMemo(() => new Map(tagEntries), [tagEntries]);

  const getTagsForEvent = useCallback(
    (profileId: ProfileId | undefined, eventId: string): Tag[] =>
      eventTagMap.get(scopedEventKey(profileId, eventId)) ?? [],
    [eventTagMap]
  );

  return { eventTagMap, getTagsForEvent };
}
