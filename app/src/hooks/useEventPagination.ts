/**
 * Event Pagination Hook
 *
 * Manages event pagination with a manual "Load More" button.
 *
 * When `persistKey` is supplied, the count is remembered across an unmount and
 * restored on remount if the key still matches, so returning from an event
 * detail keeps the expanded list length (refs #197). The key must identify the
 * result set (profile + filters) so a filter change resets to the first page.
 * Omit it for callers that don't navigate away and back.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useEventPaginationStore } from '../stores/eventPagination';

interface UseEventPaginationProps {
  defaultLimit: number;
  persistKey?: string;
}

export const useEventPagination = ({ defaultLimit, persistKey }: UseEventPaginationProps) => {
  const [eventLimit, setEventLimit] = useState(() => {
    if (persistKey == null) return defaultLimit;
    return useEventPaginationStore.getState().recall(persistKey) ?? defaultLimit;
  });

  // Reset to the first page when the result set changes; rehydrate the
  // remembered count when returning to a set that was previously expanded.
  const prevKeyRef = useRef(persistKey);
  useEffect(() => {
    if (persistKey == null || persistKey === prevKeyRef.current) return;
    prevKeyRef.current = persistKey;
    setEventLimit(useEventPaginationStore.getState().recall(persistKey) ?? defaultLimit);
  }, [persistKey, defaultLimit]);

  const loadNextPage = useCallback(() => {
    setEventLimit((prev) => {
      const next = prev + defaultLimit;
      if (persistKey != null) useEventPaginationStore.getState().remember(persistKey, next);
      return next;
    });
  }, [defaultLimit, persistKey]);

  return {
    eventLimit,
    batchSize: defaultLimit, // The number of events loaded per batch
    isLoadingMore: false,
    loadNextPage,
  };
};
