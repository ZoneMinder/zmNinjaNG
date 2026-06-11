/**
 * Timeline gesture handling hook.
 *
 * Attaches mouse and touch handlers to a canvas element, normalizing
 * all input into pan / zoom / hover / click callbacks for the parent.
 */

import { useRef, useEffect, type RefObject } from 'react';

export interface GestureCallbacks {
  onPan: (deltaPx: number) => void;
  onZoom: (factor: number, anchorNormX: number) => void;
  onHover: (x: number, y: number) => void;
  onHoverEnd: () => void;
  onClick: (x: number, y: number) => void;
  /** When true, drag selects a region instead of panning. */
  brushMode?: boolean;
  /** Drag-select zoom: called with normalized start/end (0–1) when user releases a brush selection. */
  onBrushZoom?: (startNorm: number, endNorm: number) => void;
  /** Called during brush drag with current selection bounds (norm) for overlay rendering, or null when not brushing. */
  onBrushUpdate?: (startNorm: number, endNorm: number) => void;
}

const CLICK_THRESHOLD_PX = 3;
const ZOOM_FACTOR = 1.15;

export function useTimelineGestures(callbacks: GestureCallbacks): RefObject<HTMLCanvasElement | null> {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';

    // --- shared drag state ---
    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let lastX = 0;
    let dragMoved = false;

    // --- brush (shift+drag) state ---
    let brushing = false;
    let brushStartNorm = 0;

    // --- pinch state ---
    let pinchDist = 0;
    let pinchMidNormX = 0;

    // Pending timer that clears the brush overlay after release
    let brushClearTimer: ReturnType<typeof setTimeout> | undefined;

    function scheduleBrushClear() {
      if (brushClearTimer !== undefined) clearTimeout(brushClearTimer);
      brushClearTimer = setTimeout(() => cbRef.current.onBrushUpdate?.(0, 0), 50);
    }

    function canvasRelative(clientX: number, clientY: number): { x: number; y: number } {
      const rect = canvas!.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    }

    function normX(clientX: number): number {
      const rect = canvas!.getBoundingClientRect();
      return (clientX - rect.left) / rect.width;
    }

    function touchDist(t1: Touch, t2: Touch): number {
      const dx = t2.clientX - t1.clientX;
      const dy = t2.clientY - t1.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    // --- mouse handlers ---

    function onMouseDown(e: MouseEvent) {
      if (e.button !== 0) return;

      // Brush mode (toggle button) or Shift+drag: select a region to zoom into
      if ((cbRef.current.brushMode || e.shiftKey) && cbRef.current.onBrushZoom) {
        brushing = true;
        brushStartNorm = normX(e.clientX);
        canvas!.style.cursor = 'col-resize';
        return;
      }

      dragging = true;
      dragMoved = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      lastX = e.clientX;
      canvas!.style.cursor = 'grabbing';
    }

    function onMouseMove(e: MouseEvent) {
      if (brushing) {
        const currentNorm = normX(e.clientX);
        const lo = Math.min(brushStartNorm, currentNorm);
        const hi = Math.max(brushStartNorm, currentNorm);
        cbRef.current.onBrushUpdate?.(lo, hi);
        return;
      }
      if (dragging) {
        const dx = e.clientX - lastX;
        lastX = e.clientX;
        const totalDx = e.clientX - dragStartX;
        const totalDy = e.clientY - dragStartY;
        if (Math.sqrt(totalDx * totalDx + totalDy * totalDy) >= CLICK_THRESHOLD_PX) {
          dragMoved = true;
        }
        cbRef.current.onPan(-dx);
      } else {
        const pos = canvasRelative(e.clientX, e.clientY);
        cbRef.current.onHover(pos.x, pos.y);
      }
    }

    function onMouseUp(e: MouseEvent) {
      if (brushing) {
        brushing = false;
        canvas!.style.cursor = 'grab';
        const endNorm = normX(e.clientX);
        const lo = Math.min(brushStartNorm, endNorm);
        const hi = Math.max(brushStartNorm, endNorm);
        cbRef.current.onBrushUpdate?.(lo, hi);
        // Only zoom if selection is meaningful (at least 1% of width)
        if (hi - lo > 0.01) {
          cbRef.current.onBrushZoom?.(lo, hi);
        }
        // Clear overlay after a short delay to let the zoom animation start
        scheduleBrushClear();
        return;
      }
      if (!dragging) return;
      dragging = false;
      canvas!.style.cursor = 'grab';
      if (!dragMoved) {
        const pos = canvasRelative(e.clientX, e.clientY);
        cbRef.current.onClick(pos.x, pos.y);
      }
    }

    function onMouseLeave() {
      if (brushing) {
        brushing = false;
        canvas!.style.cursor = 'grab';
        cbRef.current.onBrushUpdate?.(0, 0);
      }
      if (dragging) {
        dragging = false;
        canvas!.style.cursor = 'grab';
      }
      cbRef.current.onHoverEnd();
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const nX = normX(e.clientX);
      const factor = e.deltaY > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      cbRef.current.onZoom(factor, nX);
    }

    // --- touch handlers ---

    let touchStartX = 0;
    let touchStartY = 0;
    let touchLastX = 0;
    let touchMoved = false;

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 1) {
        // In brush mode, single-finger drag selects a region
        if (cbRef.current.brushMode && cbRef.current.onBrushZoom) {
          brushing = true;
          brushStartNorm = normX(e.touches[0].clientX);
          return;
        }
        dragging = true;
        touchMoved = false;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchLastX = e.touches[0].clientX;
      } else if (e.touches.length === 2) {
        dragging = false;
        brushing = false;
        cbRef.current.onBrushUpdate?.(0, 0);
        pinchDist = touchDist(e.touches[0], e.touches[1]);
        const midClientX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        pinchMidNormX = normX(midClientX);
      }
    }

    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
      if (brushing && e.touches.length === 1) {
        const currentNorm = normX(e.touches[0].clientX);
        const lo = Math.min(brushStartNorm, currentNorm);
        const hi = Math.max(brushStartNorm, currentNorm);
        cbRef.current.onBrushUpdate?.(lo, hi);
        return;
      }
      if (e.touches.length === 1 && dragging) {
        const dx = e.touches[0].clientX - touchLastX;
        touchLastX = e.touches[0].clientX;
        const totalDx = e.touches[0].clientX - touchStartX;
        const totalDy = e.touches[0].clientY - touchStartY;
        if (Math.sqrt(totalDx * totalDx + totalDy * totalDy) >= CLICK_THRESHOLD_PX) {
          touchMoved = true;
        }
        cbRef.current.onPan(-dx);
      } else if (e.touches.length === 2) {
        const newDist = touchDist(e.touches[0], e.touches[1]);
        if (pinchDist > 0 && newDist > 0) {
          const factor = pinchDist / newDist;
          cbRef.current.onZoom(factor, pinchMidNormX);
        }
        pinchDist = newDist;
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (brushing && e.touches.length === 0) {
        brushing = false;
        // Use last known position: changedTouches has the lifted finger
        const endNorm = normX(e.changedTouches[0].clientX);
        const lo = Math.min(brushStartNorm, endNorm);
        const hi = Math.max(brushStartNorm, endNorm);
        if (hi - lo > 0.01) {
          cbRef.current.onBrushZoom?.(lo, hi);
        }
        scheduleBrushClear();
        return;
      }
      if (e.touches.length === 0) {
        if (dragging && !touchMoved) {
          const pos = canvasRelative(touchStartX, touchStartY);
          cbRef.current.onClick(pos.x, pos.y);
        }
        dragging = false;
      } else if (e.touches.length === 1) {
        // Went from 2 fingers to 1: restart single-finger drag
        dragging = true;
        touchMoved = false;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchLastX = e.touches[0].clientX;
      }
    }

    // --- attach listeners ---
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);

    return () => {
      if (brushClearTimer !== undefined) clearTimeout(brushClearTimer);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  return canvasRef;
}
