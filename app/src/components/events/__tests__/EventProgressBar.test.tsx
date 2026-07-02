/**
 * EventProgressBar Tests
 *
 * Covers click/tap-to-seek mapping. The scrubber previously had only mouse
 * handlers, so touch seeking did nothing on mobile (refs #196).
 * Also covers throttle/dedup/flush behavior added in refs #196 to stop
 * the ZMS seek flood during drags.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { EventProgressBar } from '../EventProgressBar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// jsdom does no layout, so stub the track geometry: 0..200px wide.
function stubTrackGeometry(track: Element) {
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    width: 200,
    top: 0,
    height: 8,
    right: 200,
    bottom: 8,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

describe('EventProgressBar seek mapping', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps a mouse click to the matching frame', () => {
    const onSeek = vi.fn();
    const { getByTestId } = render(
      <EventProgressBar currentFrame={1} totalFrames={100} onSeek={onSeek} />
    );
    const track = getByTestId('event-progress-track');
    stubTrackGeometry(track);

    // Click at the midpoint of a 200px-wide track -> frame 50 of 100.
    fireEvent.mouseDown(track, { clientX: 100 });
    expect(onSeek).toHaveBeenCalledWith(50);
  });

  it('maps a touch tap to the matching frame (mobile)', () => {
    const onSeek = vi.fn();
    const { getByTestId } = render(
      <EventProgressBar currentFrame={1} totalFrames={100} onSeek={onSeek} />
    );
    const track = getByTestId('event-progress-track');
    stubTrackGeometry(track);

    // Tap at 75% of the track -> frame 75 of 100.
    fireEvent.touchStart(track, { touches: [{ clientX: 150 }] });
    expect(onSeek).toHaveBeenCalledWith(75);
  });

  it('clamps a touch beyond the track to the last frame', () => {
    const onSeek = vi.fn();
    const { getByTestId } = render(
      <EventProgressBar currentFrame={1} totalFrames={100} onSeek={onSeek} />
    );
    const track = getByTestId('event-progress-track');
    stubTrackGeometry(track);

    fireEvent.touchStart(track, { touches: [{ clientX: 999 }] });
    expect(onSeek).toHaveBeenCalledWith(100);
  });

  // Scrub lifecycle: the player pauses the stream and stops its status poll
  // from fighting the cursor while a drag is in progress (refs #196).
  it('signals scrub start on mouse down and scrub end on mouse up', () => {
    const onScrubStart = vi.fn();
    const onScrubEnd = vi.fn();
    const { getByTestId } = render(
      <EventProgressBar
        currentFrame={1}
        totalFrames={100}
        onSeek={vi.fn()}
        onScrubStart={onScrubStart}
        onScrubEnd={onScrubEnd}
      />
    );
    const track = getByTestId('event-progress-track');
    stubTrackGeometry(track);

    fireEvent.mouseDown(track, { clientX: 100 });
    expect(onScrubStart).toHaveBeenCalledTimes(1);
    expect(onScrubEnd).not.toHaveBeenCalled();

    fireEvent.mouseUp(window);
    expect(onScrubEnd).toHaveBeenCalledTimes(1);
  });

  it('signals scrub start on touch start and scrub end on touch end', () => {
    const onScrubStart = vi.fn();
    const onScrubEnd = vi.fn();
    const { getByTestId } = render(
      <EventProgressBar
        currentFrame={1}
        totalFrames={100}
        onSeek={vi.fn()}
        onScrubStart={onScrubStart}
        onScrubEnd={onScrubEnd}
      />
    );
    const track = getByTestId('event-progress-track');
    stubTrackGeometry(track);

    fireEvent.touchStart(track, { touches: [{ clientX: 100 }] });
    expect(onScrubStart).toHaveBeenCalledTimes(1);
    expect(onScrubEnd).not.toHaveBeenCalled();

    fireEvent.touchEnd(window);
    expect(onScrubEnd).toHaveBeenCalledTimes(1);
  });
});

describe('EventProgressBar throttle/dedup/flush (refs #196)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('20 rapid mousemove events within one throttle window produce at most 3 onSeek calls', () => {
    vi.useFakeTimers();
    const onSeek = vi.fn();
    const { getByTestId } = render(
      <EventProgressBar currentFrame={1} totalFrames={200} onSeek={onSeek} />
    );
    const track = getByTestId('event-progress-track');
    stubTrackGeometry(track);

    // Initiate drag. mouseDown calls flush -> leading seek at frame 10.
    fireEvent.mouseDown(track, { clientX: 10 });
    onSeek.mockClear();

    // Fire 20 mousemove events sweeping from px 20 to px 40 (frames 20-40).
    // All within the same 150ms throttle window.
    for (let px = 20; px <= 40; px++) {
      fireEvent.mouseMove(window, { clientX: px });
    }

    // Advance timers past throttle to flush the trailing call.
    act(() => { vi.advanceTimersByTime(200); });

    // 20 moves should produce far fewer than 20 seeks.
    // Leading edge fires immediately on first move; trailing fires once after timeout.
    expect(onSeek.mock.calls.length).toBeLessThanOrEqual(3);

    fireEvent.mouseUp(window);
  });

  it('two moves resolving to the same frame do not produce two onSeek calls', () => {
    vi.useFakeTimers();
    const onSeek = vi.fn();
    const { getByTestId } = render(
      <EventProgressBar currentFrame={1} totalFrames={200} onSeek={onSeek} />
    );
    const track = getByTestId('event-progress-track');
    stubTrackGeometry(track);

    // Start drag at px 100 -> frame 100.
    fireEvent.mouseDown(track, { clientX: 100 });
    onSeek.mockClear();

    // Two moves to the exact same pixel (same resulting frame).
    fireEvent.mouseMove(window, { clientX: 100 });
    act(() => { vi.advanceTimersByTime(200); });
    fireEvent.mouseMove(window, { clientX: 100 });
    act(() => { vi.advanceTimersByTime(200); });

    // Dedup: frame 100 was already the last-sent frame, so no new seeks.
    expect(onSeek).not.toHaveBeenCalled();

    fireEvent.mouseUp(window);
  });

  it('mouseup after a throttled move immediately seeks to the final frame', () => {
    vi.useFakeTimers();
    const onSeek = vi.fn();
    const { getByTestId } = render(
      <EventProgressBar currentFrame={1} totalFrames={200} onSeek={onSeek} />
    );
    const track = getByTestId('event-progress-track');
    stubTrackGeometry(track);

    // Start drag at px 20 -> frame 20.
    fireEvent.mouseDown(track, { clientX: 20 });
    onSeek.mockClear();

    // Move to px 120 (frame 120) without advancing time (timer still pending).
    fireEvent.mouseMove(window, { clientX: 120 });

    // Move again to px 160 (frame 160) - this is the final drag position.
    fireEvent.mouseMove(window, { clientX: 160 });

    // Release without advancing timers. The flush on mouseup must send frame 160 now.
    fireEvent.mouseUp(window);

    expect(onSeek).toHaveBeenLastCalledWith(160);
  });
});
