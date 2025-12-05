/**
 * Swipe Navigation Hook
 *
 * Detects horizontal swipe gestures to navigate between items.
 * Features:
 * - Left/right swipe detection
 * - Configurable threshold
 * - Visual feedback during swipe
 * - Callbacks for prev/next navigation
 */

import { useState, useRef } from 'react';
import { useDrag } from '@use-gesture/react';

interface UseSwipeNavigationOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  threshold?: number;
  enabled?: boolean;
}

export function useSwipeNavigation({
  onSwipeLeft,
  onSwipeRight,
  threshold = 50,
  enabled = true,
}: UseSwipeNavigationOptions) {
  const [isSwiping, setIsSwiping] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);
  const swipeDistance = useRef(0);

  const bind = useDrag(
    ({ movement: [mx], direction: [xDir], last, velocity: [vx] }) => {
      if (!enabled) return;

      swipeDistance.current = mx;

      if (!last) {
        // During drag
        setIsSwiping(true);
        if (Math.abs(mx) > 10) {
          setSwipeDirection(mx > 0 ? 'right' : 'left');
        }
      } else {
        // End of drag
        setIsSwiping(false);
        setSwipeDirection(null);

        // Check if swipe was strong enough
        const didSwipe = Math.abs(mx) > threshold || vx > 0.5;

        if (didSwipe) {
          if (xDir > 0 && onSwipeRight) {
            onSwipeRight();
          } else if (xDir < 0 && onSwipeLeft) {
            onSwipeLeft();
          }
        }

        swipeDistance.current = 0;
      }
    },
    {
      axis: 'x',
      filterTaps: true,
      pointer: { touch: true },
    }
  );

  return {
    bind,
    isSwiping,
    swipeDirection,
    swipeDistance: swipeDistance.current,
    threshold,
  };
}
