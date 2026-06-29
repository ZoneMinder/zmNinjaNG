/**
 * EventProgressBar Tests
 *
 * Covers click/tap-to-seek mapping. The scrubber previously had only mouse
 * handlers, so touch seeking did nothing on mobile (refs #196).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
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
});
