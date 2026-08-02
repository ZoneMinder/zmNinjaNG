import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useMonitorRecentEvents } from '../useMonitorRecentEvents';
import { getEvents } from '../../api/events';

vi.mock('../../api/events', () => ({ getEvents: vi.fn() }));

const updateProfileSettings = vi.fn();
let hiddenList: string[] = [];
vi.mock('../useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    currentProfile: { id: 'p1' },
    settings: {
      monitorDetailRecentEventsCount: 5,
      get monitorDetailRecentEventsHidden() { return hiddenList; },
      bandwidthMode: 'normal',
    },
  }),
}));
vi.mock('../../stores/auth', () => ({
  useAuthStore: (sel: (s: { isAuthenticated: boolean }) => unknown) => sel({ isAuthenticated: true }),
  useAuthSlice: () => ({ isAuthenticated: true }),
}));
vi.mock('../../stores/settings', () => ({
  useSettingsStore: (sel: (s: { updateProfileSettings: typeof updateProfileSettings }) => unknown) =>
    sel({ updateProfileSettings }),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

beforeEach(() => {
  hiddenList = [];
  updateProfileSettings.mockClear();
  (getEvents as unknown as ReturnType<typeof vi.fn>).mockReset();
});

describe('useMonitorRecentEvents', () => {
  it('fetches recent events for the monitor, capped to count', async () => {
    (getEvents as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      events: [{ Event: { Id: '1' } }, { Event: { Id: '2' } }],
    });
    const { result } = renderHook(() => useMonitorRecentEvents('4'), { wrapper });
    await waitFor(() => expect(result.current.events.length).toBe(2));
    expect(getEvents).toHaveBeenCalledWith({
      monitorId: '4', limit: 5, sort: 'StartDateTime', direction: 'desc',
    });
  });

  it('does not fetch when the monitor is hidden', async () => {
    hiddenList = ['4'];
    const { result } = renderHook(() => useMonitorRecentEvents('4'), { wrapper });
    expect(result.current.hidden).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(getEvents).not.toHaveBeenCalled();
  });

  it('toggleHidden writes the updated hidden set', () => {
    const { result } = renderHook(() => useMonitorRecentEvents('4'), { wrapper });
    act(() => result.current.toggleHidden());
    expect(updateProfileSettings).toHaveBeenCalledWith('p1', {
      monitorDetailRecentEventsHidden: ['4'],
    });
  });
});
