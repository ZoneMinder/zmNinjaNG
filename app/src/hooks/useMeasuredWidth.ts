/**
 * Measured width of one element, for layout a page has to compute in pixels.
 *
 * Wraps montage's useContainerResize, which owns the ResizeObserver lifecycle
 * and debounces every measurement after the first by
 * GRID_LAYOUT.resizeDebounceMs, and adds the two things a page consuming the
 * width needs: the width in state, rounded, and a callback ref that also
 * mirrors the element into a ref other hooks read.
 *
 * Rounding matters as much as the debounce. A drag produces sub-pixel widths,
 * and an unrounded value would re-render every child on the page for a change
 * none of them can render.
 */

import { useCallback, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useContainerResize } from '../components/montage/hooks/useContainerResize';

interface UseMeasuredWidthReturn {
  /** Rounded element width in pixels, 0 until the first measurement lands. */
  width: number;
  /** Ref to put on the element to measure. Stable across renders. */
  setElement: (element: HTMLDivElement | null) => void;
}

export function useMeasuredWidth(
  mirrorToRef?: RefObject<HTMLDivElement | null>
): UseMeasuredWidthReturn {
  const widthRef = useRef(0);
  const [width, setWidth] = useState(0);

  const handleWidth = useCallback((measured: number) => {
    widthRef.current = measured;
    setWidth(Math.round(measured));
  }, []);

  const { containerRef: observe } = useContainerResize({
    onWidthChange: handleWidth,
    currentWidthRef: widthRef,
  });

  // One stable callback: an inline ref would be a new function every render,
  // so a page that re-renders on a timer would tear the observer down and
  // rebuild it on every tick.
  const setElement = useCallback(
    (element: HTMLDivElement | null) => {
      if (mirrorToRef) mirrorToRef.current = element;
      observe(element);
    },
    [observe, mirrorToRef]
  );

  return { width, setElement };
}
