/**
 * Regression test for the notification history render loop (refs #337):
 * a selector that allocates a fresh array on every call breaks useShallow's
 * element-wise compare and useSyncExternalStore loops ("Maximum update depth
 * exceeded"). Must render against the REAL store - a test double that calls
 * `selector(state)` directly bypasses useSyncExternalStore and cannot catch
 * this class of bug.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NotificationHistory from '../NotificationHistory';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import { useProfileScope } from '../../hooks/useProfileScope';
import { useNotificationStore } from '../../stores/notifications';
import { asProfileId } from '../../api/types';
import type { Profile } from '../../api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { count?: number }) => `${key}${opts?.count !== undefined ? `:${opts.count}` : ''}` }),
}));
vi.mock('../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: vi.fn(),
}));
vi.mock('../../hooks/useProfileScope', () => ({
  useProfileScope: vi.fn(),
}));
vi.mock('../../components/NotificationBadge', () => ({
  NotificationBadge: () => null,
}));
// Row rendering pulls in useProfileById/useFreshAccessToken, unrelated to
// the store-subscription bug under test; stub it like the sibling test file.
vi.mock('../../components/notifications/NotificationHistoryItem', () => ({
  NotificationHistoryItem: ({ event }: { event: { EventId: number } }) => (
    <div data-testid="notification-history-item">{event.EventId}</div>
  ),
}));

const profileA = { id: asProfileId('profile-a'), name: 'Home' } as Profile;

function renderPage() {
  return render(<MemoryRouter><NotificationHistory /></MemoryRouter>);
}

describe('NotificationHistory page - real store render loop regression (refs #337)', () => {
  beforeEach(() => {
    vi.mocked(useCurrentProfile).mockReturnValue({
      currentProfile: profileA, settings: {} as never, hasProfile: true, isAllMode: false,
    });
    vi.mocked(useProfileScope).mockReturnValue(null);
    useNotificationStore.getState().addEvent(
      profileA.id,
      { EventId: 1, MonitorId: 7, MonitorName: 'Cam', Name: 'Event-1', Cause: 'Motion' },
      'websocket'
    );
  });

  afterEach(() => {
    useNotificationStore.setState({ profileEvents: {} });
  });

  it('renders one seeded event against the real store without a max-depth render loop', () => {
    const onError = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPage();

    expect(screen.getAllByTestId('notification-history-item')).toHaveLength(1);
    const maxDepthError = onError.mock.calls.some((args) =>
      args.some((a) => typeof a === 'string' && a.includes('Maximum update depth exceeded'))
    );
    expect(maxDepthError).toBe(false);
    onError.mockRestore();
  });
});
