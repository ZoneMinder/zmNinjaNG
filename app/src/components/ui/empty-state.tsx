/**
 * Empty State Component
 *
 * Reusable component for displaying empty states with icon, message, and optional action.
 * Used across pages when no data is available (no events, no monitors, etc.)
 */

import { Button } from './button';
import type { LucideIcon } from 'lucide-react';

export interface EmptyStateProps {
  /** Icon component to display (from lucide-react) */
  icon: LucideIcon;
  /** Main title/message */
  title: string;
  /** Optional description text */
  description?: string;
  /** Optional action button */
  action?: {
    label: string;
    onClick: () => void;
    variant?: 'default' | 'outline' | 'link';
  };
  /** Custom className for the container */
  className?: string;
}

/**
 * Displays an empty state with icon, message, and optional action button.
 *
 * @example
 * ```typescript
 * <EmptyState
 *   icon={Video}
 *   title={t('events.no_events')}
 *   description={t('events.try_adjusting_filters')}
 *   action={{
 *     label: t('events.clear_filters'),
 *     onClick: clearFilters,
 *     variant: 'link'
 *   }}
 * />
 * ```
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = 'text-center py-20 text-muted-foreground',
}: EmptyStateProps) {
  return (
    <div className={className}>
      <Icon className="h-12 w-12 mx-auto mb-4 opacity-20" />
      <p className="text-base">{title}</p>
      {description && <p className="text-sm mt-2">{description}</p>}
      {action && (
        <Button
          variant={action.variant || 'link'}
          onClick={action.onClick}
          className="mt-4"
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
