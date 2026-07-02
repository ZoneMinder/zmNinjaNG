/**
 * Trash button that opens a confirm dialog and deletes a ZoneMinder event.
 * Used by both the compact recent-events row and the full EventCard. Click
 * propagation is stopped so it never triggers the parent row/card navigation.
 */
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { useDeleteEvent } from '../../hooks/useDeleteEvent';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';

interface EventDeleteButtonProps {
  eventId: string;
  eventName: string;
  monitorName?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function EventDeleteButton({ eventId, eventName, monitorName, size = 'md', className }: EventDeleteButtonProps) {
  const { t } = useTranslation();
  const { deleteEvent, isDeleting } = useDeleteEvent();
  const [open, setOpen] = useState(false);
  const iconSize = size === 'sm' ? 'h-4 w-4' : 'h-4 w-4 sm:h-5 sm:w-5';

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          'p-1 rounded-full hover:bg-accent transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          className
        )}
        aria-label={t('events.delete_aria')}
        title={t('events.delete_aria')}
        data-testid="event-delete-button"
      >
        <Trash2 className={cn(iconSize, 'stroke-muted-foreground hover:stroke-destructive transition-colors')} />
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent data-testid="event-delete-dialog" onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('events.delete_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('events.delete_confirm_desc', { id: eventId, monitor: monitorName ?? eventName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="event-delete-cancel">{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async (e) => {
                e.stopPropagation();
                await deleteEvent(eventId);
                setOpen(false);
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="event-delete-confirm"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
