/**
 * Returns true for ~RETURN_FLASH_MS if this event row is the one the user just
 * returned from (refs #213).
 *
 * Subscribes reactively to the stored id rather than capturing it once at mount.
 * Capturing at mount missed the flash on real back-navigation: the returning
 * row's mount timing does not line up with when the id was set, so a
 * mount-time read saw the wrong value. A reactive subscription fires whenever
 * the stored id becomes this row's id.
 *
 * The id is consumed when the flash ends (not at the start), and the timer is
 * only cancelled on unmount. That keeps it a one-shot per return while staying
 * correct when the row that set the id (on click) unmounts as it navigates
 * away: its pending timer is dropped without consuming the id, so the id
 * survives for the row that mounts on return.
 */
import { useEffect, useRef, useState } from 'react';
import { useReturnHighlightStore } from '../stores/returnHighlight';
import { RETURN_FLASH_MS } from '../lib/zmninja-ng-constants';

export function useReturnFlash(eventId: string): boolean {
  const lastViewedEventId = useReturnHighlightStore((s) => s.lastViewedEventId);
  const clear = useReturnHighlightStore((s) => s.clear);
  const [flash, setFlash] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (lastViewedEventId !== eventId) return;
    setFlash(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setFlash(false);
      // Consume only if a newer open() hasn't since replaced the id.
      if (useReturnHighlightStore.getState().lastViewedEventId === eventId) {
        clear();
      }
    }, RETURN_FLASH_MS);
  }, [lastViewedEventId, eventId, clear]);

  // Cancel the timer only on unmount, so a dependency-driven re-run (e.g. the
  // store clearing) does not cut the flash short.
  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  return flash;
}
