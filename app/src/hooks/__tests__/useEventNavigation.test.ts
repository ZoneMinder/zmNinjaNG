/**
 * useEventNavigation tests.
 *
 * Regression coverage for #337 (All mode deep routes): prev/next must fetch
 * the adjacent event via the given owning profile's session and navigate to
 * `/all/events/:profileId/:id`, staying in owning-profile context instead of
 * falling back to the single-mode `/events/:id` route.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const navigateMock = vi.fn();
let mockLocationState: Record<string, unknown> = {};

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ state: mockLocationState }),
}));

const getAdjacentEventMock = vi.fn();
vi.mock('../../api/events', () => ({
  getAdjacentEvent: (...args: unknown[]) => getAdjacentEventMock(...args),
}));
vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

import { useEventNavigation } from '../useEventNavigation';
import { seedProfiles, resetProfileFixture, fakeApiClient, asProfileId } from '../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../tests/fake-store-gates';

const profileA = asProfileId('profile-a');
const profileB = asProfileId('profile-b');
const clientA = fakeApiClient();
const clientB = fakeApiClient();

describe('useEventNavigation All mode (refs #337)', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    getAdjacentEventMock.mockReset();
    seedProfiles([profileA, profileB], { current: profileA });
    installApiClient(profileA, clientA);
    installApiClient(profileB, clientB);
    mockLocationState = { from: '/all/events/profile-b/5' };
    getAdjacentEventMock.mockResolvedValue({ Event: { Id: '6' } });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('fetches the adjacent event via the given profile\'s session', async () => {
    const { result } = renderHook(() =>
      useEventNavigation({ currentEventId: '5', currentStartDateTime: '2026-01-01 00:00:00', profileId: profileB })
    );

    await act(async () => {
      await result.current.goToNextEvent();
    });

    // clientB (profileB's OWN installed client), not clientA (the current
    // profile's), proves the session came from the given profile.
    expect(getAdjacentEventMock).toHaveBeenCalledWith(clientB, profileB, 'next', '2026-01-01 00:00:00', undefined);
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

    // clientA (the CURRENT profile's client), proving getCurrentSession's
    // resolution was used rather than a specific profileId's.
    expect(getAdjacentEventMock).toHaveBeenCalledWith(clientA, profileA, 'next', '2026-01-01 00:00:00', undefined);
    expect(navigateMock).toHaveBeenCalledWith('/events/6', expect.objectContaining({ replace: true }));
  });
});
