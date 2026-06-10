import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ZmsEventPlayer } from '../ZmsEventPlayer';

const httpGetMock = vi.fn().mockResolvedValue({ data: {} });

vi.mock('../../../lib/http', () => ({
  httpGet: (...args: unknown[]) => httpGetMock(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../../lib/logger', () => ({
  log: {
    zmsEventPlayer: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
  },
}));

vi.mock('../../../hooks/useBandwidthSettings', () => ({
  // Large interval so the status poll never fires during a test
  useBandwidthSettings: () => ({ zmsStatusInterval: 600000 }),
}));

vi.mock('../../../hooks/useFreshAccessToken', () => ({
  useFreshAccessToken: () => ({ isFresh: true }),
}));

vi.mock('../../../hooks/useZoomPan', () => ({
  useZoomPan: () => ({
    ref: () => {},
    innerRef: () => {},
    scale: 1,
    isZoomed: false,
    reset: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    panLeft: vi.fn(),
    panRight: vi.fn(),
    panUp: vi.fn(),
    panDown: vi.fn(),
  }),
}));

vi.mock('../../../api/events', () => ({
  getEventImageUrl: vi.fn().mockReturnValue('https://zm.test/image.jpg'),
}));

function renderPlayer() {
  return render(
    <ZmsEventPlayer
      portalUrl="https://zm.test"
      eventId="42"
      token="tok"
      totalFrames={100}
      alarmFrames={0}
      eventLength={10}
    />
  );
}

function getStreamImg(): HTMLImageElement {
  return screen.getByAltText('event_detail.event_playback') as HTMLImageElement;
}

function connkeyOf(url: string): string | null {
  return new URL(url).searchParams.get('connkey');
}

describe('ZmsEventPlayer', () => {
  beforeEach(() => {
    cleanup();
    httpGetMock.mockClear();
  });

  it('keeps the img src and connkey unchanged when playback speed changes', () => {
    renderPlayer();
    const initialSrc = getStreamImg().src;
    const initialConnkey = connkeyOf(initialSrc);
    expect(initialConnkey).toBeTruthy();
    expect(new URL(initialSrc).searchParams.get('rate')).toBe('100');

    fireEvent.click(screen.getByTestId('zms-speed-200'));

    expect(getStreamImg().src).toBe(initialSrc);
    expect(connkeyOf(getStreamImg().src)).toBe(initialConnkey);
  });

  it('sends CMD_VARPLAY with the new rate over the existing connkey on speed change', () => {
    renderPlayer();
    const streamConnkey = connkeyOf(getStreamImg().src);

    fireEvent.click(screen.getByTestId('zms-speed-200'));

    const varplayCall = httpGetMock.mock.calls.find(
      (call) => new URL(call[0] as string).searchParams.get('command') === '15'
    );
    expect(varplayCall).toBeDefined();
    const url = new URL(varplayCall![0] as string);
    expect(url.searchParams.get('rate')).toBe('200');
    expect(url.searchParams.get('connkey')).toBe(streamConnkey);
  });

  it('resumes the playing state after a speed change', () => {
    renderPlayer();
    // Pause first (command=1)
    fireEvent.click(screen.getByTestId('zms-play-pause'));
    const pauseCall = httpGetMock.mock.calls.find(
      (call) => new URL(call[0] as string).searchParams.get('command') === '1'
    );
    expect(pauseCall).toBeDefined();

    fireEvent.click(screen.getByTestId('zms-speed-50'));

    // Player shows the pause icon again, meaning isPlaying is true
    expect(screen.getByTestId('zms-play-pause').getAttribute('title')).toBe('event_detail.pause');
  });

  it('sends CMD_QUIT for the stream connkey on unmount', () => {
    const { unmount } = renderPlayer();
    const streamConnkey = connkeyOf(getStreamImg().src);

    unmount();

    const quitCalls = httpGetMock.mock.calls.filter(
      (call) => new URL(call[0] as string).searchParams.get('command') === '17'
    );
    expect(quitCalls).toHaveLength(1);
    expect(connkeyOf(quitCalls[0][0] as string)).toBe(streamConnkey);
  });
});
