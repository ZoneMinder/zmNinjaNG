/**
 * useTimelineData Hook Tests
 *
 * Covers the API event transform, live-mode synthetic injection (including
 * dedup against API data), and the debounced refetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useTimelineData, type UseTimelineDataOptions } from '../useTimelineData';
import { getEvents } from '../../api/events';
import { getMonitors } from '../../api/monitors';
import { TIMELINE } from '../../lib/zmninja-ng-constants';

vi.mock('../../api/events', () => ({
  getEvents: vi.fn(),
}));

vi.mock('../../api/monitors', () => ({
  getMonitors: vi.fn(),
}));

vi.mock('../../lib/logger', () => ({
  log: {
    timeline: vi.fn(),
  },
  LogLevel: {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR',
  },
}));

vi.mock('../../stores/profile', () => {
  const state = { currentProfileId: 'profile-1', profiles: [] };
  return {
    useProfileStore: Object.assign(
      (selector: (s: typeof state) => unknown) => selector(state),
      { getState: () => state },
    ),
  };
});

vi.mock('../useBandwidthSettings', () => ({
  useBandwidthSettings: () => ({ timelineHeatmapInterval: 30000 }),
}));

// Manual notification store mock: callable as a hook with a selector, plus
// getState/subscribe used imperatively by the hook under test.
const notificationStore = vi.hoisted(() => {
  interface MockNotificationEvent {
    EventId: number;
    MonitorId: number;
    MonitorName?: string;
    Cause?: string;
    Notes?: string;
    receivedAt: number;
  }
  interface MockState {
    profileEvents: Record<string, MockNotificationEvent[]>;
    getProfileSettings: (profileId: string) => { enabled: boolean };
  }
  const listeners = new Set<(state: MockState) => void>();
  const state: MockState = {
    profileEvents: {},
    getProfileSettings: () => ({ enabled: true }),
  };
  return {
    state,
    listeners,
    emit() {
      for (const listener of listeners) listener(state);
    },
    reset() {
      state.profileEvents = {};
      state.getProfileSettings = () => ({ enabled: true });
      listeners.clear();
    },
  };
});

vi.mock('../../stores/notifications', () => ({
  useNotificationStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector(notificationStore.state),
    {
      getState: () => notificationStore.state,
      subscribe: (listener: (s: unknown) => void) => {
        notificationStore.listeners.add(listener);
        return () => notificationStore.listeners.delete(listener);
      },
    },
  ),
}));

const apiEvent = {
  Event: {
    Id: '42',
    MonitorId: '1',
    Name: 'Event-42',
    StartDateTime: '2026-06-10 10:00:00',
    EndDateTime: '2026-06-10 10:01:00',
    Length: '60.0',
    Cause: 'Motion',
    AlarmFrames: '10',
    Frames: '100',
    Notes: 'person detected',
  },
} as never;

const defaultOptions: UseTimelineDataOptions = {
  startDate: '2026-06-09T10:00',
  endDate: '2026-06-10T10:00',
  liveMode: false,
  selectedMonitorIds: [],
  onlyDetectedObjects: false,
  causeFilter: '',
};

function createWrapper(queryClient?: QueryClient) {
  const client = queryClient ?? new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

function emitLiveEvent(eventId: number, receivedAt: number) {
  notificationStore.state.profileEvents['profile-1'] = [
    { EventId: eventId, MonitorId: 5, MonitorName: 'Door', Cause: 'Motion', Notes: 'person', receivedAt },
    ...(notificationStore.state.profileEvents['profile-1'] ?? []),
  ];
  act(() => {
    notificationStore.emit();
  });
}

describe('useTimelineData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationStore.reset();
    vi.mocked(getMonitors).mockResolvedValue({ monitors: [] } as never);
    vi.mocked(getEvents).mockResolvedValue({ events: [] } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('transforms API events into timeline events', async () => {
    vi.mocked(getEvents).mockResolvedValue({ events: [apiEvent] } as never);

    const { result } = renderHook(() => useTimelineData(defaultOptions), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.allTimelineEvents).toHaveLength(1);
    const ev = result.current.allTimelineEvents[0];
    expect(ev.id).toBe('42');
    expect(ev.monitorId).toBe('1');
    expect(ev.endMs - ev.startMs).toBe(60_000);
    expect(ev.alarmRatio).toBeCloseTo(0.1);
    expect(result.current.eventIds).toEqual(['42']);
    expect(result.current.rawEventMap.get('42')).toBe(apiEvent);
  });

  it('injects a synthetic event on a live notification and dedups repeats', async () => {
    const { result } = renderHook(
      () => useTimelineData({ ...defaultOptions, liveMode: true }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    emitLiveEvent(123, 1000);

    await waitFor(() => {
      expect(result.current.allTimelineEvents).toHaveLength(1);
    });
    expect(result.current.allTimelineEvents[0].id).toBe('123');

    // Same event arriving again must not produce a duplicate
    emitLiveEvent(123, 2000);

    await waitFor(() => {
      expect(result.current.allTimelineEvents).toHaveLength(1);
    });
    expect(result.current.allTimelineEvents[0].id).toBe('123');
  });

  it('prefers API data over a synthetic event with the same id', async () => {
    vi.mocked(getEvents).mockResolvedValue({ events: [apiEvent] } as never);

    const { result } = renderHook(
      () => useTimelineData({ ...defaultOptions, liveMode: true }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Live notification for the event the API already returned (id 42)
    emitLiveEvent(42, 1000);

    await waitFor(() => {
      expect(result.current.allTimelineEvents).toHaveLength(1);
    });
    const ev = result.current.allTimelineEvents[0];
    expect(ev.id).toBe('42');
    // API shape wins: real duration, not the 1s synthetic placeholder
    expect(ev.endMs - ev.startMs).toBe(60_000);
  });

  it('does not react to notifications when live mode is off', async () => {
    const { result } = renderHook(() => useTimelineData(defaultOptions), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    emitLiveEvent(99, 1000);

    expect(result.current.allTimelineEvents).toHaveLength(0);
  });

  it('debounces the refetch when several live events arrive in quick succession', async () => {
    vi.useFakeTimers();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    renderHook(
      () => useTimelineData({ ...defaultOptions, liveMode: true }),
      { wrapper: createWrapper(client) },
    );

    emitLiveEvent(201, 1000);
    act(() => {
      vi.advanceTimersByTime(TIMELINE.liveRefetchDebounceMs / 2);
    });
    emitLiveEvent(202, 2000);

    // First timer was cancelled by the second arrival
    act(() => {
      vi.advanceTimersByTime(TIMELINE.liveRefetchDebounceMs - 1);
    });
    expect(invalidateSpy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['timeline-events', 'profile-1'] });
  });
});
