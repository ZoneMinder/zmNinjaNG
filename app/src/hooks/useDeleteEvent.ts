/**
 * Delete a ZoneMinder event with query invalidation and toasts.
 * Invalidates the events list, the single-event query, and any
 * monitorRecentEvents query so the monitor-detail recent list refreshes.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { deleteEvent as apiDeleteEvent } from '../api/events';
import { log, LogLevel } from '../lib/logger';

export function useDeleteEvent(): {
  deleteEvent: (eventId: string) => Promise<void>;
  isDeleting: boolean;
} {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = useState(false);

  const deleteEvent = async (eventId: string) => {
    setIsDeleting(true);
    try {
      await apiDeleteEvent(eventId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['events'] }),
        queryClient.invalidateQueries({ queryKey: ['event', eventId] }),
        queryClient.invalidateQueries({
          predicate: (q) => q.queryKey.includes('monitorRecentEvents'),
        }),
      ]);
      toast.success(t('events.delete_success'));
    } catch (err) {
      log.eventCard('Delete event failed', LogLevel.ERROR, { eventId, error: err });
      toast.error(t('events.delete_failed'));
    } finally {
      setIsDeleting(false);
    }
  };

  return { deleteEvent, isDeleting };
}
