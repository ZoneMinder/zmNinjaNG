/**
 * Regression test for the notification overview render loop (refs #337):
 * a selector that allocates a fresh array on every call breaks useShallow's
 * element-wise compare and useSyncExternalStore loops ("Maximum update depth
 * exceeded"). Must render against the REAL store - a test double that calls
 * `selector(state)` directly (as NotificationSettings.allmode.test.tsx's
 * mock does) bypasses useSyncExternalStore and cannot catch this class of
 * bug. See NotificationHistory.realstore.test.tsx for the sibling case this
 * mirrors.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import NotificationSettings from '../NotificationSettings';
import { useCurrentProfile, useProfileById } from '../../hooks/useCurrentProfile';
import { useProfileScope } from '../../hooks/useProfileScope';
import { useNotificationStore } from '../../stores/notifications';
import { asProfileId } from '../../api/types';
import type { Profile } from '../../api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: vi.fn(),
  useProfileById: vi.fn(),
}));
vi.mock('../../hooks/useProfileScope', () => ({
  useProfileScope: vi.fn(),
}));
vi.mock('../../stores/profile', () => ({
  useProfileStore: (selector: (state: { getDecryptedPassword: () => null }) => unknown) =>
    selector({ getDecryptedPassword: vi.fn() }),
}));
vi.mock('../../stores/auth', () => ({
  useAuthSlice: () => ({ isAuthenticated: true }),
}));
vi.mock('../../services/sessions', () => ({
  getSession: vi.fn((id) => ({ profileId: id, client: {} as never, timezone: 'UTC' })),
}));
vi.mock('../../api/monitors', () => ({
  getMonitors: vi.fn().mockResolvedValue({ monitors: [] }),
}));
vi.mock('../../api/notifications', () => ({
  checkNotificationsApiSupport: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../services/eventPoller', () => ({
  getEventPoller: () => ({ isRunning: () => false, stop: vi.fn() }),
}));
vi.mock('../../components/NotificationBadge', () => ({
  NotificationBadge: () => null,
}));
vi.mock('../../components/notifications/NotificationModeSection', () => ({
  NotificationModeSection: () => null,
}));
vi.mock('../../components/notifications/ServerConfigSection', () => ({
  ServerConfigSection: () => null,
}));
vi.mock('../../components/notifications/MonitorFilterSection', () => ({
  MonitorFilterSection: () => null,
}));
// Note: stores/notifications is intentionally NOT mocked - this test needs
// the real zustand store and its useSyncExternalStore-backed subscriptions.

const profileA = { id: asProfileId('profile-a'), name: 'Home' } as Profile;
const profileB = { id: asProfileId('profile-b'), name: 'Work' } as Profile;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NotificationSettings />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('NotificationSettings page - real store render loop regression (refs #337)', () => {
  beforeEach(() => {
    vi.mocked(useCurrentProfile).mockReturnValue({
      currentProfile: null, settings: {} as never, hasProfile: false, isAllMode: true,
    });
    vi.mocked(useProfileById).mockImplementation((id) => ({
      profile: id ? [profileA, profileB].find((p) => p.id === id) ?? null : null,
      settings: {} as never,
    }));
    vi.mocked(useProfileScope).mockReturnValue({
      mode: 'all', profile: null, profiles: [profileA, profileB], settings: {} as never,
    });
    useNotificationStore.getState().updateProfileSettings(profileA.id, {
      enabled: true, notificationMode: 'es', host: 'a.zm.local',
    });
    useNotificationStore.getState().updateProfileSettings(profileB.id, {
      enabled: false, notificationMode: 'direct', host: '',
    });
  });

  afterEach(() => {
    useNotificationStore.setState({ profileSettings: {} });
  });

  it('renders the All-mode overview for both profiles against the real store without a max-depth render loop', () => {
    const onError = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPage();

    expect(screen.getByTestId('notification-overview-row-profile-a')).toBeInTheDocument();
    expect(screen.getByTestId('notification-overview-row-profile-b')).toBeInTheDocument();
    const maxDepthError = onError.mock.calls.some((args) =>
      args.some((a) => typeof a === 'string' && a.includes('Maximum update depth exceeded'))
    );
    expect(maxDepthError).toBe(false);
    onError.mockRestore();
  });
});
