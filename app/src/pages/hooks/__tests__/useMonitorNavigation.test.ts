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

const navigateMock = vi.fn();
let mockLocation: { pathname: string; state: unknown };

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => mockLocation,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: {
      monitors: [
        { Monitor: { Id: '1' } },
        { Monitor: { Id: '2' } },
        { Monitor: { Id: '3' } },
      ],
    },
  }),
}));

vi.mock('../../../api/monitors', () => ({ getMonitors: vi.fn() }));
vi.mock('../../../lib/filters', () => ({
  filterEnabledMonitors: (monitors: unknown) => monitors,
}));
vi.mock('../../../hooks/useSwipeNavigation', () => ({
  useSwipeNavigation: () => ({}),
}));

import { useMonitorNavigation } from '../useMonitorNavigation';

describe('useMonitorNavigation prev/next history handling', () => {
  beforeEach(() => {
    navigateMock.mockClear();
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
