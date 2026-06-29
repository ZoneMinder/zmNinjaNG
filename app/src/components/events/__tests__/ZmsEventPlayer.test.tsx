import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { StrictMode } from 'react';
import { ZmsEventPlayer } from '../ZmsEventPlayer';
import { ZM_INTEGRATION } from '../../../lib/zmninja-ng-constants';

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

vi.mock('../../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    currentProfile: null,
    settings: { apiTimeoutSeconds: 15 },
  }),
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

function quitCalls() {
  return httpGetMock.mock.calls.filter(
    (call) => new URL(call[0] as string).searchParams.get('command') === '17'
  );
}

function commandOf(url: string): string | null {
  return new URL(url).searchParams.get('command');
}

function callsForCommand(cmd: string) {
  return httpGetMock.mock.calls.filter((call) => commandOf(call[0] as string) === cmd);
}

// jsdom does no layout, so stub the scrub track as a 0..200px-wide element.
function stubTrack(): HTMLElement {
  const track = screen.getByTestId('event-progress-track');
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
    left: 0, width: 200, top: 0, height: 8, right: 200, bottom: 8, x: 0, y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  return track;
}

describe('ZmsEventPlayer', () => {
  beforeEach(() => {
    cleanup();
    httpGetMock.mockClear();
  });

  afterEach(() => {
    if (vi.isFakeTimers()) {
      // clear, not run: the status poll is a setInterval that runAllTimers
      // would loop on forever.
      vi.clearAllTimers();
      vi.useRealTimers();
    }
    // Restore the default resolved value: a test that installs its own
    // implementation must not leak into the next one.
    httpGetMock.mockReset();
    httpGetMock.mockResolvedValue({ data: {} });
  });

  it('seeks against the ZMS-reported duration, not the DB event length', async () => {
    vi.useFakeTimers();
    // eventLength prop is 10, but the running stream reports a 20s duration.
    httpGetMock.mockImplementation((url: string) => {
      if (commandOf(url) === '99') {
        return Promise.resolve({ data: { status: { progress: 0, duration: 20 } } });
      }
      return Promise.resolve({ data: {} });
    });
    renderPlayer();
    fireEvent.load(getStreamImg());

    // Fire one status poll so the player learns the real duration (20s).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600000);
    });

    // Seek to the end: the offset must be the full reported duration (20s),
    // not the DB Length (10s).
    fireEvent.click(screen.getByTestId('zms-go-to-end'));

    const seek = callsForCommand('14').at(-1);
    expect(seek).toBeDefined();
    expect(new URL(seek![0] as string).searchParams.get('offset')).toBe('20');
  });

  it('pauses the stream while scrubbing and resumes playing on release', () => {
    renderPlayer();
    fireEvent.load(getStreamImg());
    const track = stubTrack();

    // Grabbing the scrub bar pauses the running stream (CMD_PAUSE = 1) so the
    // video does not play forward between seeks.
    fireEvent.mouseDown(track, { clientX: 100 });
    expect(callsForCommand('1').length).toBeGreaterThan(0);

    // Releasing resumes playback (CMD_PLAY = 2).
    fireEvent.mouseUp(window);
    expect(callsForCommand('2').length).toBeGreaterThan(0);
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

  it('sends one CMD_QUIT with a timeout for the stream connkey on unmount', () => {
    vi.useFakeTimers();
    const { unmount } = renderPlayer();
    const img = getStreamImg();
    const streamConnkey = connkeyOf(img.src);
    fireEvent.load(img);

    unmount();
    // The quit is delayed by a grace period so a remount can cancel it
    expect(quitCalls()).toHaveLength(0);
    vi.advanceTimersByTime(ZM_INTEGRATION.cmdQuitGraceMs + 1);

    const quits = quitCalls();
    expect(quits).toHaveLength(1);
    expect(connkeyOf(quits[0][0] as string)).toBe(streamConnkey);
    // apiTimeoutSeconds (15) from profile settings, converted to ms
    expect(quits[0][1]).toEqual({ timeoutMs: 15000 });
  });

  it('does not send CMD_QUIT on unmount when the stream never loaded', () => {
    vi.useFakeTimers();
    const { unmount } = renderPlayer();

    unmount();
    vi.advanceTimersByTime(ZM_INTEGRATION.cmdQuitGraceMs * 2);

    expect(quitCalls()).toHaveLength(0);
  });

  it('does not kill the live stream under StrictMode double-mount', () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <StrictMode>
        <ZmsEventPlayer
          portalUrl="https://zm.test"
          eventId="42"
          token="tok"
          totalFrames={100}
          alarmFrames={0}
          eventLength={10}
        />
      </StrictMode>
    );
    const img = getStreamImg();
    const streamConnkey = connkeyOf(img.src);
    fireEvent.load(img);

    // No CMD_QUIT while the component remains mounted, even after the
    // StrictMode mount -> cleanup -> mount cycle and the grace delay
    vi.advanceTimersByTime(ZM_INTEGRATION.cmdQuitGraceMs * 2);
    expect(quitCalls()).toHaveLength(0);

    unmount();
    vi.advanceTimersByTime(ZM_INTEGRATION.cmdQuitGraceMs * 2);

    const quits = quitCalls();
    expect(quits).toHaveLength(1);
    expect(connkeyOf(quits[0][0] as string)).toBe(streamConnkey);
  });
});
