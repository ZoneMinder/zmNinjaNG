/**
 * useIsMobile (refs #246)
 *
 * A runtime match for the Tailwind `sm` breakpoint. The assistant renders a
 * genuinely different shell below `sm` (a bottom sheet with pointer-drag and
 * keyboard math) than at/above it (a resizable desktop card), so the choice
 * has to be a real conditional render, not a CSS `hidden`: mounting both would
 * run two `AskPanel`s and two sets of listeners.
 */
import { useSyncExternalStore } from 'react';
import { ASSISTANT_PANEL } from '../lib/zmninja-ng-constants';

// One below the breakpoint so it agrees with Tailwind's `sm:` (min-width:640px):
// at exactly 640 the desktop styles apply, so isMobile must be false there.
const QUERY = `(max-width: ${ASSISTANT_PANEL.mobileBreakpointPx - 1}px)`;

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

export function useIsMobile(): boolean {
  // SSR/no-window snapshot is `false` (desktop): there is no viewport to be
  // narrow, and the assistant never renders server-side anyway.
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
