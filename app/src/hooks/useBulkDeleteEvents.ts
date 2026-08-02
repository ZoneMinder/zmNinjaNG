/**
 * Delete several ZoneMinder events at once (refs #213). Uses Promise.allSettled
 * so one failure does not abort the rest. Removes the deleted events from the
 * events / monitorRecentEvents caches immediately (so the list updates even if
 * the server is briefly slow to drop them), invalidates to reconcile, and
 * toasts a count (or a failure).
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { deleteEvent as apiDeleteEvent } from '../api/events';
import { getCurrentSession } from '../services/sessions';
import type { EventData, EventsResponse } from '../api/types';
import { queryKeys } from '../lib/query/query-keys';
import { useCurrentProfile } from './useCurrentProfile';
import { log, LogLevel } from '../lib/logger';

/** Drop the given event ids from any cached events-list response. */
function removeFromEventsCache(old: unknown, deleted: Set<string>): unknown {
  const data = old as EventsResponse | undefined;
  if (!data || !Array.isArray(data.events)) return old;
  return { ...data, events: data.events.filter((e: EventData) => !deleted.has(e.Event.Id)) };
}

export function useBulkDeleteEvents(): {
  deleteEvents: (eventIds: string[]) => Promise<void>;
  isDeleting: boolean;
} {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { currentProfile } = useCurrentProfile();
  const [isDeleting, setIsDeleting] = useState(false);

  const deleteEvents = async (eventIds: string[]) => {
    if (eventIds.length === 0) return;
    setIsDeleting(true);
    try {
      const client = getCurrentSession().client;
      const results = await Promise.allSettled(eventIds.map((id) => apiDeleteEvent(client, id)));
      const failed = results.filter((r) => r.status === 'rejected').length;

      // Remove the successfully deleted events from cached lists right away so
      // the UI reflects the deletion immediately, then invalidate to reconcile.
      const deletedIds = new Set(
        eventIds.filter((_, i) => results[i].status === 'fulfilled')
      );
      queryClient.setQueriesData(
        {
          predicate: (q) =>
            q.queryKey[0] === 'events' || q.queryKey.includes('monitorRecentEvents'),
        },
        (old) => removeFromEventsCache(old, deletedIds)
      );

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.events(currentProfile?.id) }),
        ...eventIds.map((id) =>
          queryClient.invalidateQueries({ queryKey: queryKeys.event(currentProfile?.id, id) })),
        queryClient.invalidateQueries({
          predicate: (q) => q.queryKey.includes('monitorRecentEvents'),
        }),
      ]);
      if (failed > 0) {
        log.eventCard('Bulk delete had failures', LogLevel.ERROR, { failed, total: eventIds.length });
        toast.error(t('events.delete_failed'));
      } else {
        toast.success(t('events.delete_selected_success', { count: eventIds.length }));
      }
    } finally {
      setIsDeleting(false);
    }
  };

  return { deleteEvents, isDeleting };
}
