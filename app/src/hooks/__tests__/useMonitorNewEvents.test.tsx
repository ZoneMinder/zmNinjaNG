import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useMonitorNewEvents } from '../useMonitorNewEvents';
import { useMonitorSeenStore } from '../../stores/monitorSeen';
import { getMonitorEventsSince } from '../../api/events';

vi.mock('../../api/events', () => ({ getMonitorEventsSince: vi.fn() }));
vi.mock('../useCurrentProfile', () => ({
  useCurrentProfile: () => ({ currentProfile: { id: 'p1' }, settings: {} }),
}));
vi.mock('../../stores/auth', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: true }),
}));
vi.mock('../useBandwidthSettings', () => ({
  useBandwidthSettings: () => ({ monitorNewEventsInterval: 60000 }),
}));

const mockCount = vi.mocked(getMonitorEventsSince);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useMonitorNewEvents', () => {
  beforeEach(() => {
    useMonitorSeenStore.setState({ profileWatermarks: {} });
    mockCount.mockReset();
  });

  it('seeds an unseen monitor and reports zero new events', async () => {
    // getMonitorEventsSince's `since` filter is strict `>` (see api/events.ts):
    // once `since` reaches the newest known event, no events qualify. The seed
    // effect changes the query key from since=null to since=<newest> the render
    // after the first response lands, so the mock must honor `since` the way
    // the real endpoint does; a flat mockResolvedValue would report the whole
    // backlog again on that second, watermark-filtered call.
    mockCount.mockImplementation(async (_monitorId: string, since: string | null) =>
      since === null ? { count: 61, newest: '2026-07-09 14:26:47' } : { count: 0, newest: null }
    );

    const { result } = renderHook(() => useMonitorNewEvents(['1']), { wrapper });

    await waitFor(() => {
      expect(useMonitorSeenStore.getState().hasWatermark('p1', '1')).toBe(true);
    });
    // A fresh install must not report 61 events as new.
    expect(result.current.counts['1'] ?? 0).toBe(0);
    expect(useMonitorSeenStore.getState().getWatermark('p1', '1')).toBe('2026-07-09 14:26:47');
  });

  it('reports the count for a monitor that already has a watermark', async () => {
    useMonitorSeenStore.getState().seed('p1', '1', '2026-07-01 00:00:00');
    mockCount.mockResolvedValue({ count: 3, newest: '2026-07-09 14:26:47' });

    const { result } = renderHook(() => useMonitorNewEvents(['1']), { wrapper });

    await waitFor(() => expect(result.current.counts['1']).toBe(3));
    expect(result.current.newest['1']).toBe('2026-07-09 14:26:47');
    expect(mockCount).toHaveBeenCalledWith('1', '2026-07-01 00:00:00');
  });

  it('seeds a monitor that has never recorded an event with a null watermark', async () => {
    mockCount.mockResolvedValue({ count: 0, newest: null });

    renderHook(() => useMonitorNewEvents(['1']), { wrapper });

    await waitFor(() => {
      expect(useMonitorSeenStore.getState().hasWatermark('p1', '1')).toBe(true);
    });
    expect(useMonitorSeenStore.getState().getWatermark('p1', '1')).toBeNull();
  });

  it('queries each monitor independently', async () => {
    useMonitorSeenStore.getState().seed('p1', '1', '2026-07-01 00:00:00');
    useMonitorSeenStore.getState().seed('p1', '2', '2026-07-02 00:00:00');
    mockCount.mockImplementation(async (monitorId: string) =>
      monitorId === '1' ? { count: 3, newest: 'a' } : { count: 0, newest: 'b' }
    );

    const { result } = renderHook(() => useMonitorNewEvents(['1', '2']), { wrapper });

    await waitFor(() => expect(result.current.counts['1']).toBe(3));
    expect(result.current.counts['2']).toBe(0);
  });
});
