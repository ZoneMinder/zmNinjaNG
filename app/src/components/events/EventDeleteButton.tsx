/**
 * Trash toggle that queues/unqueues a ZoneMinder event for bulk deletion
 * (refs #213). Used by the compact recent-events row and the full EventCard.
 * Click propagation is stopped so it never triggers the parent row navigation.
 */
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { useDeleteSelectionStore } from '../../stores/deleteSelection';
import { HintButton } from '../ui/button';

interface EventDeleteButtonProps {
  eventId: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function EventDeleteButton({ eventId, size = 'md', className }: EventDeleteButtonProps) {
  const { t } = useTranslation();
  const selected = useDeleteSelectionStore((s) => s.selectedIds.includes(eventId));
  const toggle = useDeleteSelectionStore((s) => s.toggle);
  const iconSize = size === 'sm' ? 'h-4 w-4' : 'h-4 w-4 sm:h-5 sm:w-5';

  return (
    <HintButton
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggle(eventId);
      }}
      className={cn(
        'p-1 rounded transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
      aria-label={t('events.delete_toggle_aria')}
      aria-pressed={selected}
      title={t('events.delete_toggle_aria')}
      data-testid="event-delete-button"
    >
      <Trash2
        className={cn(
          iconSize,
          'transition-colors',
          selected ? 'text-destructive' : 'stroke-muted-foreground hover:stroke-destructive'
        )}
      />
    </HintButton>
  );
}
