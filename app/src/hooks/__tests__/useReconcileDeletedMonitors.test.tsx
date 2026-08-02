import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useReconcileDeletedMonitors } from '../useReconcileDeletedMonitors';
import { useSettingsStore, DEFAULT_MONTAGE_GROUP_LAYOUT } from '../../stores/settings';
import { useDashboardStore } from '../../stores/dashboard';
import { getMonitors } from '../../api/monitors';

vi.mock('../../api/monitors', () => ({ getMonitors: vi.fn() }));
vi.mock('../../services/sessions', () => ({ getCurrentSession: vi.fn(() => ({ client: {} })) }));
vi.mock('../useCurrentProfile', () => ({
  useCurrentProfile: () => ({ currentProfile: { id: 'p1' }, settings: {} }),
}));
vi.mock('../../stores/auth', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: true }),
  useAuthSlice: () => ({ isAuthenticated: true }),
}));

const mockGetMonitors = vi.mocked(getMonitors);

function monitorList(ids: string[]) {
  return { monitors: ids.map((Id) => ({ Monitor: { Id }, Monitor_Status: undefined })) } as never;
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function seedProfile() {
  useSettingsStore.setState({
    profileSettings: {
      p1: {
        excludedMonitorIds: ['1', '99'],
        montageByGroup: {
          all: { ...DEFAULT_MONTAGE_GROUP_LAYOUT, hiddenMonitorIds: ['99'] },
        },
      },
    } as never,
  });
  useDashboardStore.setState({
    widgets: {
      p1: [
        {
          id: 'w1',
          type: 'monitor',
          settings: { monitorIds: ['1', '99'] },
          layout: { i: 'w1', x: 0, y: 0, w: 4, h: 4 },
        },
      ],
    },
  });
}

function storedState() {
  return {
    excluded: useSettingsStore.getState().getProfileSettings('p1').excludedMonitorIds,
    montageHidden:
      useSettingsStore.getState().getProfileSettings('p1').montageByGroup?.all?.hiddenMonitorIds,
    widgetIds: useDashboardStore.getState().widgets.p1?.[0].settings.monitorIds,
  };
}

describe('useReconcileDeletedMonitors', () => {
  beforeEach(() => {
    mockGetMonitors.mockReset();
    seedProfile();
  });

  it('drops ids for monitors ZoneMinder no longer has, everywhere they are stored', async () => {
    mockGetMonitors.mockResolvedValue(monitorList(['1']));

    renderHook(() => useReconcileDeletedMonitors(), { wrapper });

    await waitFor(() => expect(storedState().excluded).toEqual(['1']));
    expect(storedState().montageHidden).toEqual([]);
    expect(storedState().widgetIds).toEqual(['1']);
  });

  it('keeps a hidden monitor that still exists, which the ordinary monitor list omits', async () => {
    // '99' is hidden, so getMonitors() without includeExcluded would not return
    // it. Reconciling against that list would delete the user's own hidden
    // entry, so the hook must ask for the list that includes it.
    mockGetMonitors.mockResolvedValue(monitorList(['1', '99']));

    renderHook(() => useReconcileDeletedMonitors(), { wrapper });

    await waitFor(() => expect(mockGetMonitors).toHaveBeenCalled());
    expect(mockGetMonitors).toHaveBeenCalledWith(expect.anything(), { includeExcluded: true });
    expect(storedState().excluded).toEqual(['1', '99']);
    expect(storedState().widgetIds).toEqual(['1', '99']);
  });

  it('changes nothing when the fetch fails: an error is not proof of deletion', async () => {
    mockGetMonitors.mockRejectedValue(new Error('offline'));

    renderHook(() => useReconcileDeletedMonitors(), { wrapper });

    await waitFor(() => expect(mockGetMonitors).toHaveBeenCalled());
    expect(storedState().excluded).toEqual(['1', '99']);
    expect(storedState().widgetIds).toEqual(['1', '99']);
  });

  it('changes nothing when the server returns no monitors at all', async () => {
    mockGetMonitors.mockResolvedValue(monitorList([]));

    renderHook(() => useReconcileDeletedMonitors(), { wrapper });

    await waitFor(() => expect(mockGetMonitors).toHaveBeenCalled());
    expect(storedState().excluded).toEqual(['1', '99']);
    expect(storedState().montageHidden).toEqual(['99']);
    expect(storedState().widgetIds).toEqual(['1', '99']);
  });
});
