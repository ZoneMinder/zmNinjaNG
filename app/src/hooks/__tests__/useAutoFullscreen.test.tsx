/**
 * useAutoFullscreen: the "open in fullscreen" setting seeds the page, a
 * phone turned to landscape adds a temporary fullscreen on top, and the
 * page's own buttons only change the session. Nothing here writes a setting
 * (refs #462, #463).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoFullscreen } from '../useAutoFullscreen';

type Listener = (e: { matches: boolean }) => void;
let listeners: Listener[];
let landscape: boolean;

beforeEach(() => {
  listeners = [];
  landscape = false;
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    get matches() { return landscape; },
    addEventListener: (_: string, fn: Listener) => { listeners.push(fn); },
    removeEventListener: (_: string, fn: Listener) => { listeners = listeners.filter((l) => l !== fn); },
  })));
});
afterEach(() => vi.unstubAllGlobals());

function rotate(toLandscape: boolean) {
  landscape = toLandscape;
  act(() => listeners.forEach((l) => l({ matches: toLandscape })));
}

describe('useAutoFullscreen', () => {
  it('starts from the setting and lets the user toggle the session', () => {
    const { result } = renderHook(() => useAutoFullscreen({ startFullscreen: true }));
    expect(result.current[0]).toBe(true);

    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
  });

  it('goes fullscreen on rotation to landscape and back on portrait', () => {
    const { result } = renderHook(() => useAutoFullscreen({ startFullscreen: false }));

    rotate(true);
    expect(result.current[0]).toBe(true);
    rotate(false);
    expect(result.current[0]).toBe(false);
  });

  it('starts fullscreen when mounted already in landscape', () => {
    landscape = true;
    const { result } = renderHook(() => useAutoFullscreen({ startFullscreen: false }));
    expect(result.current[0]).toBe(true);
  });

  it('lets the user leave a rotation fullscreen, and rotates in again next time', () => {
    const { result } = renderHook(() => useAutoFullscreen({ startFullscreen: false }));

    rotate(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);

    rotate(false);
    rotate(true);
    expect(result.current[0]).toBe(true);
  });

  it('keeps a setting-driven fullscreen after rotating back to portrait', () => {
    const { result } = renderHook(() => useAutoFullscreen({ startFullscreen: true }));
    rotate(true);
    rotate(false);
    expect(result.current[0]).toBe(true);
  });

  it('drops the session override when the subject changes', () => {
    const { result, rerender } = renderHook(
      ({ key }) => useAutoFullscreen({ startFullscreen: true, resetKey: key }),
      { initialProps: { key: '1' } },
    );
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);

    rerender({ key: '2' });
    expect(result.current[0]).toBe(true);
  });
});
