/**
 * useEventNavigation tests.
 *
 * Regression coverage for #337 (All mode deep routes): prev/next must fetch
 * the adjacent event via the given owning profile's session and navigate to
 * `/all/events/:profileId/:id`, staying in owning-profile context instead of
 * falling back to the single-mode `/events/:id` route.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { asProfileId } from '../../api/types';

const navigateMock = vi.fn();
let mockLocationState: Record<string, unknown> = {};

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ state: mockLocationState }),
}));

const getSessionMock = vi.fn();
const getCurrentSessionMock = vi.fn();
vi.mock('../../services/sessions', () => ({
  getSession: (id: string) => getSessionMock(id),
  getCurrentSession: () => getCurrentSessionMock(),
}));

vi.mock('../../lib/logger', () => ({
  log: { eventDetail: vi.fn() },
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 },
}));

const getAdjacentEventMock = vi.fn();
vi.mock('../../api/events', () => ({
  getAdjacentEvent: (...args: unknown[]) => getAdjacentEventMock(...args),
}));

import { useEventNavigation } from '../useEventNavigation';

const profileB = asProfileId('profile-b');

describe('useEventNavigation All mode (refs #337)', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    getAdjacentEventMock.mockReset();
    getSessionMock.mockReset();
    getCurrentSessionMock.mockReset();
    getSessionMock.mockReturnValue({ client: 'client-b', profileId: profileB });
    getCurrentSessionMock.mockReturnValue({ client: 'client-current', profileId: 'profile-a' });
    mockLocationState = { from: '/all/events/profile-b/5' };
    getAdjacentEventMock.mockResolvedValue({ Event: { Id: '6' } });
  });

  it('fetches the adjacent event via the given profile\'s session', async () => {
    const { result } = renderHook(() =>
      useEventNavigation({ currentEventId: '5', currentStartDateTime: '2026-01-01 00:00:00', profileId: profileB })
    );

    await act(async () => {
      await result.current.goToNextEvent();
    });

    expect(getSessionMock).toHaveBeenCalledWith(profileB);
    expect(getCurrentSessionMock).not.toHaveBeenCalled();
    expect(getAdjacentEventMock).toHaveBeenCalledWith('client-b', profileB, 'next', '2026-01-01 00:00:00', undefined);
  });

  it('navigates within /all/events/:profileId/... staying in owning-profile context', async () => {
    const { result } = renderHook(() =>
      useEventNavigation({ currentEventId: '5', currentStartDateTime: '2026-01-01 00:00:00', profileId: profileB })
    );

    await act(async () => {
      await result.current.goToNextEvent();
    });

    expect(navigateMock).toHaveBeenCalledWith(
      '/all/events/profile-b/6',
      expect.objectContaining({ replace: true })
    );
  });

  it('falls back to /events/:id and the current session when profileId is omitted (single mode)', async () => {
    const { result } = renderHook(() =>
      useEventNavigation({ currentEventId: '5', currentStartDateTime: '2026-01-01 00:00:00' })
    );

    await act(async () => {
      await result.current.goToNextEvent();
    });

    expect(getCurrentSessionMock).toHaveBeenCalled();
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/events/6', expect.objectContaining({ replace: true }));
  });
});
