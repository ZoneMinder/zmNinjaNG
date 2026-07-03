/**
 * Blinking arrow pinned at the left edge of the event row a user just returned
 * from. Decorative (aria-hidden); the blink is gated motion-safe so reduced
 * motion shows it static (refs #213). The parent must be positioned (relative).
 */
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

export function ReturnFlashArrow({ className }: { className?: string }) {
  return (
    <ChevronRight
      aria-hidden
      data-testid="return-flash-indicator"
      className={cn(
        'pointer-events-none absolute left-0 top-1/2 z-20 -translate-y-1/2 h-6 w-6 rounded-full bg-background/70 p-0.5 text-primary shadow drop-shadow motion-safe:animate-blink',
        className
      )}
    />
  );
}
