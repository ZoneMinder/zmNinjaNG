import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks (vi.hoisted so they're available in vi.mock factories) ---

const {
  mockGetEvents,
  mockGetEventImageUrl,
  mockGetMonitors,
} = vi.hoisted(() => ({
  mockGetEvents: vi.fn(),
  mockGetEventImageUrl: vi.fn(() => 'http://example.com/snap.jpg'),
  mockGetMonitors: vi.fn(),
}));

vi.mock('../../api/events', () => ({
  getEvents: mockGetEvents,
  getEventImageUrl: mockGetEventImageUrl,
}));

vi.mock('../../api/monitors', () => ({
  getMonitors: mockGetMonitors,
}));

vi.mock('../sessions', () => ({
  getSession: vi.fn(() => ({ client: {} })),
}));

vi.mock('../../lib/logger', () => ({
  log: {
    notifications: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
  },
}));

import { getEventPoller } from '../eventPoller';

// --- Helpers ---

function makeEvent(id: number, monitorId = '1', cause = 'Motion') {
  return {
    Event: {
      Id: String(id),
      MonitorId: String(monitorId),
      Cause: cause,
    },
  };
}

/** Plain mock deps: the poller must work without any zustand store. */
function makeDeps() {
  return {
    onEvent: vi.fn(),
    getOnlyDetectedEvents: vi.fn((): boolean => false),
    getFreshAccessToken: vi.fn(async (): Promise<string | null> => 'test-token'),
    getPollIntervalMs: vi.fn((): number => 30_000),
    getPortalUrl: vi.fn((): string | undefined => 'http://zm.local'),
    getMinStreamingPort: vi.fn((): number | undefined => undefined),
  };
}

// --- Tests ---

describe('EventPollerService', () => {
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    deps = makeDeps();
    mockGetMonitors.mockResolvedValue({
      monitors: [
        { Monitor: { Id: '1', Name: 'Front Door' } },
        { Monitor: { Id: '2', Name: 'Backyard' } },
      ],
    });
    mockGetEvents.mockResolvedValue({ events: [] });
  });

  afterEach(() => {
    const poller = getEventPoller();
    poller.stop();
    vi.useRealTimers();
  });

  it('getEventPoller() returns a singleton', () => {
    const a = getEventPoller();
    const b = getEventPoller();
    expect(a).toBe(b);
  });

  it('start() loads monitor names and begins polling', async () => {
    const poller = getEventPoller();
    await poller.start('profile-1', deps);
    // _pollAndSchedule sets the timer inside .finally(), flush microtasks
    await vi.advanceTimersByTimeAsync(0);

    expect(mockGetMonitors).toHaveBeenCalledTimes(1);
    expect(mockGetEvents).toHaveBeenCalledTimes(1);
    expect(poller.isRunning()).toBe(true);
  });

  it('first poll seeds seen events without emitting them', async () => {
    mockGetEvents.mockResolvedValue({
      events: [makeEvent(100), makeEvent(101)],
    });

    const poller = getEventPoller();
    await poller.start('profile-1', deps);

    expect(deps.onEvent).not.toHaveBeenCalled();
  });

  it('subsequent polls detect new events and emit them via onEvent', async () => {
    // First poll seeds events 100, 101
    mockGetEvents.mockResolvedValueOnce({
      events: [makeEvent(100), makeEvent(101)],
    });

    const poller = getEventPoller();
    await poller.start('profile-1', deps);
    expect(deps.onEvent).not.toHaveBeenCalled();

    // Second poll returns events 100, 101, 102 (102 is new)
    mockGetEvents.mockResolvedValueOnce({
      events: [makeEvent(102, '1', 'Person'), makeEvent(101), makeEvent(100)],
    });

    // Advance past the polling interval and let the async poll settle
    await vi.advanceTimersByTimeAsync(30_000);

    expect(deps.onEvent).toHaveBeenCalledTimes(1);
    expect(deps.onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        EventId: 102,
        MonitorName: 'Front Door',
        Cause: 'Person',
        ImageUrl: 'http://example.com/snap.jpg',
      }),
    );
  });

  it('builds image URLs with the injected token', async () => {
    mockGetEvents.mockResolvedValueOnce({ events: [] });

    const poller = getEventPoller();
    await poller.start('profile-1', deps);

    mockGetEvents.mockResolvedValueOnce({ events: [makeEvent(300)] });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(deps.getFreshAccessToken).toHaveBeenCalled();
    expect(mockGetEventImageUrl).toHaveBeenCalledWith(
      'http://zm.local',
      '300',
      'snapshot',
      expect.objectContaining({ token: 'test-token' }),
    );
  });

  it('omits the image URL when no token is available', async () => {
    deps.getFreshAccessToken.mockResolvedValue(null);
    mockGetEvents.mockResolvedValueOnce({ events: [] });

    const poller = getEventPoller();
    await poller.start('profile-1', deps);

    mockGetEvents.mockResolvedValueOnce({ events: [makeEvent(301)] });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockGetEventImageUrl).not.toHaveBeenCalled();
    expect(deps.onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ EventId: 301, ImageUrl: undefined }),
    );
  });

  it('skips duplicate events (same ID already seen)', async () => {
    mockGetEvents.mockResolvedValueOnce({
      events: [makeEvent(200)],
    });

    const poller = getEventPoller();
    await poller.start('profile-1', deps);

    // Second poll returns the same event
    mockGetEvents.mockResolvedValueOnce({
      events: [makeEvent(200)],
    });

    await vi.advanceTimersByTimeAsync(30_000);

    expect(deps.onEvent).not.toHaveBeenCalled();
  });

  it('uses the injected poll interval', async () => {
    deps.getPollIntervalMs.mockReturnValue(10_000);

    const poller = getEventPoller();
    await poller.start('profile-1', deps);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockGetEvents).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockGetEvents).toHaveBeenCalledTimes(2);
  });

  it('stop() clears the timer and resets state', async () => {
    const poller = getEventPoller();
    await poller.start('profile-1', deps);
    await vi.advanceTimersByTimeAsync(0);
    expect(poller.isRunning()).toBe(true);

    poller.stop();
    expect(poller.isRunning()).toBe(false);
  });

  it('isRunning() reflects the running state', () => {
    const poller = getEventPoller();
    expect(poller.isRunning()).toBe(false);
  });

  it('applies notesRegexp filter when onlyDetectedEvents is enabled', async () => {
    deps.getOnlyDetectedEvents.mockReturnValue(true);

    const poller = getEventPoller();
    await poller.start('profile-1', deps);

    expect(mockGetEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        notesRegexp: 'detected:',
      }),
    );
  });

  it('caps the seen set at 500 entries', async () => {
    // Seed first poll with 5 events
    const seedEvents = Array.from({ length: 5 }, (_, i) => makeEvent(i));
    mockGetEvents.mockResolvedValueOnce({ events: seedEvents });

    const poller = getEventPoller();
    await poller.start('profile-1', deps);

    // Build up past 500 seen IDs across multiple polls
    for (let batch = 0; batch < 100; batch++) {
      const batchEvents = Array.from({ length: 6 }, (_, i) =>
        makeEvent(1000 + batch * 6 + i),
      );
      mockGetEvents.mockResolvedValueOnce({ events: batchEvents });
      await vi.advanceTimersByTimeAsync(30_000);
    }

    // After pruning, only the last poll's IDs remain in the set.
    // Event 0 was in the seed but should now be treated as new.
    mockGetEvents.mockResolvedValueOnce({ events: [makeEvent(0)] });
    deps.onEvent.mockClear();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(deps.onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ EventId: 0 }),
    );
  });

  // The startup load runs while the profile is still bootstrapping and can
  // lose a race with authentication, which used to leave the name map empty
  // for the whole session and strand every notification on "Monitor 1".
  it('recovers the monitor name when the startup load failed', async () => {
    mockGetMonitors.mockRejectedValueOnce(new Error('401 during profile switch'));

    const poller = getEventPoller();
    await poller.start('profile-1', deps);
    await vi.advanceTimersByTimeAsync(0);

    // Names are gone, so a name lookup would miss.
    mockGetEvents.mockResolvedValueOnce({ events: [makeEvent(200)] });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(deps.onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ EventId: 200, MonitorName: 'Front Door' }),
    );
  });

  it('does not refetch names on every poll for a monitor that stays unknown', async () => {
    // Poll faster than the reload window so several polls fall inside it.
    deps.getPollIntervalMs.mockReturnValue(10_000);

    const poller = getEventPoller();
    await poller.start('profile-1', deps);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockGetMonitors).toHaveBeenCalledTimes(1);

    // Monitor 99 is absent from the list and always will be, so the retry has
    // to be rate limited rather than firing once per poll.
    for (let i = 0; i < 4; i += 1) {
      mockGetEvents.mockResolvedValueOnce({ events: [makeEvent(300 + i, '99')] });
      await vi.advanceTimersByTimeAsync(10_000);
    }

    // One startup load plus exactly one retry across four polls.
    expect(mockGetMonitors).toHaveBeenCalledTimes(2);
    expect(deps.onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ MonitorName: 'Monitor 99' }),
    );
  });
});
