/**
 * Returns true for ~RETURN_FLASH_MS if this event row is the one the user just
 * returned from. Captures the stored id once at mount (non-reactive) and
 * consumes it, so exactly one row flashes, once, on return (refs #213).
 */
import { useEffect, useState } from 'react';
import { useReturnHighlightStore } from '../stores/returnHighlight';
import { RETURN_FLASH_MS } from '../lib/zmninja-ng-constants';

export function useReturnFlash(eventId: string): boolean {
  const [flashId] = useState(() => useReturnHighlightStore.getState().lastViewedEventId);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (!flashId || flashId !== eventId) return;
    useReturnHighlightStore.getState().clear();
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), RETURN_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flashId, eventId]);

  return flash;
}
