import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useVisibilityResume } from '../useVisibilityResume';

let mockIsElectron = false;
let mockIsNative = false;
vi.mock('../../lib/platform', () => ({
  Platform: {
    get isElectron() {
      return mockIsElectron;
    },
    get isNative() {
      return mockIsNative;
    },
  },
}));

// Stands in for the Capacitor App plugin: the test drives appStateChange
// directly instead of loading a plugin that does not exist under vitest.
let appStateHandler: ((state: { isActive: boolean }) => void) | null = null;
vi.mock('../useCapacitorListener', () => ({
  useCapacitorListener: (
    _getPlugin: unknown,
    eventName: string,
    handler: (state: { isActive: boolean }) => void,
    opts?: { enabled?: boolean },
  ) => {
    if (eventName === 'appStateChange' && opts?.enabled !== false) appStateHandler = handler;
  },
}));

let visibilityState: DocumentVisibilityState = 'visible';

function setVisibility(next: DocumentVisibilityState) {
  visibilityState = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useVisibilityResume', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibilityState = 'visible';
    mockIsElectron = false;
    mockIsNative = false;
    appStateHandler = null;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires the callback when returning to visible after being hidden long enough', () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityResume(cb, { minHiddenMs: 1000 }));

    setVisibility('hidden');
    vi.advanceTimersByTime(2000);
    setVisibility('visible');

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not fire if the hidden interval is too short (flicker)', () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityResume(cb, { minHiddenMs: 1500 }));

    setVisibility('hidden');
    vi.advanceTimersByTime(200);
    setVisibility('visible');

    expect(cb).not.toHaveBeenCalled();
  });

  it('does not fire when the page becomes visible without a prior hidden state', () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityResume(cb));

    // No hidden transition first; spurious visible event should be a no-op.
    setVisibility('visible');
    expect(cb).not.toHaveBeenCalled();
  });

  it('is inert when enabled is false', () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityResume(cb, { enabled: false, minHiddenMs: 1000 }));

    setVisibility('hidden');
    vi.advanceTimersByTime(5000);
    setVisibility('visible');

    expect(cb).not.toHaveBeenCalled();
  });

  it('uses the latest callback reference without re-subscribing', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }: { cb: () => void }) => useVisibilityResume(cb, { minHiddenMs: 500 }), {
      initialProps: { cb: first },
    });

    rerender({ cb: second });
    setVisibility('hidden');
    vi.advanceTimersByTime(1000);
    setVisibility('visible');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('cleans up on unmount', () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useVisibilityResume(cb, { minHiddenMs: 500 }));
    unmount();

    setVisibility('hidden');
    vi.advanceTimersByTime(2000);
    setVisibility('visible');

    expect(cb).not.toHaveBeenCalled();
  });

  it('does not fire on the first reveal when mounted while already hidden (startup)', () => {
    // Electron creates the window with show:false, so the page mounts while
    // hidden and is revealed later. That first reveal must not be treated as a
    // return-from-away. refs #150
    visibilityState = 'hidden';
    const cb = vi.fn();
    renderHook(() => useVisibilityResume(cb, { minHiddenMs: 1000 }));

    vi.advanceTimersByTime(5000);
    setVisibility('visible');

    expect(cb).not.toHaveBeenCalled();
  });

  it('fires on window focus after a blur on Electron (occlusion behind another app)', () => {
    mockIsElectron = true;
    const cb = vi.fn();
    renderHook(() => useVisibilityResume(cb, { minHiddenMs: 1000 }));

    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(2000);
    window.dispatchEvent(new Event('focus'));

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not fire on a quick blur/focus flicker on Electron', () => {
    mockIsElectron = true;
    const cb = vi.fn();
    renderHook(() => useVisibilityResume(cb, { minHiddenMs: 1500 }));

    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(200);
    window.dispatchEvent(new Event('focus'));

    expect(cb).not.toHaveBeenCalled();
  });

  it('ignores window focus/blur off Electron (web/mobile use visibility only)', () => {
    mockIsElectron = false;
    const cb = vi.fn();
    renderHook(() => useVisibilityResume(cb, { minHiddenMs: 1000 }));

    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(2000);
    window.dispatchEvent(new Event('focus'));

    expect(cb).not.toHaveBeenCalled();
  });

  it('forgets an away-marker left behind when the subscription is turned off', () => {
    // A montage tile that pauses while hidden disables this hook mid-away
    // (refs #337). Re-enabling on return leaves the old marker in place unless
    // the cleanup clears it, and the next quick flick then measures its gap
    // from minutes ago and reconnects every tile.
    const cb = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useVisibilityResume(cb, { enabled, minHiddenMs: 1500 }),
      { initialProps: { enabled: true } },
    );

    setVisibility('hidden');
    vi.advanceTimersByTime(60_000);
    rerender({ enabled: false });
    setVisibility('visible');
    rerender({ enabled: true });

    // A 500ms flick is exactly what minHiddenMs exists to ignore.
    setVisibility('hidden');
    vi.advanceTimersByTime(500);
    setVisibility('visible');

    expect(cb).not.toHaveBeenCalled();
  });

  it('does not double-fire when minimize triggers both blur and visibilitychange on Electron', () => {
    mockIsElectron = true;
    const cb = vi.fn();
    renderHook(() => useVisibilityResume(cb, { minHiddenMs: 1000 }));

    // Minimize: both blur and visibilitychange(hidden) fire.
    window.dispatchEvent(new Event('blur'));
    setVisibility('hidden');
    vi.advanceTimersByTime(2000);
    // Restore: both focus and visibilitychange(visible) fire.
    window.dispatchEvent(new Event('focus'));
    setVisibility('visible');

    expect(cb).toHaveBeenCalledTimes(1);
  });
});

// refs #352: on native the WebView suspends with the app and its timers freeze,
// and visibilitychange is not something a WebView is obliged to fire on an app
// state change. Notifications already learned this in #274; streams recover
// through this hook, so it needs the same signal.
describe('useVisibilityResume on native', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibilityState = 'visible';
    mockIsElectron = false;
    mockIsNative = true;
    appStateHandler = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires when the app comes back to the foreground', () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityResume(cb, { minHiddenMs: 1000 }));

    expect(appStateHandler).not.toBeNull();
    appStateHandler!({ isActive: false });
    vi.advanceTimersByTime(2000);
    appStateHandler!({ isActive: true });

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('ignores an app-switch flick', () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityResume(cb, { minHiddenMs: 1500 }));

    appStateHandler!({ isActive: false });
    vi.advanceTimersByTime(200);
    appStateHandler!({ isActive: true });

    expect(cb).not.toHaveBeenCalled();
  });

  // Both signals can fire for one background/foreground round trip. The away
  // marker is shared, so the return resumes once, not once per signal.
  it('resumes once when both signals report the same round trip', () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityResume(cb, { minHiddenMs: 1000 }));

    appStateHandler!({ isActive: false });
    setVisibility('hidden');
    vi.advanceTimersByTime(2000);
    setVisibility('visible');
    appStateHandler!({ isActive: true });

    expect(cb).toHaveBeenCalledTimes(1);
  });
});
