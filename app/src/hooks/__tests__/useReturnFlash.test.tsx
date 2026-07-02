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

  it('flashes for a matching id, then stops after 4s, and consumes the id', () => {
    useReturnHighlightStore.getState().markViewed('42');
    const { result } = renderHook(() => useReturnFlash('42'));
    expect(result.current).toBe(true);
    // consumed so it will not re-flash on a later mount
    expect(useReturnHighlightStore.getState().lastViewedEventId).toBeNull();
    act(() => vi.advanceTimersByTime(4000));
    expect(result.current).toBe(false);
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
});
