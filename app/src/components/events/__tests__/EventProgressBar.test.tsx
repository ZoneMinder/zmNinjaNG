/**
 * EventProgressBar Tests
 *
 * Covers click/tap-to-seek mapping. The scrubber previously had only mouse
 * handlers, so touch seeking did nothing on mobile (refs #196).
 * Also covers debounce/dedup behavior added in refs #196 to stop
 * the ZMS seek flood during drags.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { EventProgressBar } from '../EventProgressBar';
import { EVENT_SCRUB_SEEK_DEBOUNCE_MS } from '../../../lib/zmninja-ng-constants';

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

describe('EventProgressBar debounce/dedup (refs #196)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // Case 1: mousemove events during continuous drag must NOT seek; only
  // mousedown fires an immediate seek. Debounce must keep resetting so
  // continuous motion never triggers the timer.
  it('does not seek during continuous drag motion', () => {
    vi.useFakeTimers();
    const onSeek = vi.fn();
    const { getByTestId } = render(
      <EventProgressBar currentFrame={1} totalFrames={200} onSeek={onSeek} />
    );
    const track = getByTestId('event-progress-track');
    stubTrackGeometry(track);

    // mousedown fires 1 immediate seek.
    fireEvent.mouseDown(track, { clientX: 20 });
    expect(onSeek).toHaveBeenCalledTimes(1);
    onSeek.mockClear();

    // Rapid moves, each advancing less than the debounce threshold so the timer
    // is always reset before it can fire.
    for (let px = 30; px <= 80; px += 10) {
      fireEvent.mouseMove(window, { clientX: px });
      act(() => { vi.advanceTimersByTime(50); }); // 50ms < EVENT_SCRUB_SEEK_DEBOUNCE_MS
    }

    // No seeks during motion.
    expect(onSeek).not.toHaveBeenCalled();

    fireEvent.mouseUp(window);
  });

  // Case 2: when the user pauses (motion stops and the debounce elapses), exactly
  // one seek fires with the last dragged-to frame.
  it('fires exactly one seek to the last frame when motion pauses', () => {
    vi.useFakeTimers();
    const onSeek = vi.fn();
    const { getByTestId } = render(
      <EventProgressBar currentFrame={1} totalFrames={200} onSeek={onSeek} />
    );
    const track = getByTestId('event-progress-track');
    stubTrackGeometry(track);

    fireEvent.mouseDown(track, { clientX: 20 }); // frame 20
    onSeek.mockClear();

    // Three rapid moves, each resetting the debounce timer.
    fireEvent.mouseMove(window, { clientX: 60 }); // frame 60
    act(() => { vi.advanceTimersByTime(50); });
    fireEvent.mouseMove(window, { clientX: 100 }); // frame 100
    act(() => { vi.advanceTimersByTime(50); });
    fireEvent.mouseMove(window, { clientX: 140 }); // frame 140 (last)

    // Advance past the debounce threshold: timer fires for the last position.
    act(() => { vi.advanceTimersByTime(EVENT_SCRUB_SEEK_DEBOUNCE_MS); });

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(140);

    fireEvent.mouseUp(window);
  });

  // Case 3: mouseup before the debounce elapses must cancel the pending timer
  // and seek to the FINAL drag frame immediately. No extra seek after the
  // debounce interval passes.
  it('mouseup cancels pending debounce and seeks to the final frame immediately', () => {
    vi.useFakeTimers();
    const onSeek = vi.fn();
    const { getByTestId } = render(
      <EventProgressBar currentFrame={1} totalFrames={200} onSeek={onSeek} />
    );
    const track = getByTestId('event-progress-track');
    stubTrackGeometry(track);

    fireEvent.mouseDown(track, { clientX: 20 }); // frame 20
    onSeek.mockClear();

    // Move twice: timer is pending after each.
    fireEvent.mouseMove(window, { clientX: 100 }); // frame 100
    fireEvent.mouseMove(window, { clientX: 160 }); // frame 160 (final)

    // Release before debounce fires: must cancel timer and seek once to frame 160.
    fireEvent.mouseUp(window);
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(160);

    // No extra seek after the debounce interval would have elapsed.
    act(() => { vi.advanceTimersByTime(EVENT_SCRUB_SEEK_DEBOUNCE_MS + 50); });
    expect(onSeek).toHaveBeenCalledTimes(1);
  });

  // Case 4: if the debounce already seeked the final frame, the release seek
  // must not duplicate it.
  it('release does not duplicate seek when debounce already committed the final frame', () => {
    vi.useFakeTimers();
    const onSeek = vi.fn();
    const { getByTestId } = render(
      <EventProgressBar currentFrame={1} totalFrames={200} onSeek={onSeek} />
    );
    const track = getByTestId('event-progress-track');
    stubTrackGeometry(track);

    fireEvent.mouseDown(track, { clientX: 20 }); // frame 20
    onSeek.mockClear();

    // Move to frame 160 and let the debounce fire.
    fireEvent.mouseMove(window, { clientX: 160 }); // frame 160
    act(() => { vi.advanceTimersByTime(EVENT_SCRUB_SEEK_DEBOUNCE_MS); });
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(160);
    onSeek.mockClear();

    // Release at the same position: dedup must suppress the redundant seek.
    fireEvent.mouseUp(window);
    expect(onSeek).not.toHaveBeenCalled();
  });
});
