import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NotificationHistory from '../NotificationHistory';
import { ALL_PROFILES_ID } from '../../api/types';
import type { HistoryEvent } from '../../components/notifications/NotificationHistoryItem';
import { seedProfiles, resetProfileFixture, makeProfile } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';
import { useNotificationStore } from '../../stores/notifications';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { count?: number }) => `${key}${opts?.count !== undefined ? `:${opts.count}` : ''}` }),
}));
vi.mock('../../components/NotificationBadge', () => ({
  NotificationBadge: () => null,
}));

const profileA = makeProfile('profile-a', { name: 'Home' });
const profileB = makeProfile('profile-b', { name: 'Work' });

const eventFrom = (_profileId: string, eventId: number, receivedAt: number, read = false) => ({
  EventId: eventId,
  MonitorId: 7,
  MonitorName: 'Cam',
  Name: 'Cam',
  Cause: 'Motion',
  Notes: '',
  receivedAt,
  read,
  source: 'websocket' as const,
});

// Row rendering (thumbnails/hover preview/owning-profile resolution) is
// covered by NotificationHistoryItem's own tests; stub it here so this file
// tests only the page's union/order/chip-gating/action-wiring logic.
vi.mock('../../components/notifications/NotificationHistoryItem', () => ({
  NotificationHistoryItem: ({ event, showProfileChip, onView, onMarkRead }: {
    event: HistoryEvent; showProfileChip: boolean;
    onView: (e: HistoryEvent) => void; onMarkRead: (e: HistoryEvent) => void;
  }) => (
    <div data-testid="notification-history-item">
      <span data-testid="row-event-id">{event.EventId}</span>
      <span data-testid="row-profile-id">{event.profileId}</span>
      {showProfileChip && <span data-testid="notification-profile-chip">{event.profileName}</span>}
      <button data-testid="row-view" onClick={() => onView(event)}>view</button>
      <button data-testid="row-mark-read" onClick={() => onMarkRead(event)}>mark</button>
    </div>
  ),
}));

function renderPage() {
  return render(<MemoryRouter><NotificationHistory /></MemoryRouter>);
}

describe('NotificationHistory page (refs #337)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
    useNotificationStore.setState({ profileEvents: {} });
  });

  describe('single mode (unchanged)', () => {
    beforeEach(() => {
      seedProfiles([profileA], { current: profileA.id });
      useNotificationStore.setState({ profileEvents: { [profileA.id]: [eventFrom(profileA.id, 1, 100)] } });
    });

    it('lists only the current profile bucket, no chips', () => {
      renderPage();
      expect(screen.getAllByTestId('notification-history-item')).toHaveLength(1);
      expect(screen.queryByTestId('notification-profile-chip')).toBeNull();
    });
  });

  describe('All mode', () => {
    beforeEach(() => {
      seedProfiles([profileA, profileB], { current: ALL_PROFILES_ID });
      useNotificationStore.setState({
        profileEvents: {
          [profileA.id]: [eventFrom(profileA.id, 1, 100), eventFrom(profileA.id, 2, 300)],
          [profileB.id]: [eventFrom(profileB.id, 3, 200)],
        },
      });
    });

    it('shows the union of every profile, newest first, with a chip per row', () => {
      renderPage();
      const rows = screen.getAllByTestId('notification-history-item');
      expect(rows).toHaveLength(3);
      // newest (receivedAt 300) first
      expect(rows[0]).toHaveTextContent('2');
      expect(screen.getAllByTestId('notification-profile-chip')).toHaveLength(3);
    });

    it('per-row mark-read writes to the OWNING profile bucket', () => {
      renderPage();
      const rows = screen.getAllByTestId('notification-history-item');
      // Second row (receivedAt 200) belongs to profile B.
      fireEvent.click(rows[1].querySelector('[data-testid="row-mark-read"]')!);
      const event3 = useNotificationStore.getState().profileEvents[profileB.id].find((e) => e.EventId === 3);
      expect(event3?.read).toBe(true);
      // Profile A's own bucket is untouched by a B-owned event's mark-read.
      expect(useNotificationStore.getState().profileEvents[profileA.id].every((e) => !e.read)).toBe(true);
    });

    it('mark all read iterates every scope profile', () => {
      renderPage();
      fireEvent.click(screen.getByText('notification_history.mark_all_read'));
      const events = useNotificationStore.getState().profileEvents;
      expect(events[profileA.id].every((e) => e.read)).toBe(true);
      expect(events[profileB.id].every((e) => e.read)).toBe(true);
    });

    it('tap-through uses the All-mode deep-link path and marks the owning bucket read', () => {
      renderPage();
      const rows = screen.getAllByTestId('notification-history-item');
      fireEvent.click(rows[1].querySelector('[data-testid="row-view"]')!);
      const event3 = useNotificationStore.getState().profileEvents[profileB.id].find((e) => e.EventId === 3);
      expect(event3?.read).toBe(true);
    });
  });
});
