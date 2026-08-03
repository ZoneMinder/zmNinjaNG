import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NotificationHistory from '../NotificationHistory';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import { useProfileScope } from '../../hooks/useProfileScope';
import { asProfileId } from '../../api/types';
import type { Profile } from '../../api/types';
import type { HistoryEvent } from '../../components/notifications/NotificationHistoryItem';

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

const markEventRead = vi.fn();
const markAllRead = vi.fn();
const clearEvents = vi.fn();

const profileA = { id: asProfileId('profile-a'), name: 'Home' } as Profile;
const profileB = { id: asProfileId('profile-b'), name: 'Work' } as Profile;

const eventFrom = (_profileId: string, eventId: number, receivedAt: number, read = false) => ({
  EventId: eventId,
  MonitorId: 7,
  MonitorName: 'Cam',
  Cause: 'Motion',
  Notes: '',
  receivedAt,
  read,
  source: 'websocket' as const,
});

let storeState: { profileEvents: Record<string, ReturnType<typeof eventFrom>[]> };

vi.mock('../../stores/notifications', () => ({
  useNotificationStore: (selector: (state: unknown) => unknown) =>
    selector({
      ...storeState,
      getEvents: (id: string) => storeState.profileEvents[id] || [],
      markEventRead,
      markAllRead,
      clearEvents,
    }),
}));

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

  describe('single mode (unchanged)', () => {
    beforeEach(() => {
      vi.mocked(useCurrentProfile).mockReturnValue({
        currentProfile: profileA, settings: {} as never, hasProfile: true, isAllMode: false,
      });
      vi.mocked(useProfileScope).mockReturnValue(null);
      storeState = { profileEvents: { [profileA.id]: [eventFrom(profileA.id, 1, 100)] } };
    });

    it('lists only the current profile bucket, no chips', () => {
      renderPage();
      expect(screen.getAllByTestId('notification-history-item')).toHaveLength(1);
      expect(screen.queryByTestId('notification-profile-chip')).toBeNull();
    });
  });

  describe('All mode', () => {
    beforeEach(() => {
      vi.mocked(useCurrentProfile).mockReturnValue({
        currentProfile: null, settings: {} as never, hasProfile: false, isAllMode: true,
      });
      vi.mocked(useProfileScope).mockReturnValue({
        mode: 'all', profile: null, profiles: [profileA, profileB], settings: {} as never,
      });
      storeState = {
        profileEvents: {
          [profileA.id]: [eventFrom(profileA.id, 1, 100), eventFrom(profileA.id, 2, 300)],
          [profileB.id]: [eventFrom(profileB.id, 3, 200)],
        },
      };
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
      expect(markEventRead).toHaveBeenCalledWith(profileB.id, 3);
    });

    it('mark all read iterates every scope profile', () => {
      renderPage();
      fireEvent.click(screen.getByText('notification_history.mark_all_read'));
      expect(markAllRead).toHaveBeenCalledWith(profileA.id);
      expect(markAllRead).toHaveBeenCalledWith(profileB.id);
    });

    it('tap-through uses the All-mode deep-link path and marks the owning bucket read', () => {
      renderPage();
      const rows = screen.getAllByTestId('notification-history-item');
      fireEvent.click(rows[1].querySelector('[data-testid="row-view"]')!);
      expect(markEventRead).toHaveBeenCalledWith(profileB.id, 3);
    });
  });
});
