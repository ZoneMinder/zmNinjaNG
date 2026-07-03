/**
 * Blinking marker for the event a user just returned from: a small solid down
 * triangle centered just above the thumbnail, pointing down at it. Decorative
 * (aria-hidden); the blink is gated motion-safe so reduced motion shows it
 * static (refs #213). The parent (a non-clipping wrapper around the thumbnail)
 * must be positioned (relative).
 */
import { Triangle } from 'lucide-react';
import { cn } from '../../lib/utils';

export function ReturnFlashArrow({ className }: { className?: string }) {
  return (
    <Triangle
      aria-hidden
      data-testid="return-flash-indicator"
      className={cn(
        'pointer-events-none absolute left-1/2 -top-1.5 z-20 h-3 w-3 -translate-x-1/2 rotate-180 fill-primary text-primary drop-shadow motion-safe:animate-blink',
        className
      )}
    />
  );
}
