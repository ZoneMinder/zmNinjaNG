/**
 * Scroll restoration for pages that scroll the app shell's shared container
 * (AppLayout's <main>) rather than their own overflow element.
 *
 * Keyed by React Router's per-history-entry `location.key`: browser back reuses
 * the same key and restores the prior scrollTop; fresh navigation gets a new key
 * and starts at the top. Unlike a page with its own container, the shared <main>
 * is never unmounted, so this hook saves on the consumer's unmount and restores
 * on its remount.
 *
 * The offset is re-applied while the page's async content is still growing (a
 * monitor detail page loads its recent-events list after mount, so the page is
 * short at first and a one-shot restore would clamp to the wrong offset). It
 * stops once the target is reached, the user scrolls, or SCROLL_RESTORE_MAX_MS
 * elapses. Needed for the monitor detail page's recent-events list (refs #213).
 */

import { useLayoutEffect } from 'react';
import { MAIN_SCROLL_SELECTOR, SCROLL_RESTORE_MAX_MS } from '../lib/zmninja-ng-constants';

// history-entry key -> last scrollTop of the shared <main>. Lives for the SPA
// session (cleared on a full reload).
const positions = new Map<string, number>();

function getMain(): HTMLElement | null {
  return document.querySelector<HTMLElement>(MAIN_SCROLL_SELECTOR);
}

export function useMainScrollRestoration(key: string): void {
  // Save the shared container's position when leaving this history entry.
  useLayoutEffect(() => {
    return () => {
      const el = getMain();
      if (el) positions.set(key, el.scrollTop);
    };
  }, [key]);

  // Restore on entry, re-applying as content grows until the target is reached.
  useLayoutEffect(() => {
    const saved = positions.get(key);
    if (saved == null || saved <= 0) return;
    const el = getMain();
    if (!el) return;

    const start = performance.now();
    let stopped = false;
    let observer: ResizeObserver | null = null;

    const stop = () => {
      if (stopped) return;
      stopped = true;
      observer?.disconnect();
      el.removeEventListener('wheel', stop);
      el.removeEventListener('touchstart', stop);
      window.removeEventListener('keydown', stop);
    };

    const apply = () => {
      if (stopped) return;
      el.scrollTop = saved;
      const reached = Math.abs(el.scrollTop - saved) <= 1;
      if (reached || performance.now() - start > SCROLL_RESTORE_MAX_MS) stop();
    };

    // Don't fight the user if they scroll during the restore window.
    el.addEventListener('wheel', stop, { passive: true });
    el.addEventListener('touchstart', stop, { passive: true });
    window.addEventListener('keydown', stop);

    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => apply());
      observer.observe(el);
      if (el.firstElementChild) observer.observe(el.firstElementChild);
    }

    apply();
    const timer = window.setTimeout(stop, SCROLL_RESTORE_MAX_MS);

    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [key]);
}
