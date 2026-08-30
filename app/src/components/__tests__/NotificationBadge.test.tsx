import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { asProfileId, ALL_PROFILES_ID } from '../../api/types';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { count?: number }) => `${key}:${opts?.count ?? ''}` }),
}));

const profileA = asProfileId('profile-a');
const profileB = asProfileId('profile-b');

const unreadEvent = (id: number) => ({ EventId: id, read: false }) as never;
const readEvent = (id: number) => ({ EventId: id, read: true }) as never;

function mockNotifications(profileEvents: Record<string, unknown[]>) {
  vi.doMock('../../stores/notifications', () => ({
    useNotificationStore: (selector: (state: { profileEvents: Record<string, unknown[]> }) => unknown) =>
      selector({ profileEvents }),
  }));
}

// vi.resetModules() gives each test a fresh store module instance, so the
// dynamically re-imported profile-fixture below is the SAME instance
// NotificationBadge's own dynamic import resolves to; no explicit teardown
// needed between tests.
describe('NotificationBadge (refs #337)', () => {
  afterEach(() => {
    vi.doUnmock('../../stores/notifications');
  });

  it('single mode: unchanged, counts only the current profile bucket', async () => {
    vi.resetModules();
    mockNotifications({ [profileA]: [unreadEvent(1), readEvent(2)], [profileB]: [unreadEvent(3), unreadEvent(4)] });
    const { seedProfiles } = await import('../../tests/profile-fixture');
    seedProfiles([profileA, profileB], { current: profileA });
    const { NotificationBadge: Badge } = await import('../NotificationBadge');

    render(<MemoryRouter><Badge /></MemoryRouter>);
    expect(screen.getByTestId('notification-badge')).toHaveTextContent('1');
  });

  it('All mode: sums unread across every scope profile, never the ALL_PROFILES_ID sentinel bucket', async () => {
    vi.resetModules();
    mockNotifications({
      [profileA]: [unreadEvent(1), readEvent(2)],
      [profileB]: [unreadEvent(3), unreadEvent(4)],
      [ALL_PROFILES_ID]: [unreadEvent(99), unreadEvent(98), unreadEvent(97)],
    });
    const { seedProfiles } = await import('../../tests/profile-fixture');
    seedProfiles([profileA, profileB], { current: ALL_PROFILES_ID });
    const { NotificationBadge: Badge } = await import('../NotificationBadge');

    render(<MemoryRouter><Badge /></MemoryRouter>);
    // 1 unread from A + 2 unread from B = 3; the sentinel bucket's 3 unread
    // events must NOT be added (would make this 6).
    expect(screen.getByTestId('notification-badge')).toHaveTextContent('3');
  });
});
