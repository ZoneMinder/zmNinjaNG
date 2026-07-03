/**
 * Blinking marker for the event a user just returned from: a solid down
 * triangle at the top-center edge of the row, pointing down at it. Decorative
 * (aria-hidden); the blink is gated motion-safe so reduced motion shows it
 * static (refs #213). The parent row/card must be positioned (relative).
 */
import { Triangle } from 'lucide-react';
import { cn } from '../../lib/utils';

export function ReturnFlashArrow({ className }: { className?: string }) {
  return (
    <Triangle
      aria-hidden
      data-testid="return-flash-indicator"
      className={cn(
        'pointer-events-none absolute left-1/2 top-0 z-20 h-4 w-4 -translate-x-1/2 rotate-180 fill-primary text-primary drop-shadow-md motion-safe:animate-blink',
        className
      )}
    />
  );
}
