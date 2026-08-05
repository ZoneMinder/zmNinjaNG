/**
 * useIdleAfter: how long the user has to leave the page alone before it stops
 * treating them as watching (refs #337).
 *
 * The timer is the whole feature, so these tests drive it through a fake
 * clock and real events rather than asserting a listener was attached.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIdleAfter } from '../useIdleAfter';

const MINUTES = 5;
const IDLE_MS = MINUTES * 60_000;
const THROTTLE_MS = 1_000;

const activity = () => document.dispatchEvent(new Event('pointermove'));

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useIdleAfter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports idle only after the whole quiet period', () => {
    const { result } = renderHook(() => useIdleAfter(MINUTES, THROTTLE_MS));

    act(() => { vi.advanceTimersByTime(IDLE_MS - 1); });
    expect(result.current).toBe(false);

    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(true);
  });

  it('stays awake while the user keeps touching the page', () => {
    const { result } = renderHook(() => useIdleAfter(MINUTES, THROTTLE_MS));

    for (let i = 0; i < 4; i += 1) {
      act(() => { vi.advanceTimersByTime(IDLE_MS - 1000); });
      act(() => { activity(); });
    }

    expect(result.current).toBe(false);
  });

  it('wakes on the first activity after going idle', () => {
    const { result } = renderHook(() => useIdleAfter(MINUTES, THROTTLE_MS));

    act(() => { vi.advanceTimersByTime(IDLE_MS); });
    expect(result.current).toBe(true);

    act(() => { activity(); });
    expect(result.current).toBe(false);

    // And the quiet period starts over from that activity.
    act(() => { vi.advanceTimersByTime(IDLE_MS - 1); });
    expect(result.current).toBe(false);
  });

  it('keeps counting through a burst of moves rather than re-arming per event', () => {
    // Throttling is what keeps a mouse dragged across the montage from
    // rebuilding the timer on every one of hundreds of events; it must not
    // also stop the timer from being pushed back.
    const { result } = renderHook(() => useIdleAfter(MINUTES, THROTTLE_MS));

    act(() => {
      for (let i = 0; i < 200; i += 1) activity();
    });
    act(() => { vi.advanceTimersByTime(IDLE_MS); });

    expect(result.current).toBe(true);
  });

  it('wakes when the user comes back to the tab', () => {
    // Returning to a montage counts as looking at it, even before the mouse
    // moves; otherwise the tiles stay on snapshots until something is clicked.
    const { result } = renderHook(() => useIdleAfter(MINUTES, THROTTLE_MS));

    act(() => { vi.advanceTimersByTime(IDLE_MS); });
    expect(result.current).toBe(true);

    act(() => { setVisibility('visible'); });

    expect(result.current).toBe(false);
  });

  it('does not count leaving the tab as activity', () => {
    const { result } = renderHook(() => useIdleAfter(MINUTES, THROTTLE_MS));

    act(() => { vi.advanceTimersByTime(IDLE_MS - 1000); });
    act(() => { setVisibility('hidden'); });
    act(() => { vi.advanceTimersByTime(1000); });

    // Walking away is the opposite of activity: the quiet period runs out on
    // the schedule it was already on.
    expect(result.current).toBe(true);
  });

  it('never goes idle when switched off with zero minutes', () => {
    const { result } = renderHook(() => useIdleAfter(0, THROTTLE_MS));

    act(() => { vi.advanceTimersByTime(IDLE_MS * 4); });

    expect(result.current).toBe(false);
  });

  it('wakes up when it is switched off while already idle', () => {
    const { result, rerender } = renderHook(
      ({ minutes }) => useIdleAfter(minutes, THROTTLE_MS),
      { initialProps: { minutes: MINUTES } },
    );

    act(() => { vi.advanceTimersByTime(IDLE_MS); });
    expect(result.current).toBe(true);

    rerender({ minutes: 0 });
    expect(result.current).toBe(false);
  });

  it('leaves no timer armed after unmount', () => {
    const { unmount } = renderHook(() => useIdleAfter(MINUTES, THROTTLE_MS));

    expect(vi.getTimerCount()).toBe(1);
    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
