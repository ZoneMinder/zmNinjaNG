import { useCallback, useEffect, useState } from 'react';

/** A handheld turned sideways: landscape on a touch screen. Desktop windows
 *  are landscape all day, so the pointer clause keeps them out. */
const LANDSCAPE_TOUCH_QUERY = '(orientation: landscape) and (pointer: coarse)';

function isLandscapeTouch(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(LANDSCAPE_TOUCH_QUERY).matches;
}

/**
 * Fullscreen for a player page. `startFullscreen` is the user's setting
 * ("open in fullscreen"), a phone turned to landscape adds a temporary
 * fullscreen on top, and the page's own maximize/exit buttons change only
 * this session through `setFullscreen`. Nothing here writes a setting: the
 * only way off a fullscreen page is its exit button, so persisting that exit
 * would make the memory impossible to keep (refs #462, #463).
 *
 * A session override lasts until the next rotation or until `resetKey`
 * changes (the detail page stays mounted across monitors).
 */
export function useAutoFullscreen({ startFullscreen, resetKey }: {
  startFullscreen: boolean;
  resetKey?: string;
}): [isFullscreen: boolean, setFullscreen: (fullscreen: boolean) => void] {
  const [landscape, setLandscape] = useState(isLandscapeTouch);
  const [override, setOverride] = useState<{ key: string | undefined; value: boolean } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(LANDSCAPE_TOUCH_QUERY);
    const onChange = (e: { matches: boolean }) => {
      setLandscape(e.matches);
      setOverride(null);
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const setFullscreen = useCallback((fullscreen: boolean) => {
    setOverride({ key: resetKey, value: fullscreen });
  }, [resetKey]);

  const active = override && override.key === resetKey ? override.value : null;
  return [active ?? (startFullscreen || landscape), setFullscreen];
}
