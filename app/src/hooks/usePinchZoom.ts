/**
 * Pinch-to-Zoom Hook
 *
 * Detects pinch gestures for zooming in/out on images or content.
 * Features:
 * - Two-finger pinch detection
 * - Smooth scale animation
 * - Min/max scale limits
 * - Reset to original scale
 */

import { useState } from 'react';
import { usePinch } from '@use-gesture/react';

interface UsePinchZoomOptions {
  minScale?: number;
  maxScale?: number;
  initialScale?: number;
  enabled?: boolean;
  onScaleChange?: (scale: number) => void;
}

export function usePinchZoom({
  minScale = 0.5,
  maxScale = 3,
  initialScale = 1,
  enabled = true,
  onScaleChange,
}: UsePinchZoomOptions = {}) {
  const [scale, setScale] = useState(initialScale);
  const [isPinching, setIsPinching] = useState(false);

  const bind = usePinch(
    ({ offset: [d], first, last }) => {
      if (!enabled) return;

      if (first) {
        setIsPinching(true);
      }

      // Calculate new scale based on pinch distance
      const newScale = Math.max(minScale, Math.min(maxScale, initialScale + d / 200));
      setScale(newScale);
      onScaleChange?.(newScale);

      if (last) {
        setIsPinching(false);
      }
    },
    {
      scaleBounds: { min: minScale, max: maxScale },
      rubberband: true,
    }
  );

  const resetScale = () => {
    setScale(initialScale);
    onScaleChange?.(initialScale);
  };

  return {
    bind,
    scale,
    isPinching,
    resetScale,
    minScale,
    maxScale,
  };
}
