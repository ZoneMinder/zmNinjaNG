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

function setRect(el: HTMLElement, top: number, bottom: number) {
  el.getBoundingClientRect = () => ({ top, bottom, height: bottom - top }) as DOMRect;
}

/**
 * A scrolling ancestor holding a page, with the video (the gesture surface)
 * inside it. `videoTop`/`videoBottom` are viewport coordinates, the same frame
 * getBoundingClientRect reports in.
 */
function mountPage(opts: {
  scrollHeight: number;
  clientHeight: number;
  videoTop: number;
  videoBottom: number;
}) {
  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  Object.defineProperty(scroller, 'scrollHeight', { value: opts.scrollHeight, configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { value: opts.clientHeight, configurable: true });
  setRect(scroller, 0, opts.clientHeight);

  const content = document.createElement('div');
  const video = document.createElement('div');
  setRect(video, opts.videoTop, opts.videoBottom);
  content.appendChild(video);
  scroller.appendChild(content);
  document.body.appendChild(scroller);
  return { scroller, content, video };
}

/** Landscape tablet: the video fills everything under a 56px header. */
const noRoomToSwipe = { scrollHeight: 2400, clientHeight: 800, videoTop: 56, videoBottom: 800 };
/** Portrait: the video takes the top third, the rest is free to drag. */
const roomToSwipe = { scrollHeight: 2400, clientHeight: 1200, videoTop: 56, videoBottom: 460 };
/**
 * Monitor detail in landscape, where the player is capped at 100svh-7rem: 112px
 * of page always remains, which is a strip at the screen edges rather than
 * somewhere to swipe. This is the layout #365 reported.
 */
const cappedPlayer = { scrollHeight: 2400, clientHeight: 800, videoTop: 56, videoBottom: 744 };

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

  it('is true when the gesture surface leaves nothing to swipe', () => {
    setPointer(true);
    const { content, video } = mountPage(noRoomToSwipe);
    const { result } = renderHook(() => useScrollAffordance(content, video));
    expect(result.current.needsPad).toBe(true);
  });

  it('is true when the capped player still dominates the screen', () => {
    setPointer(true);
    const { content, video } = mountPage(cappedPlayer);
    const { result } = renderHook(() => useScrollAffordance(content, video));
    expect(result.current.needsPad).toBe(true);
  });

  it('is false when the page has free surface to drag, even though it scrolls', () => {
    setPointer(true);
    const { content, video } = mountPage(roomToSwipe);
    const { result } = renderHook(() => useScrollAffordance(content, video));
    expect(result.current.needsPad).toBe(false);
  });

  it('is false on a fine pointer, where the wheel and scrollbar already work', () => {
    setPointer(false);
    const { content, video } = mountPage(noRoomToSwipe);
    const { result } = renderHook(() => useScrollAffordance(content, video));
    expect(result.current.needsPad).toBe(false);
  });

  it('is false when the page does not overflow at all', () => {
    setPointer(true);
    const { content, video } = mountPage({ ...noRoomToSwipe, scrollHeight: 800 });
    const { result } = renderHook(() => useScrollAffordance(content, video));
    expect(result.current.needsPad).toBe(false);
  });

  it('is false before the gesture surface has mounted', () => {
    setPointer(true);
    const { content } = mountPage(noRoomToSwipe);
    const { result } = renderHook(() => useScrollAffordance(content, null));
    expect(result.current.needsPad).toBe(false);
  });

  it('offers the pad by hand whenever a touch page scrolls, even with room to swipe', () => {
    setPointer(true);
    const { content, video } = mountPage(roomToSwipe);
    const { result } = renderHook(() => useScrollAffordance(content, video));
    expect(result.current.needsPad).toBe(false);
    expect(result.current.offerPad).toBe(true);
  });

  it('does not offer the pad on a page that does not scroll', () => {
    setPointer(true);
    const { content, video } = mountPage({ ...roomToSwipe, scrollHeight: 1200 });
    const { result } = renderHook(() => useScrollAffordance(content, video));
    expect(result.current.offerPad).toBe(false);
  });

  it('does not offer the pad on a fine pointer', () => {
    setPointer(false);
    const { content, video } = mountPage(cappedPlayer);
    const { result } = renderHook(() => useScrollAffordance(content, video));
    expect(result.current.offerPad).toBe(false);
  });

  it('re-measures when the layout changes, such as a rotation', () => {
    setPointer(true);
    const { content, video } = mountPage(roomToSwipe);
    const { result } = renderHook(() => useScrollAffordance(content, video));
    expect(result.current.needsPad).toBe(false);

    // Rotate to landscape: the video now covers everything below the header.
    setRect(video, 56, 1200);
    act(() => observers.forEach((fire) => fire()));
    expect(result.current.needsPad).toBe(true);
  });
});
