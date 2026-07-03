/**
 * Delete several ZoneMinder events at once (refs #213). Uses Promise.allSettled
 * so one failure does not abort the rest, invalidates the events / single-event
 * / monitorRecentEvents queries, and toasts a count (or a failure).
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { deleteEvent as apiDeleteEvent } from '../api/events';
import { log, LogLevel } from '../lib/logger';

export function useBulkDeleteEvents(): {
  deleteEvents: (eventIds: string[]) => Promise<void>;
  isDeleting: boolean;
} {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = useState(false);

  const deleteEvents = async (eventIds: string[]) => {
    if (eventIds.length === 0) return;
    setIsDeleting(true);
    try {
      const results = await Promise.allSettled(eventIds.map((id) => apiDeleteEvent(id)));
      const failed = results.filter((r) => r.status === 'rejected').length;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['events'] }),
        ...eventIds.map((id) => queryClient.invalidateQueries({ queryKey: ['event', id] })),
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
