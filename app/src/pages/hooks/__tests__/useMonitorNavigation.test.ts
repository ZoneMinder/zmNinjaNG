/**
 * useMonitorNavigation tests.
 *
 * Regression coverage for #180: stepping through monitors with prev/next must
 * not interfere with the back button. Prev/next/cycle navigation replaces the
 * history entry (so no per-monitor back-stack builds up) and preserves the
 * original `from` referrer (so the back button returns to the origin view, e.g.
 * montage, not the previously viewed monitor).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { asProfileId } from '../../../api/types';

const navigateMock = vi.fn();
let mockLocation: { pathname: string; state: unknown };
let mockQueryKey: readonly unknown[] = [];

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => mockLocation,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: readonly unknown[] }) => {
    mockQueryKey = options.queryKey;
    return {
      data: {
        monitors: [
          { Monitor: { Id: '1' } },
          { Monitor: { Id: '2' } },
          { Monitor: { Id: '3' } },
        ],
      },
    };
  },
}));

vi.mock('../../../api/monitors', () => ({ getMonitors: vi.fn() }));
vi.mock('../../../lib/monitor/filters', () => ({
  filterEnabledMonitors: (monitors: unknown) => monitors,
}));
vi.mock('../../../hooks/useSwipeNavigation', () => ({
  useSwipeNavigation: () => ({}),
}));
vi.mock('../../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({ currentProfile: { id: 'profile-a' } }),
}));

const getSessionMock = vi.fn();
const getCurrentSessionMock = vi.fn();
vi.mock('../../../services/sessions', () => ({
  getSession: (id: string) => getSessionMock(id),
  getCurrentSession: () => getCurrentSessionMock(),
}));

import { useMonitorNavigation } from '../useMonitorNavigation';

const profileB = asProfileId('profile-b');

describe('useMonitorNavigation prev/next history handling', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    getSessionMock.mockReset();
    getCurrentSessionMock.mockReset();
    getSessionMock.mockReturnValue({ client: 'client-b', profileId: profileB });
    getCurrentSessionMock.mockReturnValue({ client: 'client-current', profileId: 'profile-a' });
    mockLocation = { pathname: '/monitors/2', state: { from: '/montage' } };
  });

  it('next replaces history and preserves the original referrer', () => {
    const { result } = renderHook(() => useMonitorNavigation({ currentMonitorId: '2' }));

    act(() => result.current.onSwipeLeft());

    expect(navigateMock).toHaveBeenCalledWith('/monitors/3', {
      replace: true,
      state: { from: '/montage' },
    });
  });

  it('prev replaces history and preserves the original referrer', () => {
    const { result } = renderHook(() => useMonitorNavigation({ currentMonitorId: '2' }));

    act(() => result.current.onSwipeRight());

    expect(navigateMock).toHaveBeenCalledWith('/monitors/1', {
      replace: true,
      state: { from: '/montage' },
    });
  });

  it('does not overwrite the referrer with the current monitor path', () => {
    const { result } = renderHook(() => useMonitorNavigation({ currentMonitorId: '2' }));

    act(() => result.current.onSwipeLeft());

    const [, options] = navigateMock.mock.calls[0];
    expect((options.state as { from?: string }).from).not.toBe('/monitors/2');
  });
});

describe('useMonitorNavigation All mode (refs #337)', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    getSessionMock.mockReset();
    getCurrentSessionMock.mockReset();
    getSessionMock.mockReturnValue({ client: 'client-b', profileId: profileB });
    getCurrentSessionMock.mockReturnValue({ client: 'client-current', profileId: 'profile-a' });
    mockLocation = { pathname: '/all/monitors/profile-b/2', state: { from: '/monitors' } };
  });

  it('fetches monitors via the given profile\'s session and queryKey', () => {
    renderHook(() => useMonitorNavigation({ currentMonitorId: '2', profileId: profileB }));

    expect(mockQueryKey).toEqual(['monitors', profileB]);
  });

  it('navigates within /all/monitors/:profileId/... on next, staying in owning-profile context', () => {
    const { result } = renderHook(() => useMonitorNavigation({ currentMonitorId: '2', profileId: profileB }));

    act(() => result.current.onSwipeLeft());

    expect(navigateMock).toHaveBeenCalledWith('/all/monitors/profile-b/3', {
      replace: true,
      state: { from: '/monitors' },
    });
  });

  it('navigates within /all/monitors/:profileId/... on prev, staying in owning-profile context', () => {
    const { result } = renderHook(() => useMonitorNavigation({ currentMonitorId: '2', profileId: profileB }));

    act(() => result.current.onSwipeRight());

    expect(navigateMock).toHaveBeenCalledWith('/all/monitors/profile-b/1', {
      replace: true,
      state: { from: '/monitors' },
    });
  });
});
