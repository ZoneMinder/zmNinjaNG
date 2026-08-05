/**
 * The owning-server label that rides beside a monitor, an event or a menu
 * entry in All Servers mode, where the same monitor name or event id can come
 * from two different servers.
 *
 * One component rather than the same class string copied into every surface
 * that shows it (C1): the four copies it replaces had already started to
 * drift, and a chip that looks different in the kebab menu than on the tile it
 * controls reads as two different things.
 *
 * Each caller keeps its own `testId`, since the e2e suites assert per surface.
 *
 * NotificationHistoryItem's own profile chip is deliberately NOT one of these:
 * it is an outline `Badge` sized for a wider row (`max-w-[8rem]`), not a fifth
 * copy of the span below, so leave it where it is.
 */

import { cn } from '../../lib/utils';

interface ProfileChipProps {
  /** Server label to show. Also the `title`, since the text truncates. */
  name: string;
  testId: string;
  /** Layout-only additions, e.g. the menu entry's leading gap. */
  className?: string;
}

export function ProfileChip({ name, testId, className }: ProfileChipProps) {
  return (
    <span
      className={cn(
        'text-[9px] px-1 py-0 h-4 rounded bg-muted text-muted-foreground truncate max-w-[72px] shrink-0',
        className
      )}
      title={name}
      data-testid={testId}
    >
      {name}
    </span>
  );
}
