import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useProfileScope } from '../../hooks/useProfileScope';
import { asProfileId, ALL_PROFILES_ID } from '../../api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { count?: number }) => `${key}:${opts?.count ?? ''}` }),
}));
vi.mock('../../hooks/useProfileScope', () => ({
  useProfileScope: vi.fn(),
}));

const profileA = asProfileId('profile-a');
const profileB = asProfileId('profile-b');

const unreadEvent = (id: number) => ({ EventId: id, read: false }) as never;
const readEvent = (id: number) => ({ EventId: id, read: true }) as never;

function mockProfileEvents(profileEvents: Record<string, unknown[]>, currentProfileId: string | null) {
  vi.doMock('../../stores/profile', () => ({
    useProfileStore: (selector: (state: { currentProfileId: string | null }) => unknown) =>
      selector({ currentProfileId }),
  }));
  vi.doMock('../../stores/notifications', () => ({
    useNotificationStore: (selector: (state: { profileEvents: Record<string, unknown[]> }) => unknown) =>
      selector({ profileEvents }),
  }));
}

describe('NotificationBadge (refs #337)', () => {
  it('single mode: unchanged, counts only the current profile bucket', async () => {
    vi.resetModules();
    mockProfileEvents(
      { [profileA]: [unreadEvent(1), readEvent(2)], [profileB]: [unreadEvent(3), unreadEvent(4)] },
      profileA
    );
    vi.mocked(useProfileScope).mockReturnValue(null);
    const { NotificationBadge: Badge } = await import('../NotificationBadge');

    render(<MemoryRouter><Badge /></MemoryRouter>);
    expect(screen.getByTestId('notification-badge')).toHaveTextContent('1');
  });

  it('All mode: sums unread across every scope profile, never the ALL_PROFILES_ID sentinel bucket', async () => {
    vi.resetModules();
    mockProfileEvents(
      {
        [profileA]: [unreadEvent(1), readEvent(2)],
        [profileB]: [unreadEvent(3), unreadEvent(4)],
        [ALL_PROFILES_ID]: [unreadEvent(99), unreadEvent(98), unreadEvent(97)],
      },
      ALL_PROFILES_ID
    );
    vi.mocked(useProfileScope).mockReturnValue({
      mode: 'all', aggregateId: ALL_PROFILES_ID, aggregateName: null,
      profile: null,
      profiles: [{ id: profileA, name: 'A' }, { id: profileB, name: 'B' }] as never,
      settings: {} as never,
    });
    const { NotificationBadge: Badge } = await import('../NotificationBadge');

    render(<MemoryRouter><Badge /></MemoryRouter>);
    // 1 unread from A + 2 unread from B = 3; the sentinel bucket's 3 unread
    // events must NOT be added (would make this 6).
    expect(screen.getByTestId('notification-badge')).toHaveTextContent('3');
  });
});
