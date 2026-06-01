import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useVisibilityResume } from '../useVisibilityResume';

let mockIsElectron = false;
vi.mock('../../lib/platform', () => ({
  Platform: {
    get isElectron() {
      return mockIsElectron;
    },
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
