/**
 * Fires a callback when the window returns to the foreground after being away.
 *
 * Two signals feed this. `visibilitychange` covers tab switches and window
 * minimize. On Electron desktop, covering the window with another app does not
 * fire visibilitychange (only minimize does), but it does fire window
 * blur/focus, so those are also used there. In both cases the stream's
 * connection can drop while the window is in the background, and recovery has
 * to happen on return. refs #150
 *
 * Debounces a rapid away→back flicker (e.g., quick alt-tab) so a brief blur
 * does not trigger a reconnect storm. The minimum time away before a return is
 * considered worth acting on is `minHiddenMs` (default 1500ms).
 */

import { useEffect, useRef } from 'react';
import { Platform } from '../lib/platform';

export interface UseVisibilityResumeOptions {
  enabled?: boolean;
  minHiddenMs?: number;
}

export function useVisibilityResume(
  onResume: () => void,
  { enabled = true, minHiddenMs = 1500 }: UseVisibilityResumeOptions = {},
): void {
  // Only an away-transition observed after mount counts. Do not seed from the
  // initial visibility state: on Electron the window starts hidden/unfocused
  // (created with show:false, revealed later), and seeding would make the first
  // reveal look like a return-from-away and fire a needless reconnect that
  // flashes the montage tiles black on startup. refs #150
  const hiddenAtRef = useRef<number | null>(null);
  const onResumeRef = useRef(onResume);
  onResumeRef.current = onResume;

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;

    // Record when the window left the foreground. The first signal wins so a
    // following blur/visibilitychange pair does not reset the away timer.
    const markAway = () => {
      if (hiddenAtRef.current === null) hiddenAtRef.current = Date.now();
    };

    const tryResume = () => {
      const awayAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (awayAt === null) return;
      if (Date.now() - awayAt < minHiddenMs) return;
      onResumeRef.current();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        markAway();
        return;
      }
      if (document.visibilityState === 'visible') tryResume();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Electron-only: occlusion behind another app fires blur/focus but not
    // visibilitychange, so add those to cover the window-covered case.
    const useFocus = Platform.isElectron;
    if (useFocus) {
      window.addEventListener('blur', markAway);
      window.addEventListener('focus', tryResume);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (useFocus) {
        window.removeEventListener('blur', markAway);
        window.removeEventListener('focus', tryResume);
      }
      // Drop any pending away-marker with the subscription that recorded it.
      // A caller can be disabled mid-away and re-enabled later (a montage tile
      // pausing while hidden, refs #337); keeping the marker would measure the
      // next return from an away-time this subscription never watched, and a
      // brief flick would resume as if the page had been gone for hours.
      hiddenAtRef.current = null;
    };
  }, [enabled, minHiddenMs]);
}
