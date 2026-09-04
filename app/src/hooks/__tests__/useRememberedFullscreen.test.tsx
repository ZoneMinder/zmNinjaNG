/**
 * useRememberedFullscreen: the persisted flag is the user's choice; a phone
 * turned to landscape adds a temporary fullscreen on top that is never
 * written back (refs #462, #463).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRememberedFullscreen } from '../useRememberedFullscreen';

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

describe('useRememberedFullscreen', () => {
  it('follows the persisted flag and writes user changes back', () => {
    const persist = vi.fn();
    const { result, rerender } = renderHook(
      ({ persisted }) => useRememberedFullscreen({ persisted, persist }),
      { initialProps: { persisted: false } },
    );
    expect(result.current[0]).toBe(false);

    act(() => result.current[1](true));
    expect(persist).toHaveBeenCalledWith(true);
    rerender({ persisted: true });
    expect(result.current[0]).toBe(true);
  });

  it('goes fullscreen on rotation to landscape without persisting, and back on portrait', () => {
    const persist = vi.fn();
    const { result } = renderHook(() => useRememberedFullscreen({ persisted: false, persist }));

    rotate(true);
    expect(result.current[0]).toBe(true);
    expect(persist).not.toHaveBeenCalled();

    rotate(false);
    expect(result.current[0]).toBe(false);
  });

  it('starts fullscreen when mounted already in landscape', () => {
    landscape = true;
    const { result } = renderHook(() => useRememberedFullscreen({ persisted: false, persist: vi.fn() }));
    expect(result.current[0]).toBe(true);
  });

  it('lets the user leave a rotation fullscreen, and rotates in again next time', () => {
    const persist = vi.fn();
    const { result } = renderHook(() => useRememberedFullscreen({ persisted: false, persist }));

    rotate(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(persist).toHaveBeenCalledWith(false);

    rotate(false);
    rotate(true);
    expect(result.current[0]).toBe(true);
  });

  it('keeps a persisted fullscreen after rotating back to portrait', () => {
    const { result } = renderHook(() => useRememberedFullscreen({ persisted: true, persist: vi.fn() }));
    rotate(true);
    rotate(false);
    expect(result.current[0]).toBe(true);
  });
});
