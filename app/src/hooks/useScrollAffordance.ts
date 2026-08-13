/**
 * useScrollAffordance (refs #365)
 *
 * Answers one question for a page: does the user need a button to scroll this?
 * They do when the pointer is coarse and the page's scrolling ancestor
 * overflows. On a tablet a monitor or event fills the viewport with video and
 * controls, and every remaining surface is a gesture target, so there is
 * nowhere left to swipe: the page below the fold is unreachable. A mouse never
 * has that problem, since the wheel and the scrollbar scroll from anywhere.
 */

import { useCallback, useSyncExternalStore } from 'react';
import { SCROLL_PAD } from '../lib/zmninja-ng-constants';

/**
 * The nearest ancestor that scrolls. Which element that is depends on the
 * layout a page renders in - the app's `<main>` in the normal shell, a nested
 * container in fullscreen - so find it rather than assume it. Matches on the
 * overflow style alone, not on current overflow, so an element that only
 * starts overflowing later is still found.
 */
function findScrollParent(from: HTMLElement | null): HTMLElement | null {
  for (let node = from; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

/**
 * Height of visible page that is not the gesture surface, which is what a
 * finger has to land on to scroll by swiping.
 */
function freeSurfaceHeight(scroller: HTMLElement, gestureSurface: HTMLElement): number {
  const view = scroller.getBoundingClientRect();
  const surface = gestureSurface.getBoundingClientRect();
  const covered = Math.max(0, Math.min(view.bottom, surface.bottom) - Math.max(view.top, surface.top));
  return scroller.clientHeight - covered;
}

/**
 * Takes elements rather than refs, so that a page swapping its skeleton for
 * real content - new elements, same component - re-measures. A ref object
 * would keep the stale first measurement.
 *
 * `gestureSurface` is the part of the page that consumes touches instead of
 * scrolling: the zoom and pan container around the video. How much of the
 * viewport it covers is what separates a tablet in landscape, where it leaves
 * only a header strip and the page below the fold is stranded, from the same
 * page in portrait, where there is plenty of room to swipe.
 */
export function useScrollAffordance(
  content: HTMLElement | null,
  gestureSurface: HTMLElement | null,
): boolean {
  // Read through useSyncExternalStore rather than measuring into state from an
  // effect: the snapshot is a plain boolean, so React re-reads it whenever the
  // observer fires and there is no render-then-correct pass. Same shape as
  // useIsMobile.
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!content) return () => {};
      const observer = new ResizeObserver(onChange);
      observer.observe(content);
      if (gestureSurface) observer.observe(gestureSurface);
      const parent = findScrollParent(content);
      if (parent) observer.observe(parent);
      return () => observer.disconnect();
    },
    [content, gestureSurface],
  );

  // Resolves the scroll parent on every read: entering or leaving fullscreen
  // swaps which ancestor scrolls without remounting the page.
  const getSnapshot = useCallback(() => {
    if (!content || !gestureSurface) return false;
    if (!(window.matchMedia?.('(pointer: coarse)').matches ?? false)) return false;
    const parent = findScrollParent(content);
    if (!parent) return false;
    if (parent.scrollHeight - parent.clientHeight <= SCROLL_PAD.minOverflowPx) return false;
    return freeSurfaceHeight(parent, gestureSurface) < SCROLL_PAD.minGrabPx;
  }, [content, gestureSurface]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
