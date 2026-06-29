/**
 * useScrollRestoration Hook Tests
 *
 * jsdom does no layout, so a real element's scrollTop always reads 0. These
 * tests use a plain stand-in object as the container; the hook only ever
 * gets/sets `scrollTop` on it, which is all the behavior under test (refs #197).
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScrollRestoration } from '../useScrollRestoration';

function fakeEl(scrollTop = 0): HTMLElement {
  return { scrollTop } as HTMLElement;
}

describe('useScrollRestoration', () => {
  it('restores the saved scroll position when returning to the same key', () => {
    const KEY = 'history-key-1';

    // First visit: attach container, user scrolls, then leave (unmount).
    const first = renderHook(({ ready }) => useScrollRestoration(KEY, ready), {
      initialProps: { ready: true },
    });
    const el1 = fakeEl(0);
    act(() => first.result.current(el1));
    el1.scrollTop = 250;
    first.unmount();

    // Return to the same history entry: content not ready yet, then ready.
    const second = renderHook(({ ready }) => useScrollRestoration(KEY, ready), {
      initialProps: { ready: false },
    });
    const el2 = fakeEl(0);
    act(() => second.result.current(el2));
    expect(el2.scrollTop).toBe(0); // not restored before content is ready

    act(() => second.rerender({ ready: true }));
    expect(el2.scrollTop).toBe(250);
  });

  it('does not restore for a different key (fresh navigation starts at top)', () => {
    const first = renderHook(({ ready }) => useScrollRestoration('key-a', ready), {
      initialProps: { ready: true },
    });
    const el1 = fakeEl(0);
    act(() => first.result.current(el1));
    el1.scrollTop = 400;
    first.unmount();

    const second = renderHook(({ ready }) => useScrollRestoration('key-b', ready), {
      initialProps: { ready: true },
    });
    const el2 = fakeEl(0);
    act(() => second.result.current(el2));
    expect(el2.scrollTop).toBe(0);
  });

  it('only restores once, so a later content change does not snap back', () => {
    const KEY = 'history-key-2';
    const seed = renderHook(({ ready }) => useScrollRestoration(KEY, ready), {
      initialProps: { ready: true },
    });
    const elSeed = fakeEl(0);
    act(() => seed.result.current(elSeed));
    elSeed.scrollTop = 120;
    seed.unmount();

    const { result, rerender } = renderHook(
      ({ ready }) => useScrollRestoration(KEY, ready),
      { initialProps: { ready: false } }
    );
    const el = fakeEl(0);
    act(() => result.current(el));
    act(() => rerender({ ready: true }));
    expect(el.scrollTop).toBe(120); // restored once

    // User scrolls; even if `ready` toggles again (e.g. a refetch), no re-restore.
    el.scrollTop = 600;
    act(() => rerender({ ready: false }));
    act(() => rerender({ ready: true }));
    expect(el.scrollTop).toBe(600);
  });
});
