import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScrollAffordance } from '../useScrollAffordance';

/** Captures the ResizeObserver callbacks so a test can fire them by hand. */
const observers: Array<() => void> = [];

function setPointer(coarse: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: coarse && query.includes('coarse'),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

/** A scrolling ancestor with `content` inside it, sized as asked. */
function mountScroller(scrollHeight: number, clientHeight: number) {
  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  Object.defineProperty(scroller, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { value: clientHeight, configurable: true });

  const content = document.createElement('div');
  scroller.appendChild(content);
  document.body.appendChild(scroller);
  return { scroller, content };
}

describe('useScrollAffordance', () => {
  beforeEach(() => {
    observers.length = 0;
    global.ResizeObserver = class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is false on a fine pointer, where the wheel and scrollbar already work', () => {
    setPointer(false);
    const { content } = mountScroller(2000, 800);
    const { result } = renderHook(() => useScrollAffordance(content));
    expect(result.current).toBe(false);
  });

  it('is true on a touch screen when the scrolling ancestor overflows', () => {
    setPointer(true);
    const { content } = mountScroller(2000, 800);
    const { result } = renderHook(() => useScrollAffordance(content));
    expect(result.current).toBe(true);
  });

  it('is false on a touch screen when everything fits', () => {
    setPointer(true);
    const { content } = mountScroller(800, 800);
    const { result } = renderHook(() => useScrollAffordance(content));
    expect(result.current).toBe(false);
  });

  it('re-measures when the content resizes', () => {
    setPointer(true);
    const { scroller, content } = mountScroller(800, 800);
    const { result } = renderHook(() => useScrollAffordance(content));
    expect(result.current).toBe(false);

    Object.defineProperty(scroller, 'scrollHeight', { value: 2400, configurable: true });
    act(() => observers.forEach((fire) => fire()));
    expect(result.current).toBe(true);
  });
});
