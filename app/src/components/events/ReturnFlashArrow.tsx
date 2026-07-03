/**
 * Blinking marker for the event a user just returned from: a solid down
 * triangle at the top-center of the thumbnail, pointing down at the row.
 * Decorative (aria-hidden); the blink is gated motion-safe so reduced motion
 * shows it static (refs #213). The parent thumbnail container must be
 * positioned (relative).
 */
import { Triangle } from 'lucide-react';
import { cn } from '../../lib/utils';

export function ReturnFlashArrow({ className }: { className?: string }) {
  return (
    <Triangle
      aria-hidden
      data-testid="return-flash-indicator"
      className={cn(
        'pointer-events-none absolute left-1/2 top-0.5 z-20 h-4 w-4 -translate-x-1/2 rotate-180 fill-primary text-primary drop-shadow motion-safe:animate-blink',
        className
      )}
    />
  );
}
