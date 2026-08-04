/**
 * useHiddenPause
 *
 * Reports when a page's live streams should stop because nobody is looking at
 * them. All Servers mode turns this on through `allModePauseHidden` (refs
 * #337): a montage of sixteen tiles across four servers keeps four servers
 * encoding and this client decoding for a tab the user switched away from an
 * hour ago.
 *
 * The grace period is the debounce. Tearing streams down the instant a tab
 * loses focus would make a flick between tabs cost a full teardown and
 * reconnect of every tile, which is more expensive than the streaming it
 * saves, so the page has to stay out of sight for the whole period before
 * anything stops. Coming back cancels it, and coming back after it fired
 * resumes immediately.
 *
 * `visibilitychange` only. Window blur is deliberately not a pause signal:
 * on Electron a window covered by another app fires blur without
 * visibilitychange, but so does a window sitting fully visible on a second
 * display while the user types elsewhere (see useVisibilityResume, which
 * listens to both because resuming a stream that never stopped is harmless
 * and stopping one the user is watching is not).
 *
 * The caller decides what to do with the answer. In Montage it disables the
 * stream hooks, which quits the ZMS connection on the server (CMD_QUIT) and
 * mints a fresh connkey on resume, so no nph-zms process is left behind.
 */

import { useEffect, useState } from 'react';

/**
 * @param enabled - Whether pausing applies at all. False keeps the answer
 *   false and arms nothing; flipping it to false while paused resumes.
 * @param graceMs - How long the page must stay hidden before pausing.
 * @returns Whether streams should be stopped right now.
 */
export function useHiddenPause(enabled: boolean, graceMs: number): boolean {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const disarm = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const handleVisibilityChange = () => {
      disarm();
      if (document.visibilityState === 'hidden') {
        timer = setTimeout(() => setPaused(true), graceMs);
        return;
      }
      setPaused(false);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // A page can already be hidden when this starts watching: opened in a
    // background tab, or restored into one. No visibilitychange is coming to
    // say so, and without this the tiles would stream on unwatched forever.
    // The grace period still runs, from here rather than from whenever the
    // page actually went out of sight, so nothing pauses on the spot.
    if (document.visibilityState === 'hidden') {
      timer = setTimeout(() => setPaused(true), graceMs);
    }

    return () => {
      disarm();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      // Whatever ends the subscription - unmount, leaving All mode, turning
      // the setting off - must not leave tiles stranded in a paused state
      // nothing will clear.
      setPaused(false);
    };
  }, [enabled, graceMs]);

  return paused;
}
