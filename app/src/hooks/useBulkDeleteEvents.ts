/**
 * Delete several ZoneMinder events at once (refs #213). Takes the composite
 * selection keys the delete-selection store holds and groups them by owning
 * profile, so every delete goes to the server the event actually lives on
 * (Sessions contract). All mode makes the ALL sentinel the current profile,
 * which has no session - resolving one client up front via getCurrentSession
 * threw there and left the confirm handler with an unhandled rejection, no
 * toast and the selection intact (refs #337).
 *
 * Uses Promise.allSettled per profile so one failure does not abort the rest,
 * and never rejects: a failure surfaces as the same error toast single mode
 * has always shown. Removes the deleted events from the OWNING profile's
 * events / monitorRecentEvents caches immediately (so the list updates even
 * if the server is briefly slow to drop them) and invalidates that profile's
 * keys to reconcile. Returns the selection keys that were actually deleted so
 * a partial failure leaves the survivors selected.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { deleteEvent as apiDeleteEvent } from '../api/events';
import { getSession } from '../services/sessions';
import type { EventData, EventsResponse, ProfileId } from '../api/types';
import { queryKeys } from '../lib/query/query-keys';
import { parseEventSelectionKey } from '../stores/deleteSelection';
import { useCurrentProfile } from './useCurrentProfile';
import { log, LogLevel } from '../lib/logger';

/** Drop the given event ids from any cached events-list response. */
function removeFromEventsCache(old: unknown, deleted: Set<string>): unknown {
  const data = old as EventsResponse | undefined;
  if (!data || !Array.isArray(data.events)) return old;
  return { ...data, events: data.events.filter((e: EventData) => !deleted.has(e.Event.Id)) };
}

/**
 * Events-list caches owned by one profile. Both key factories put the profile
 * id at index 1 (lib/query/query-keys.ts), so matching on it keeps profile B's
 * identically numbered event out of profile A's deletion.
 */
function isEventListQueryFor(queryKey: readonly unknown[], profileId: ProfileId): boolean {
  return (queryKey[0] === 'events' || queryKey[0] === 'monitorRecentEvents') && queryKey[1] === profileId;
}

interface OwnedEvent {
  /** The store's selection key, returned to the caller when the delete lands. */
  key: string;
  eventId: string;
}

/** @param profileId - Owning profile for an /all/ deep route; defaults to the current profile. */
export function useBulkDeleteEvents(profileId?: ProfileId): {
  /** @returns the selection keys whose events were deleted (possibly a subset). */
  deleteEvents: (selectionKeys: string[]) => Promise<string[]>;
  isDeleting: boolean;
} {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { currentProfile } = useCurrentProfile();
  const effectiveProfileId = profileId ?? currentProfile?.id;
  const [isDeleting, setIsDeleting] = useState(false);

  const deleteEvents = async (selectionKeys: string[]) => {
    if (selectionKeys.length === 0) return [];
    setIsDeleting(true);
    try {
      // Group by owning profile. A bare key predates All mode (or came from a
      // caller with no profile in hand), so it belongs to the current profile.
      const byProfile = new Map<ProfileId, OwnedEvent[]>();
      let failed = 0;
      for (const key of selectionKeys) {
        const { profileId: owner, eventId } = parseEventSelectionKey(key);
        const target = owner ?? effectiveProfileId;
        if (!target) {
          failed += 1;
          continue;
        }
        const owned = byProfile.get(target);
        if (owned) owned.push({ key, eventId });
        else byProfile.set(target, [{ key, eventId }]);
      }

      const deletedKeys: string[] = [];
      await Promise.all(
        [...byProfile].map(async ([owner, events]) => {
          let client;
          try {
            client = getSession(owner).client;
          } catch (err) {
            log.eventCard('Bulk delete: no session for profile', LogLevel.ERROR, { profileId: owner, error: err });
            failed += events.length;
            return;
          }

          const results = await Promise.allSettled(events.map((e) => apiDeleteEvent(client, e.eventId)));
          const deleted = events.filter((_, i) => results[i].status === 'fulfilled');
          failed += events.length - deleted.length;
          deletedKeys.push(...deleted.map((e) => e.key));
          if (deleted.length === 0) return;

          // The server has already dropped these events. A cache failure must
          // not unsay that: reporting them as not deleted would leave them
          // queued and every retry would 404 forever. Log and move on.
          try {
            const deletedIds = new Set(deleted.map((e) => e.eventId));
            queryClient.setQueriesData(
              { predicate: (q) => isEventListQueryFor(q.queryKey, owner) },
              (old) => removeFromEventsCache(old, deletedIds)
            );
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: queryKeys.events(owner) }),
              ...deleted.map((e) =>
                queryClient.invalidateQueries({ queryKey: queryKeys.event(owner, e.eventId) })),
              queryClient.invalidateQueries({
                predicate: (q) => q.queryKey[0] === 'monitorRecentEvents' && q.queryKey[1] === owner,
              }),
            ]);
          } catch (err) {
            log.eventCard('Bulk delete: cache update failed after a successful delete', LogLevel.ERROR, { profileId: owner, error: err });
          }
        })
      );

      if (failed > 0) {
        log.eventCard('Bulk delete had failures', LogLevel.ERROR, { failed, total: selectionKeys.length });
        toast.error(t('events.delete_failed'));
      } else {
        toast.success(t('events.delete_selected_success', { count: deletedKeys.length }));
      }
      return deletedKeys;
    } catch (err) {
      // A destructive action must never leave the user with a silent failure.
      log.eventCard('Bulk delete failed', LogLevel.ERROR, { error: err });
      toast.error(t('events.delete_failed'));
      return [];
    } finally {
      setIsDeleting(false);
    }
  };

  return { deleteEvents, isDeleting };
}
