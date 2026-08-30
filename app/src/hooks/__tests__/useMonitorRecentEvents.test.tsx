import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('../../api/events', () => ({ getEvents: vi.fn() }));
vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

import { useMonitorRecentEvents } from '../useMonitorRecentEvents';
import { getEvents } from '../../api/events';
import { useSettingsStore } from '../../stores/settings';
import { seedProfiles, resetProfileFixture, fakeApiClient, asProfileId } from '../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../tests/fake-store-gates';

const mockGetEvents = vi.mocked(getEvents);

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

beforeEach(() => {
  mockGetEvents.mockReset();
  seedProfiles(['p1'], { settings: { p1: { monitorDetailRecentEventsCount: 5 } } });
});

afterEach(() => {
  resetProfileFixture();
  resetFakeStoreGates();
});

describe('useMonitorRecentEvents', () => {
  it('fetches recent events for the monitor, capped to count', async () => {
    mockGetEvents.mockResolvedValue({
      events: [{ Event: { Id: '1' } }, { Event: { Id: '2' } }],
    } as never);
    const { result } = renderHook(() => useMonitorRecentEvents('4'), { wrapper });
    await waitFor(() => expect(result.current.events.length).toBe(2));
    expect(mockGetEvents).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      monitorId: '4', limit: 5, sort: 'StartDateTime', direction: 'desc',
    });
  });

  it('does not fetch when the monitor is hidden', async () => {
    seedProfiles(['p1'], {
      settings: { p1: { monitorDetailRecentEventsCount: 5, monitorDetailRecentEventsHidden: ['4'] } },
    });
    const { result } = renderHook(() => useMonitorRecentEvents('4'), { wrapper });
    expect(result.current.hidden).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockGetEvents).not.toHaveBeenCalled();
  });

  it('toggleHidden writes the updated hidden set', () => {
    const { result } = renderHook(() => useMonitorRecentEvents('4'), { wrapper });
    act(() => result.current.toggleHidden());
    expect(useSettingsStore.getState().getProfileSettings('p1').monitorDetailRecentEventsHidden).toEqual(['4']);
  });

  it('fetches via the given profile\'s session and keys when profileId is provided (refs #337)', async () => {
    const profileB = asProfileId('profile-b');
    seedProfiles(['p1', profileB], { current: 'p1' });
    const clientB = fakeApiClient();
    installApiClient(profileB, clientB);
    mockGetEvents.mockResolvedValue({ events: [] } as never);

    renderHook(() => useMonitorRecentEvents('4', profileB), { wrapper });

    await waitFor(() => expect(mockGetEvents).toHaveBeenCalled());
    expect(mockGetEvents).toHaveBeenCalledWith(clientB, profileB, expect.objectContaining({ monitorId: '4' }));
  });
});
