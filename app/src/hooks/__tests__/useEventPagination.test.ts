/**
 * useEventPagination Hook Tests
 *
 * Covers the count-persistence behavior that keeps a "Load More" expansion
 * across the unmount/remount when a user opens an event and returns (refs #197).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEventPagination } from '../useEventPagination';
import { useEventPaginationStore } from '../../stores/eventPagination';

beforeEach(() => {
  useEventPaginationStore.setState({ signature: null, limit: null });
});

describe('useEventPagination', () => {
  it('starts at the default limit', () => {
    const { result } = renderHook(() => useEventPagination({ defaultLimit: 100, persistKey: 'A' }));
    expect(result.current.eventLimit).toBe(100);
  });

  it('increments by the batch size on loadNextPage', () => {
    const { result } = renderHook(() => useEventPagination({ defaultLimit: 100, persistKey: 'A' }));
    act(() => result.current.loadNextPage());
    act(() => result.current.loadNextPage());
    expect(result.current.eventLimit).toBe(300);
  });

  it('restores the expanded count on remount with the same persistKey', () => {
    const first = renderHook(() => useEventPagination({ defaultLimit: 100, persistKey: 'A' }));
    act(() => first.result.current.loadNextPage()); // 200
    act(() => first.result.current.loadNextPage()); // 300
    first.unmount(); // opening an event unmounts the list

    // Returning from the event detail remounts with the same result set.
    const second = renderHook(() => useEventPagination({ defaultLimit: 100, persistKey: 'A' }));
    expect(second.result.current.eventLimit).toBe(300);
  });

  it('resets to the default when the persistKey (filters) changes', () => {
    const first = renderHook(() => useEventPagination({ defaultLimit: 100, persistKey: 'A' }));
    act(() => first.result.current.loadNextPage()); // 200
    first.unmount();

    const second = renderHook(() => useEventPagination({ defaultLimit: 100, persistKey: 'B' }));
    expect(second.result.current.eventLimit).toBe(100);
  });

  it('resets within a mounted instance when the persistKey changes', () => {
    let key = 'A';
    const { result, rerender } = renderHook(() =>
      useEventPagination({ defaultLimit: 100, persistKey: key })
    );
    act(() => result.current.loadNextPage()); // 200 under key A
    key = 'B';
    rerender();
    expect(result.current.eventLimit).toBe(100);
  });

  it('does not persist when no persistKey is given', () => {
    const first = renderHook(() => useEventPagination({ defaultLimit: 100 }));
    act(() => first.result.current.loadNextPage()); // 200
    first.unmount();

    const second = renderHook(() => useEventPagination({ defaultLimit: 100 }));
    expect(second.result.current.eventLimit).toBe(100);
    expect(useEventPaginationStore.getState().limit).toBeNull();
  });
});
