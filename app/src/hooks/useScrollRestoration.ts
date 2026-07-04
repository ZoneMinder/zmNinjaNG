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
 *
 * Once content is `ready`, the saved offset is re-applied while the container
 * keeps growing (the Events list fills in a heatmap header and per-row tag
 * chips from a separate query after first paint), so a deep position doesn't
 * clamp short or drift as rows grow. Handled by restoreScrollWhileGrowing.
 */

import { useCallback, useLayoutEffect, useRef } from 'react';
import { SCROLL_RESTORE_MAX_MS } from '../lib/zmninja-ng-constants';
import { restoreScrollWhileGrowing } from '../lib/scroll-restore';

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

  // Restore after content is ready and the container exists. Started once per
  // entry; the helper keeps re-applying while the list grows, then stops on
  // reach, user scroll, or timeout.
  useLayoutEffect(() => {
    if (!ready || restoredRef.current) return;
    const el = elRef.current;
    if (!el) return;
    restoredRef.current = true;
    const saved = scrollPositions.get(key);
    if (saved == null || saved <= 0) return;
    return restoreScrollWhileGrowing(el, saved, SCROLL_RESTORE_MAX_MS);
  }, [ready, key]);

  return containerRef;
}
