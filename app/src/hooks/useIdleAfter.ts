/**
 * useIdleAfter
 *
 * Reports that nobody has touched the page for a while. All Servers mode uses
 * it to downgrade montage tiles from live streams to periodic snapshots
 * (`allModeIdleMinutes`, refs #337): a wall of cameras left open on a desk all
 * afternoon is the case where aggregate streaming costs the most and is worth
 * the least.
 *
 * Deliberately independent of insomnia. Insomnia keeps the screen awake, which
 * is exactly the situation this exists for - a montage left running on a
 * always-on display - so gating the downgrade on it would disable the feature
 * precisely where it pays.
 *
 * One listener set on the document, passive so nothing here can delay a scroll
 * or a tap, and throttled: dragging a pointer across the montage fires
 * hundreds of events and each one would otherwise rebuild the timer.
 */

import { useEffect, useState } from 'react';

/**
 * Pointer, key and touch activity. `pointermove`/`pointerdown` cover mouse,
 * pen and touch on every platform the app runs on; `touchstart` is kept for
 * WebViews that fire touch events without pointer events.
 */
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel'] as const;

/**
 * @param minutes - Quiet period before reporting idle. Zero (or less) switches
 *   the watch off entirely and keeps the answer false.
 * @param throttleMs - Shortest gap between two activity events that both count.
 * @returns Whether the page has been left alone for the whole quiet period.
 */
export function useIdleAfter(minutes: number, throttleMs: number): boolean {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (minutes <= 0 || typeof document === 'undefined') return;

    const quietMs = minutes * 60_000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastActivityAt = 0;

    const restart = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), quietMs);
    };

    const handleActivity = () => {
      const now = Date.now();
      if (now - lastActivityAt < throttleMs) return;
      lastActivityAt = now;
      // A no-op when already awake: React bails out of an identical state.
      setIdle(false);
      restart();
    };

    restart();
    for (const type of ACTIVITY_EVENTS) {
      document.addEventListener(type, handleActivity, { passive: true });
    }

    return () => {
      if (timer) clearTimeout(timer);
      for (const type of ACTIVITY_EVENTS) {
        document.removeEventListener(type, handleActivity);
      }
      // Unmounting, or turning the setting off, must not leave the caller
      // stuck on the downgraded view with nothing left to wake it.
      setIdle(false);
    };
  }, [minutes, throttleMs]);

  return idle;
}
