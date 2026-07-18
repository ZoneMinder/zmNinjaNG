/**
 * useKeyboardViewport (refs #246)
 *
 * The one genuinely hard part of a mobile web bottom sheet: keeping the input
 * above the on-screen keyboard. `window.visualViewport` is the browser's own
 * report of what is actually visible: its `height` shrinks and its `offsetTop`
 * shifts when the keyboard opens. This exposes two numbers the sheet needs:
 *
 * - `visibleHeight`: the height of the area not covered by the keyboard, which
 *   the sheet caps its own height against so it never hides behind the keyboard.
 * - `keyboardInset`: how far up from the layout-viewport bottom the sheet must
 *   sit. On iOS a `position: fixed; bottom: 0` element stays pinned to the
 *   layout viewport (behind the keyboard), so the sheet translates up by this.
 *
 * No Capacitor Keyboard plugin: `visualViewport` is present in WKWebView and
 * every target browser, so this stays a dependency-free web API and needs no
 * native sync (rule 14). Falls back to `window.innerHeight` with a zero inset
 * where `visualViewport` is unavailable.
 */
import { useSyncExternalStore } from 'react';

export interface KeyboardViewport {
  visibleHeight: number;
  keyboardInset: number;
}

function subscribe(callback: () => void): () => void {
  const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
  if (!vv) return () => {};
  vv.addEventListener('resize', callback);
  vv.addEventListener('scroll', callback);
  return () => {
    vv.removeEventListener('resize', callback);
    vv.removeEventListener('scroll', callback);
  };
}

// `useSyncExternalStore` requires a stable snapshot: returning a fresh object
// every call would loop it. Cache and only replace when a value actually moves.
let cached: KeyboardViewport = { visibleHeight: 0, keyboardInset: 0 };

function getSnapshot(): KeyboardViewport {
  if (typeof window === 'undefined') return cached;
  const vv = window.visualViewport;
  const visibleHeight = vv ? vv.height : window.innerHeight;
  // Everything the layout viewport has that the visual viewport does not,
  // below the visible area: the keyboard (plus any top offset it introduced).
  const keyboardInset = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  if (visibleHeight !== cached.visibleHeight || keyboardInset !== cached.keyboardInset) {
    cached = { visibleHeight, keyboardInset };
  }
  return cached;
}

export function useKeyboardViewport(): KeyboardViewport {
  return useSyncExternalStore(subscribe, getSnapshot, () => cached);
}
