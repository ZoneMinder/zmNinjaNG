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
  useAuthSlice: () => ({ isAuthenticated: true }),
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

  it('seeds an unseen monitor and never emits its backlog as new', async () => {
    // A fresh install must never greet the user with "61 new". The response
    // that seeds a monitor is the same one that would otherwise report its
    // whole history. Observe every render, not just the settled one.
    mockCount.mockImplementation(async (_monitorId: string, since: string | null) =>
      since === null
        ? { count: 61, newest: '2026-07-09 14:26:47' }
        : { count: 0, newest: '2026-07-09 14:26:47' }
    );

    const observed: (number | undefined)[] = [];
    renderHook(
      () => {
        const result = useMonitorNewEvents(['1']);
        observed.push(result.counts['1']);
        return result;
      },
      { wrapper }
    );

    await waitFor(() => {
      expect(useMonitorSeenStore.getState().hasWatermark('p1', '1')).toBe(true);
    });

    expect(useMonitorSeenStore.getState().getWatermark('p1', '1')).toBe('2026-07-09 14:26:47');
    // The suppression in the hook is the only thing standing between the user
    // and a badge reading 61 on first launch.
    expect(observed).not.toContain(61);
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
