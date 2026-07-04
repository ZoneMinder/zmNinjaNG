/**
 * restoreScrollWhileGrowing tests.
 *
 * jsdom does no layout: assigning scrollTop stores the value verbatim (no
 * clamping) and the no-op ResizeObserver from tests/setup never fires. So these
 * cover the observable contract, not the grow-and-clamp loop (device-only):
 * the target is applied, user input stops it, and the cleanup cancels the timer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { restoreScrollWhileGrowing } from '../scroll-restore';

describe('restoreScrollWhileGrowing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // scrollTop clamps to `maxScroll`, standing in for a short (still-growing)
  // container: with maxScroll below the target the restore never "reaches" and
  // keeps its listeners attached, so the user-scroll path is exercisable.
  function makeEl(maxScroll = Infinity) {
    const listeners: Record<string, EventListener[]> = {};
    let top = 0;
    const el = {
      firstElementChild: null,
      get scrollTop() { return top; },
      set scrollTop(v: number) { top = Math.min(v, maxScroll); },
      addEventListener: (type: string, fn: EventListener) => {
        (listeners[type] ??= []).push(fn);
      },
      removeEventListener: (type: string, fn: EventListener) => {
        listeners[type] = (listeners[type] ?? []).filter((l) => l !== fn);
      },
    };
    return { el: el as unknown as HTMLElement, listeners };
  }

  it('applies the target offset immediately', () => {
    const { el } = makeEl();
    restoreScrollWhileGrowing(el, 250, 1000);
    expect(el.scrollTop).toBe(250);
  });

  it('stops re-applying once the user scrolls', () => {
    // Short container (max 40) so the 250 target is never reached and the
    // restore keeps its listeners for the user-scroll stop to fire.
    const { el, listeners } = makeEl(40);
    restoreScrollWhileGrowing(el, 250, 1000);
    expect(el.scrollTop).toBe(40); // clamped, not yet reached
    listeners['wheel'][0](new Event('wheel')); // user scrolls: stop
    expect(listeners['wheel']).toHaveLength(0); // detached, won't re-apply
  });

  it('cleanup cancels the pending timer and detaches listeners', () => {
    const { el, listeners } = makeEl(40);
    const cleanup = restoreScrollWhileGrowing(el, 250, 1000);
    cleanup();
    expect(listeners['wheel']).toHaveLength(0);
    expect(listeners['touchstart']).toHaveLength(0);
    // Advancing past the window must not throw or re-apply.
    el.scrollTop = 10;
    vi.advanceTimersByTime(1000);
    expect(el.scrollTop).toBe(10);
  });
});
