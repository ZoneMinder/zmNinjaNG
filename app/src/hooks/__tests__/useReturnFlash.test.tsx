import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReturnFlash } from '../useReturnFlash';
import { useReturnHighlightStore } from '../../stores/returnHighlight';

describe('useReturnFlash', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useReturnHighlightStore.getState().clear();
  });
  afterEach(() => vi.useRealTimers());

  it('flashes for a matching id, then stops and consumes the id after 4s', () => {
    useReturnHighlightStore.getState().markViewed('42');
    const { result } = renderHook(() => useReturnFlash('42'));
    expect(result.current).toBe(true);
    // Not consumed at the start (so a row unmounting mid-navigation cannot drop
    // the id before the returning row can flash).
    expect(useReturnHighlightStore.getState().lastViewedEventId).toBe('42');
    act(() => vi.advanceTimersByTime(4000));
    expect(result.current).toBe(false);
    expect(useReturnHighlightStore.getState().lastViewedEventId).toBeNull();
  });

  it('reacts to the id being set after mount (row already mounted on return)', () => {
    // Mount first with an empty store, then set the id. This mimics a row that
    // was already mounted when the user returned.
    const { result } = renderHook(() => useReturnFlash('42'));
    expect(result.current).toBe(false);
    act(() => useReturnHighlightStore.getState().markViewed('42'));
    expect(result.current).toBe(true);
  });

  it('does not flash for a non-matching id and leaves the store intact', () => {
    useReturnHighlightStore.getState().markViewed('42');
    const { result } = renderHook(() => useReturnFlash('99'));
    expect(result.current).toBe(false);
    expect(useReturnHighlightStore.getState().lastViewedEventId).toBe('42');
  });

  it('does not flash when nothing was stored', () => {
    const { result } = renderHook(() => useReturnFlash('42'));
    expect(result.current).toBe(false);
  });

  it('keeps the id when the row unmounts before the flash ends (no consume)', () => {
    useReturnHighlightStore.getState().markViewed('42');
    const { result, unmount } = renderHook(() => useReturnFlash('42'));
    expect(result.current).toBe(true);
    unmount();
    // The unmounting row must not have consumed the id: the returning row needs it.
    expect(useReturnHighlightStore.getState().lastViewedEventId).toBe('42');
  });
});
