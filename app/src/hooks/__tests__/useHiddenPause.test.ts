/**
 * useHiddenPause: stop streaming after the page has been out of sight long
 * enough to be worth it, and start again the moment it is back (refs #337).
 *
 * The grace period is what keeps a tab flick from becoming a teardown and
 * reconnect of every tile, so these tests drive real timers through fake
 * clocks rather than asserting the listener exists.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHiddenPause } from '../useHiddenPause';

const GRACE_MS = 30_000;

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useHiddenPause', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibility('visible');
  });

  it('keeps streaming while the page is visible', () => {
    const { result } = renderHook(() => useHiddenPause(true, GRACE_MS));

    act(() => { vi.advanceTimersByTime(GRACE_MS * 3); });

    expect(result.current).toBe(false);
  });

  it('pauses only once the page has been hidden for the whole grace period', () => {
    const { result } = renderHook(() => useHiddenPause(true, GRACE_MS));

    act(() => { setVisibility('hidden'); });
    act(() => { vi.advanceTimersByTime(GRACE_MS - 1); });
    expect(result.current).toBe(false);

    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(true);
  });

  it('never pauses when the page comes back inside the grace period', () => {
    // A tab flick must not tear every stream down and rebuild it: the grace
    // period is the debounce.
    const { result } = renderHook(() => useHiddenPause(true, GRACE_MS));

    act(() => { setVisibility('hidden'); });
    act(() => { vi.advanceTimersByTime(GRACE_MS / 2); });
    act(() => { setVisibility('visible'); });
    act(() => { vi.advanceTimersByTime(GRACE_MS * 2); });

    expect(result.current).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resumes as soon as the page is visible again', () => {
    const { result } = renderHook(() => useHiddenPause(true, GRACE_MS));

    act(() => { setVisibility('hidden'); });
    act(() => { vi.advanceTimersByTime(GRACE_MS); });
    expect(result.current).toBe(true);

    act(() => { setVisibility('visible'); });
    expect(result.current).toBe(false);
  });

  it('does nothing at all while switched off', () => {
    const { result } = renderHook(() => useHiddenPause(false, GRACE_MS));

    act(() => { setVisibility('hidden'); });
    act(() => { vi.advanceTimersByTime(GRACE_MS * 2); });

    expect(result.current).toBe(false);
  });

  it('resumes when it is switched off while already paused', () => {
    // Leaving All mode (or turning the knob off) with tiles paused must not
    // strand them: the streams come back.
    const { result, rerender } = renderHook(
      ({ on }) => useHiddenPause(on, GRACE_MS),
      { initialProps: { on: true } },
    );

    act(() => { setVisibility('hidden'); });
    act(() => { vi.advanceTimersByTime(GRACE_MS); });
    expect(result.current).toBe(true);

    rerender({ on: false });
    expect(result.current).toBe(false);
  });

  it('leaves no timer armed after unmount', () => {
    const { unmount } = renderHook(() => useHiddenPause(true, GRACE_MS));

    act(() => { setVisibility('hidden'); });
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
