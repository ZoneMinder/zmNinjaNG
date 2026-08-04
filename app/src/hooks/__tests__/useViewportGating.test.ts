/**
 * useViewportGating: which montage tiles are close enough to the viewport to
 * be worth a connection (refs #337).
 *
 * jsdom has no IntersectionObserver, so these tests install a mock that
 * records what was observed and lets a test deliver entries by hand. That is
 * the only way to drive the hook: everything it decides comes from those
 * entries and the linger clock, both of which are exercised directly here
 * rather than asserted through "an observer was constructed".
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useViewportGating } from '../useViewportGating';
import {
  MockIntersectionObserver,
  installMockIntersectionObserver,
  latestIntersectionObserver as latest,
} from '../../tests/mock-intersection-observer';

const LINGER_MS = 1500;
const ROOT_MARGIN = '100%';

describe('useViewportGating', () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    installMockIntersectionObserver();
    root = document.createElement('div');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const setup = (enabled = true) =>
    renderHook(
      ({ on }: { on: boolean }) =>
        useViewportGating({ enabled: on, root, rootMargin: ROOT_MARGIN, lingerMs: LINGER_MS }),
      { initialProps: { on: enabled } }
    );

  /** Attach a tile element the way the grid's ref callback does. */
  const attach = (
    result: { current: ReturnType<typeof useViewportGating> },
    tileId: string
  ): HTMLElement => {
    const el = document.createElement('div');
    act(() => {
      result.current.registerTile(tileId)(el);
    });
    return el;
  };

  it('holds a tile closed until the observer says it is in view', () => {
    const { result } = setup();
    const el = attach(result, 'p1:1');

    // Nothing has been reported yet: a tile whose position nobody has measured
    // gets no connection, rather than one that is torn down a frame later.
    expect(result.current.isTileGated('p1:1')).toBe(true);

    act(() => { latest().fire([{ target: el, isIntersecting: true }]); });

    expect(result.current.isTileGated('p1:1')).toBe(false);
  });

  it('keeps a tile streaming through the linger after it scrolls out', () => {
    const { result } = setup();
    const el = attach(result, 'p1:1');
    act(() => { latest().fire([{ target: el, isIntersecting: true }]); });

    act(() => { latest().fire([{ target: el, isIntersecting: false }]); });
    expect(result.current.isTileGated('p1:1')).toBe(false);

    act(() => { vi.advanceTimersByTime(LINGER_MS - 1); });
    expect(result.current.isTileGated('p1:1')).toBe(false);

    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.isTileGated('p1:1')).toBe(true);
  });

  it('never drops a tile the user scrolled past and back within the linger', () => {
    const { result } = setup();
    const el = attach(result, 'p1:1');
    act(() => { latest().fire([{ target: el, isIntersecting: true }]); });

    act(() => { latest().fire([{ target: el, isIntersecting: false }]); });
    act(() => { vi.advanceTimersByTime(LINGER_MS - 100); });
    act(() => { latest().fire([{ target: el, isIntersecting: true }]); });
    act(() => { vi.advanceTimersByTime(LINGER_MS * 2); });

    expect(result.current.isTileGated('p1:1')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gates each tile on its own position', () => {
    const { result } = setup();
    const near = attach(result, 'p1:1');
    const far = attach(result, 'p2:1');

    act(() => {
      latest().fire([
        { target: near, isIntersecting: true },
        { target: far, isIntersecting: false },
      ]);
    });
    act(() => { vi.advanceTimersByTime(LINGER_MS); });

    expect(result.current.isTileGated('p1:1')).toBe(false);
    expect(result.current.isTileGated('p2:1')).toBe(true);
  });

  it('gates before the scroll container it will observe against exists', () => {
    // The root arrives from a ref, so it is null on the first render. Waiting
    // for it would render every tile ungated once, and a tile rendered ungated
    // has already minted a connkey for the next render to quit.
    const { result } = renderHook(() =>
      useViewportGating({ enabled: true, root: null, rootMargin: ROOT_MARGIN, lingerMs: LINGER_MS })
    );

    expect(result.current.isTileGated('p1:1')).toBe(true);
    expect(MockIntersectionObserver.instances).toHaveLength(0);
  });

  it('gates nothing while switched off, and observes nothing either', () => {
    const { result } = setup(false);
    attach(result, 'p1:1');

    expect(result.current.isTileGated('p1:1')).toBe(false);
    expect(MockIntersectionObserver.instances).toHaveLength(0);
  });

  it('releases every gated tile when the setting is turned off', () => {
    const { result, rerender } = setup();
    const el = attach(result, 'p1:1');
    act(() => { latest().fire([{ target: el, isIntersecting: false }]); });
    act(() => { vi.advanceTimersByTime(LINGER_MS); });
    expect(result.current.isTileGated('p1:1')).toBe(true);

    rerender({ on: false });

    expect(result.current.isTileGated('p1:1')).toBe(false);
    expect(latest().disconnectedCount).toBe(1);
  });

  it('gates nothing where the browser has no IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { result } = setup();
    attach(result, 'p1:1');

    expect(result.current.isTileGated('p1:1')).toBe(false);
  });

  it('leaves no timer behind on unmount', () => {
    const { result, unmount } = setup();
    const el = attach(result, 'p1:1');
    act(() => { latest().fire([{ target: el, isIntersecting: false }]); });
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
    expect(latest().disconnectedCount).toBe(1);
  });

  it('hands out the same ref callback for a tile across renders', () => {
    // A fresh callback identity per render would make React detach and
    // re-attach every tile on every grid re-render, and each re-observe
    // re-fires the entry - so a dragged tile would churn its connection.
    const { result, rerender } = setup();
    const first = result.current.registerTile('p1:1');

    rerender({ on: true });

    expect(result.current.registerTile('p1:1')).toBe(first);
  });

  it('keeps the same ref callback after a detach, so nothing churns', () => {
    // React detaches and re-attaches a ref on mount under StrictMode, and any
    // time the callback's identity changes. Handing out a NEW callback after a
    // detach makes that self-sustaining: the next render's ref differs, React
    // detaches again, and the tile is observed, dropped and re-observed
    // forever - which in the browser meant every tile sat gated and no montage
    // tile ever streamed (refs #337).
    const { result, rerender } = setup();
    const first = result.current.registerTile('p1:1');
    const el = document.createElement('div');

    act(() => { first(el); });
    act(() => { first(null); });
    rerender({ on: true });

    expect(result.current.registerTile('p1:1')).toBe(first);
  });

  it('stops tracking a tile that unmounts, and forgets it was in view', () => {
    const { result } = setup();
    const el = attach(result, 'p1:1');
    act(() => { latest().fire([{ target: el, isIntersecting: true }]); });

    act(() => { result.current.registerTile('p1:1')(null); });

    expect(latest().targets.has(el)).toBe(false);
    expect(result.current.isTileGated('p1:1')).toBe(true);
  });

  it('observes against the scroll container with the margin it was given', () => {
    const { result } = setup();
    const el = attach(result, 'p1:1');

    expect(latest().targets.has(el)).toBe(true);
    expect(latest().options?.root).toBe(root);
    expect(latest().options?.rootMargin).toBe(ROOT_MARGIN);
  });
});
