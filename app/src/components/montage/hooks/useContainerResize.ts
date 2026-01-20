/**
 * Hook for container resize observation
 *
 * Uses ResizeObserver to track container width changes.
 */

import { useCallback, useRef } from 'react';

interface UseContainerResizeOptions {
  onWidthChange: (width: number) => void;
  currentWidthRef: React.MutableRefObject<number>;
}

interface UseContainerResizeReturn {
  containerRef: (element: HTMLDivElement | null) => void;
}

export function useContainerResize({
  onWidthChange,
  currentWidthRef,
}: UseContainerResizeOptions): UseContainerResizeReturn {
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const containerRef = useCallback(
    (element: HTMLDivElement | null) => {
      // Clean up previous observer
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }

      if (!element) return;

      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const width = entry.contentRect.width;
          if (width > 0 && currentWidthRef.current !== width) {
            onWidthChange(width);
          }
        }
      });

      observer.observe(element);
      resizeObserverRef.current = observer;
    },
    [onWidthChange, currentWidthRef]
  );

  return { containerRef };
}
