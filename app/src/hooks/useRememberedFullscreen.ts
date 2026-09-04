import { useCallback, useEffect, useState } from 'react';

/** A handheld turned sideways: landscape on a touch screen. Desktop windows
 *  are landscape all day, so the pointer clause keeps them out. */
const LANDSCAPE_TOUCH_QUERY = '(orientation: landscape) and (pointer: coarse)';

function isLandscapeTouch(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(LANDSCAPE_TOUCH_QUERY).matches;
}

/**
 * Fullscreen for a player page: the persisted flag is the user's choice, and
 * rotating a phone to landscape adds a temporary fullscreen on top that is
 * never written back (refs #462, #463). Turning back to portrait drops the
 * temporary part; explicitly leaving fullscreen while landscape sticks until
 * the next rotation in. `setFullscreen` is the user's own toggle and always
 * persists.
 */
export function useRememberedFullscreen({ persisted, persist }: {
  persisted: boolean;
  persist: (fullscreen: boolean) => void;
}): [isFullscreen: boolean, setFullscreen: (fullscreen: boolean) => void] {
  const [landscape, setLandscape] = useState(isLandscapeTouch);
  const [leftWhileLandscape, setLeftWhileLandscape] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(LANDSCAPE_TOUCH_QUERY);
    const onChange = (e: { matches: boolean }) => {
      setLandscape(e.matches);
      setLeftWhileLandscape(false);
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const setFullscreen = useCallback((fullscreen: boolean) => {
    persist(fullscreen);
    setLeftWhileLandscape(!fullscreen);
  }, [persist]);

  return [persisted || (landscape && !leftWhileLandscape), setFullscreen];
}
