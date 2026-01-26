/**
 * Event Pagination Hook
 *
 * Manages event pagination with manual "Load More" button.
 */

import { useState, useCallback } from 'react';

interface UseEventPaginationProps {
  defaultLimit: number;
}

export const useEventPagination = ({ defaultLimit }: UseEventPaginationProps) => {
  const [eventLimit, setEventLimit] = useState(defaultLimit);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const loadNextPage = useCallback(() => {
    setIsLoadingMore(true);
    setEventLimit((prev) => prev + defaultLimit);
    setIsLoadingMore(false);
  }, [defaultLimit]);

  return {
    eventLimit,
    batchSize: defaultLimit, // The number of events loaded per batch
    isLoadingMore,
    loadNextPage,
  };
};
