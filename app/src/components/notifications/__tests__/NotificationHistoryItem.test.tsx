import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { NotificationHistoryItem, type HistoryEvent } from '../NotificationHistoryItem';
import * as currentProfileModule from '../../../hooks/useCurrentProfile';
import { buildThumbnailChain } from '../../../lib/event/thumbnail-chain';
import { seedProfiles, resetProfileFixture, makeProfile } from '../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../tests/fake-store-gates';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { id?: unknown }) => `${key}${opts?.id !== undefined ? `:${opts.id}` : ''}` }),
}));
vi.mock('../../../hooks/useDateTimeFormat', () => ({
  useDateTimeFormat: () => ({ fmtDateTimeShort: (d: Date) => d.toISOString() }),
}));
vi.mock('../../../lib/event/thumbnail-chain', () => ({
  buildThumbnailChain: vi.fn().mockReturnValue(['https://thumb.example/1.jpg']),
}));
vi.mock('../../events/EventThumbnail', () => ({
  EventThumbnail: ({ urls }: { urls: string[] }) => <div data-testid="thumb">{urls.join(',')}</div>,
}));
vi.mock('../../ui/hover-preview', () => ({
  HoverPreview: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../events/EventThumbnailHoverPreview', () => ({
  EventZmsHoverPlayer: () => null,
}));

const profileB = makeProfile('profile-b', { name: 'Work', portalUrl: 'https://work.example/zm' });
const settingsB = { thumbnailFallbackChain: [] as never, forceDisableMultiPort: false, hoverPreview: { notifications: false } as never };

const baseEvent: HistoryEvent = {
  EventId: 42,
  MonitorId: 7,
  MonitorName: 'Cam',
  Cause: 'Motion',
  Notes: '',
  receivedAt: Date.now(),
  read: false,
  source: 'websocket',
  profileId: profileB.id,
  profileName: profileB.name,
} as HistoryEvent;

describe('NotificationHistoryItem (refs #337)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedProfiles([profileB], { settings: { [profileB.id]: settingsB } });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('resolves the thumbnail chain via the OWNING profile, not any global current profile', () => {
    const spy = vi.spyOn(currentProfileModule, 'useProfileById');

    render(<NotificationHistoryItem event={baseEvent} showProfileChip onView={vi.fn()} onMarkRead={vi.fn()} />);

    expect(spy).toHaveBeenCalledWith(profileB.id);
    expect(buildThumbnailChain).toHaveBeenCalledWith(
      profileB.portalUrl,
      String(baseEvent.EventId),
      settingsB.thumbnailFallbackChain,
      expect.objectContaining({ token: `access-${profileB.id}` })
    );
  });

  it('shows the profile chip when showProfileChip is true, hides it otherwise', () => {
    const { rerender } = render(
      <NotificationHistoryItem event={baseEvent} showProfileChip onView={vi.fn()} onMarkRead={vi.fn()} />
    );
    expect(screen.getByTestId('notification-profile-chip')).toHaveTextContent('Work');

    rerender(<NotificationHistoryItem event={baseEvent} showProfileChip={false} onView={vi.fn()} onMarkRead={vi.fn()} />);
    expect(screen.queryByTestId('notification-profile-chip')).toBeNull();
  });

  it('mark-read button calls onMarkRead with the tagged event', () => {
    const onMarkRead = vi.fn();
    render(<NotificationHistoryItem event={baseEvent} showProfileChip onView={vi.fn()} onMarkRead={onMarkRead} />);
    fireEvent.click(screen.getByTestId('mark-read'));
    expect(onMarkRead).toHaveBeenCalledWith(baseEvent);
  });
});
