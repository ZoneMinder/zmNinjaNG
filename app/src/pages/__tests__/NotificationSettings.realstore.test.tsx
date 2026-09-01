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
import { render, screen, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import NotificationSettings from '../NotificationSettings';
import { useCurrentProfile, useProfileById } from '../../hooks/useCurrentProfile';
import { useProfileScope } from '../../hooks/useProfileScope';
import { useNotificationStore } from '../../stores/notifications';
import { Platform } from '../../lib/platform';

// Platform.isNative is a getter; spy on it rather than assigning.
let nativeSpy: ReturnType<typeof vi.spyOn> | undefined;
const pretendNative = () => {
  nativeSpy = vi.spyOn(Platform, 'isNative', 'get').mockReturnValue(true);
};
import { asProfileId, ALL_PROFILES_ID } from '../../api/types';
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
const pollerState = vi.hoisted(() => ({
  running: false,
  listeners: new Set<() => void>(),
  setRunning(running: boolean) {
    pollerState.running = running;
    for (const listener of pollerState.listeners) listener();
  },
}));
vi.mock('../../services/eventPoller', () => ({
  getEventPoller: vi.fn(() => ({ isRunning: () => pollerState.running, stop: vi.fn() })),
  isEventPollerRunning: vi.fn(() => pollerState.running),
  subscribeEventPollers: (listener: () => void) => {
    pollerState.listeners.add(listener);
    return () => pollerState.listeners.delete(listener);
  },
  stopEventPoller: vi.fn(),
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
      mode: 'all', aggregateId: ALL_PROFILES_ID, aggregateName: null, profile: null, profiles: [profileA, profileB], settings: {} as never,
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

/**
 * The direct-mode badge read the toggle, not the outcome. Registration failing
 * (a server without the endpoint, a rejected token) leaves notificationId
 * unset and only writes a log line, so the user saw "active", never got a
 * notification, and had nothing to go on. Refs #392 P11-2.
 */
describe('NotificationSettings direct-mode badge reflects registration, not intent', () => {
  beforeEach(() => {
    vi.mocked(useCurrentProfile).mockReturnValue({
      currentProfile: profileA, settings: {} as never, hasProfile: true, isAllMode: false,
    });
    vi.mocked(useProfileById).mockImplementation(() => ({ profile: profileA, settings: {} as never }));
    vi.mocked(useProfileScope).mockReturnValue({
      mode: 'single', profile: profileA, profiles: [profileA], settings: {} as never,
    });
  });

  afterEach(() => {
    useNotificationStore.setState({ profileSettings: {} });
    pollerState.running = false;
    pollerState.listeners.clear();
    nativeSpy?.mockRestore();
    nativeSpy = undefined;
  });

  it('off-native reports the poller, which is how direct mode delivers there', () => {
    // jsdom is the web platform; no Platform override. The suite's eventPoller
    // mock reports isRunning() false, so the badge must say the poller is
    // stopped -- and never the FCM registered/not-registered split, which
    // cannot happen off-native.
    useNotificationStore.getState().updateProfileSettings(profileA.id, {
      enabled: true, notificationMode: 'direct', host: 'a.zm.local', notificationId: null,
    });
    renderPage();
    expect(screen.getByText('notifications.status.direct_poller_stopped').textContent)
      .toBe('notifications.status.direct_poller_stopped');
    expect(screen.queryByText('notifications.status.direct_registering')).toBeNull();
  });

  it('off-native shows polling when the poller runs', () => {
    pollerState.running = true;
    useNotificationStore.getState().updateProfileSettings(profileA.id, {
      enabled: true, notificationMode: 'direct', host: 'a.zm.local', notificationId: null,
    });
    renderPage();
    expect(screen.getByText('notifications.status.direct_polling').textContent)
      .toBe('notifications.status.direct_polling');
  });

  // The poller starts asynchronously after the mode switch, so the badge that
  // read isRunning() during render was stale until an unrelated re-render (the
  // user navigating away and back) happened to re-read it.
  it('flips to polling when the poller starts after render, without a remount', () => {
    useNotificationStore.getState().updateProfileSettings(profileA.id, {
      enabled: true, notificationMode: 'direct', host: 'a.zm.local', notificationId: null,
    });
    renderPage();
    expect(screen.getByText('notifications.status.direct_poller_stopped').textContent)
      .toBe('notifications.status.direct_poller_stopped');

    act(() => pollerState.setRunning(true));

    expect(screen.getByText('notifications.status.direct_polling').textContent)
      .toBe('notifications.status.direct_polling');
    expect(screen.queryByText('notifications.status.direct_poller_stopped')).toBeNull();
  });

  it('says not registered when direct push is on but registration never succeeded', () => {
    pretendNative();
    useNotificationStore.getState().updateProfileSettings(profileA.id, {
      enabled: true, notificationMode: 'direct', host: 'a.zm.local', notificationId: null,
    });
    renderPage();
    expect(screen.getByText('notifications.status.direct_registering').textContent)
      .toBe('notifications.status.direct_registering');
    expect(screen.queryByText('notifications.status.direct_active')).toBeNull();
  });

  it('says active once the server has returned a registration id', () => {
    pretendNative();
    useNotificationStore.getState().updateProfileSettings(profileA.id, {
      enabled: true, notificationMode: 'direct', host: 'a.zm.local', notificationId: 42,
    });
    renderPage();
    expect(screen.getByText('notifications.status.direct_active').textContent)
      .toBe('notifications.status.direct_active');
  });
});
