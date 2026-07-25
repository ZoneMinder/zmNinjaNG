import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { StrictMode } from 'react';
import { ZmsEventPlayer } from '../ZmsEventPlayer';
import { ZM_INTEGRATION, EVENT_SEEK_FLUSH_DELAY_MS } from '../../../lib/zmninja-ng-constants';

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
    eventProgressBar: vi.fn(),
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

function renderPlayer(props: { suspended?: boolean } = {}) {
  return render(
    <ZmsEventPlayer
      portalUrl="https://zm.test"
      eventId="42"
      token="tok"
      totalFrames={100}
      alarmFrames={0}
      eventLength={10}
      {...props}
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

  // Suspension (#272): the frame viewer covers the stream, so it pauses while
  // open and resumes on close. CMD_PAUSE is 1 and CMD_PLAY is 2.
  it('pauses a running stream while suspended and resumes it on release', () => {
    const { rerender } = renderPlayer();

    rerender(
      <ZmsEventPlayer portalUrl="https://zm.test" eventId="42" token="tok" totalFrames={100}
        alarmFrames={0} eventLength={10} suspended />
    );
    expect(callsForCommand('1')).toHaveLength(1);

    rerender(
      <ZmsEventPlayer portalUrl="https://zm.test" eventId="42" token="tok" totalFrames={100}
        alarmFrames={0} eventLength={10} suspended={false} />
    );
    expect(callsForCommand('2')).toHaveLength(1);
  });

  it('leaves an already paused stream paused after suspension', () => {
    const { rerender } = renderPlayer();
    fireEvent.click(screen.getByTitle('event_detail.pause'));
    expect(callsForCommand('1')).toHaveLength(1);

    rerender(
      <ZmsEventPlayer portalUrl="https://zm.test" eventId="42" token="tok" totalFrames={100}
        alarmFrames={0} eventLength={10} suspended />
    );
    rerender(
      <ZmsEventPlayer portalUrl="https://zm.test" eventId="42" token="tok" totalFrames={100}
        alarmFrames={0} eventLength={10} suspended={false} />
    );

    expect(callsForCommand('1')).toHaveLength(1);
    expect(callsForCommand('2')).toHaveLength(0);
  });

  // The frame carousel above the player owns the alarm-frame thumbnail now
  // (refs #272); only the quick-jump button remains here for seeking to it.
  it('shows no alarm-frame thumbnail, only the quick-jump button', () => {
    render(
      <ZmsEventPlayer portalUrl="https://zm.test" eventId="42" token="tok" totalFrames={100}
        alarmFrames={5} alarmFrameId="10" maxScoreFrameId="20" eventLength={10} />
    );

    expect(screen.queryByTestId('zms-jump-to-alarm-frame')).toBeNull();
    expect(screen.getByTestId('zms-quick-jump-alarm-frame')).toBeTruthy();
    expect(screen.getByTestId('zms-jump-to-max-score-frame')).toBeTruthy();
  });

  it('drops the max-score card when it is the same frame as the alarm', () => {
    render(
      <ZmsEventPlayer portalUrl="https://zm.test" eventId="42" token="tok" totalFrames={100}
        alarmFrames={5} alarmFrameId="10" maxScoreFrameId="10" eventLength={10} />
    );

    expect(screen.queryByTestId('zms-jump-to-max-score-frame')).toBeNull();
  });

  it('stops at the event end instead of requesting a ZMS replay loop', () => {
    renderPlayer();

    expect(new URL(getStreamImg().src).searchParams.get('replay')).toBe('none');
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

  it('scrubs with seek alone, without pausing or resuming the stream', () => {
    renderPlayer();
    fireEvent.load(getStreamImg());
    const track = stubTrack();

    // Grabbing/moving the scrub bar issues a seek (CMD_SEEK = 14)...
    fireEvent.mouseDown(track, { clientX: 100 });
    expect(callsForCommand('14').length).toBeGreaterThan(0);

    fireEvent.mouseUp(window);

    // ...but never pauses (CMD_PAUSE = 1) or resumes (CMD_PLAY = 2): the seek
    // drives playback by itself (refs #196).
    expect(callsForCommand('1')).toHaveLength(0);
    expect(callsForCommand('2')).toHaveLength(0);
  });

  it('repeats a settled seek after a delay to flush the paused frame (refs #196)', async () => {
    // A paused/idle zms only pushes its next MJPEG frame on the 5s keepalive, so
    // a lone seek shows ~5s late in the <img>. Repeating the seek makes a second
    // frame flush the first. streamDuration is null here (no poll yet), so the
    // stream is not confirmed advancing and the flush must fire.
    vi.useFakeTimers();
    renderPlayer();
    fireEvent.load(getStreamImg());

    fireEvent.click(screen.getByTestId('zms-go-to-end'));

    // The immediate seek goes out first.
    let seeks = callsForCommand('14');
    expect(seeks).toHaveLength(1);
    const offset = new URL(seeks[0][0] as string).searchParams.get('offset');

    // Before the delay elapses, no repeat yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EVENT_SEEK_FLUSH_DELAY_MS - 50);
    });
    expect(callsForCommand('14')).toHaveLength(1);

    // After the delay, a second seek to the same offset flushes the frame.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    seeks = callsForCommand('14');
    expect(seeks).toHaveLength(2);
    expect(new URL(seeks[1][0] as string).searchParams.get('offset')).toBe(offset);
  });

  it('does not repeat the seek while the stream is confirmed playing (refs #196)', async () => {
    // With a working status poll and isPlaying, frames already flow, so the next
    // played frame flushes the seek. Repeating it would yank playback backward.
    vi.useFakeTimers();
    httpGetMock.mockImplementation((url: string) => {
      if (commandOf(url) === '99') {
        return Promise.resolve({ data: { status: { progress: 1, duration: 20 } } });
      }
      return Promise.resolve({ data: {} });
    });
    renderPlayer();
    fireEvent.load(getStreamImg());

    // One poll teaches the player the stream is advancing (duration known).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600000);
    });
    httpGetMock.mockClear();

    fireEvent.click(screen.getByTestId('zms-go-to-end'));
    expect(callsForCommand('14')).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(EVENT_SEEK_FLUSH_DELAY_MS + 100);
    });
    // Still only the one seek: no flush repeat while playing.
    expect(callsForCommand('14')).toHaveLength(1);
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
