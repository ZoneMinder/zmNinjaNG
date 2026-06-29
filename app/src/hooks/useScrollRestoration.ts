/**
 * Scroll Restoration Hook
 *
 * Restores the scroll position of a container across unmount/remount cycles,
 * keyed by React Router's per-history-entry `location.key`. Browser back (which
 * reuses the same history entry, and therefore the same key) restores the prior
 * position; fresh navigation (a new key) starts at the top.
 *
 * Needed because sibling routes such as /events and /events/:id unmount each
 * other, so the list's scroll container is destroyed when opening an event and
 * recreated empty on the way back (refs #197).
 */

import { useCallback, useLayoutEffect, useRef } from 'react';

// history-entry key -> last scrollTop. Lives for the SPA session (cleared on a
// full reload, which is acceptable: a hard reload starts a new browsing state).
const scrollPositions = new Map<string, number>();

/**
 * @param key   Unique per history entry. Pass `useLocation().key`.
 * @param ready True once the scrollable content has rendered (e.g. data loaded).
 *              Restore is deferred until this is true so the container is tall
 *              enough to accept the saved offset.
 * @returns A callback ref to attach to the scroll container.
 */
export function useScrollRestoration(key: string, ready: boolean) {
  const elRef = useRef<HTMLElement | null>(null);
  const restoredRef = useRef(false);

  const containerRef = useCallback((el: HTMLElement | null) => {
    elRef.current = el;
  }, []);

  // A new history entry gets one fresh restore attempt.
  useLayoutEffect(() => {
    restoredRef.current = false;
  }, [key]);

  // Save the latest position when leaving this entry (unmount or key change).
  // The cleanup captures the current key, so the position is filed correctly.
  useLayoutEffect(() => {
    return () => {
      const el = elRef.current;
      if (el) scrollPositions.set(key, el.scrollTop);
    };
  }, [key]);

  // Restore once, after the content is ready and the container exists.
  useLayoutEffect(() => {
    if (!ready || restoredRef.current) return;
    const el = elRef.current;
    if (!el) return;
    const saved = scrollPositions.get(key);
    if (saved != null) el.scrollTop = saved;
    restoredRef.current = true;
  }, [ready, key]);

  return containerRef;
}
