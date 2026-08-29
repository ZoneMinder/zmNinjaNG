/**
 * Query State Views
 *
 * Shared presentational pieces for React Query loading/error states:
 * an error banner (icon + message in a destructive-tinted box) and the
 * loading skeleton shared by the monitor and event detail pages.
 */

import type { ReactNode } from 'react';
import { AlertCircle, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ErrorBannerProps {
  /** Message to display next to the icon. Can be a plain string or JSX. */
  message: ReactNode;
  /** Icon component (from lucide-react). Defaults to AlertCircle. */
  icon?: LucideIcon;
  /** Extra classes merged onto the banner container. */
  className?: string;
}

/** Icon + message banner for a failed query, styled as a destructive box. */
export function ErrorBanner({ message, icon: Icon = AlertCircle, className }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className={cn('p-4 bg-destructive/10 text-destructive rounded-lg flex items-center gap-2', className)}
    >
      <Icon className="h-5 w-5" />
      {message}
    </div>
  );
}

/** Loading skeleton shared by MonitorDetail and EventDetail while their query is pending. */
export function DetailPageSkeleton() {
  return (
    <div className="p-8 space-y-6">
      <div className="h-8 w-32 bg-muted rounded animate-pulse" />
      <div className="aspect-video w-full max-w-4xl bg-muted rounded-xl animate-pulse" />
    </div>
  );
}
