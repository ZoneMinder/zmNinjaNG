import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOpenMonitorEvents } from '../useOpenMonitorEvents';
import { useMonitorSeenStore } from '../../stores/monitorSeen';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    currentProfile: { id: 'p1', portalUrl: 'https://test', cgiUrl: 'https://test/cgi', apiUrl: 'https://test/api' },
    settings: {},
  }),
}));

describe('useOpenMonitorEvents', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    useMonitorSeenStore.setState({ profileWatermarks: {} });
  });

  it('navigates with the watermark-derived startDateTime when there are new events, and advances the watermark', () => {
    useMonitorSeenStore.getState().seed('p1', '1', '2026-07-10 08:49:37');
    const { result } = renderHook(() => useOpenMonitorEvents());

    act(() => {
      result.current({
        monitorId: '1',
        newEventCount: 3,
        newestEventAt: '2026-07-10 09:15:00',
        from: '/monitors',
      });
    });

    expect(mockNavigate).toHaveBeenCalledWith(
      '/events?monitorId=1&startDateTime=2026-07-10T08%3A49%3A38',
      { state: { from: '/monitors' } }
    );
    expect(useMonitorSeenStore.getState().getWatermark('p1', '1')).toBe('2026-07-10 09:15:00');
  });

  it('navigates without a date filter when there are no new events', () => {
    useMonitorSeenStore.getState().seed('p1', '1', '2026-07-10 08:49:37');
    const { result } = renderHook(() => useOpenMonitorEvents());

    act(() => {
      result.current({
        monitorId: '1',
        newEventCount: 0,
        newestEventAt: '2026-07-10 09:15:00',
        from: '/monitors',
      });
    });

    expect(mockNavigate).toHaveBeenCalledWith('/events?monitorId=1', { state: { from: '/monitors' } });
  });

  it('navigates without a date filter when newEventCount is undefined', () => {
    useMonitorSeenStore.getState().seed('p1', '1', '2026-07-10 08:49:37');
    const { result } = renderHook(() => useOpenMonitorEvents());

    act(() => {
      result.current({
        monitorId: '1',
        newEventCount: undefined,
        newestEventAt: '2026-07-10 09:15:00',
        from: '/monitors',
      });
    });

    expect(mockNavigate).toHaveBeenCalledWith('/events?monitorId=1', { state: { from: '/monitors' } });
  });

  it('navigates without a date filter when the watermark is null (whole history is the new set)', () => {
    useMonitorSeenStore.getState().seed('p1', '1', null);
    const { result } = renderHook(() => useOpenMonitorEvents());

    act(() => {
      result.current({
        monitorId: '1',
        newEventCount: 5,
        newestEventAt: '2026-07-10 09:15:00',
        from: '/monitors',
      });
    });

    expect(mockNavigate).toHaveBeenCalledWith('/events?monitorId=1', { state: { from: '/monitors' } });
  });

  it('passes the caller-supplied from route through to navigation state', () => {
    useMonitorSeenStore.getState().seed('p1', '1', '2026-07-10 08:49:37');
    const { result } = renderHook(() => useOpenMonitorEvents());

    act(() => {
      result.current({
        monitorId: '1',
        newEventCount: 0,
        newestEventAt: '2026-07-10 09:15:00',
        from: '/montage',
      });
    });

    expect(mockNavigate).toHaveBeenCalledWith('/events?monitorId=1', { state: { from: '/montage' } });
  });

  it('reads the OLD watermark for the URL, not the value markSeen just wrote', () => {
    // Seed an old watermark, then pass a different newestEventAt. The URL must
    // be built from the pre-click watermark even though markSeen runs first in
    // the sequence of side effects.
    useMonitorSeenStore.getState().seed('p1', '1', '2026-07-01 00:00:00');
    const { result } = renderHook(() => useOpenMonitorEvents());

    act(() => {
      result.current({
        monitorId: '1',
        newEventCount: 1,
        newestEventAt: '2026-07-10 09:15:00',
        from: '/monitors',
      });
    });

    const [url] = mockNavigate.mock.calls[0];
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('startDateTime')).toBe('2026-07-01T00:00:01');
    expect(useMonitorSeenStore.getState().getWatermark('p1', '1')).toBe('2026-07-10 09:15:00');
  });
});
