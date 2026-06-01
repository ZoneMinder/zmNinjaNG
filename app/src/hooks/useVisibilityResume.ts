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
  const hiddenAtRef = useRef<number | null>(
    typeof document !== 'undefined' && document.visibilityState === 'hidden' ? Date.now() : null,
  );
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
    };
  }, [enabled, minHiddenMs]);
}
