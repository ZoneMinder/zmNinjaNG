import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import NotificationSettings from '../NotificationSettings';
import { useCurrentProfile, useProfileById } from '../../hooks/useCurrentProfile';
import { useProfileScope } from '../../hooks/useProfileScope';
import { getSession } from '../../services/sessions';
import { getMonitors } from '../../api/monitors';
import { asProfileId, ALL_PROFILES_ID } from '../../api/types';
import { useSettingsStore } from '../../stores/settings';

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
  getSession: vi.fn(),
}));
vi.mock('../../api/monitors', () => ({
  getMonitors: vi.fn().mockResolvedValue({ monitors: [] }),
}));
vi.mock('../../api/notifications', () => ({
  checkNotificationsApiSupport: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../services/eventPoller', () => ({
  getEventPoller: () => ({ isRunning: () => false, stop: vi.fn() }),
  stopEventPoller: vi.fn(),
}));
// Keyed by profileId so All-mode tests can give each profile a distinct
// config; a test that never populates it falls back to the previous
// hardcoded settings (unaffected).
const { notificationSettingsFixture, DEFAULT_TEST_SETTINGS } = vi.hoisted(() => {
  const DEFAULT_TEST_SETTINGS = { enabled: true, notificationMode: 'es' as const, host: 'zm.local' };
  return {
    DEFAULT_TEST_SETTINGS,
    notificationSettingsFixture: {} as Record<string, { enabled: boolean; notificationMode: 'es' | 'direct'; host: string }>,
  };
});

vi.mock('../../stores/notifications', () => ({
  useNotificationStore: (selector: (state: {
    getProfileSettings: (profileId: string) => unknown;
    getUnreadCount: () => number;
    updateProfileSettings: () => void;
    setMonitorFilter: () => void;
    connect: () => void;
    disconnect: () => void;
    connections: Record<string, string>;
  }) => unknown) =>
    selector({
      getProfileSettings: (profileId: string) => notificationSettingsFixture[profileId] ?? DEFAULT_TEST_SETTINGS,
      getUnreadCount: () => 0,
      updateProfileSettings: vi.fn(),
      setMonitorFilter: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      connections: {},
    }),
  startEventPoller: vi.fn(),
}));
vi.mock('../../components/NotificationBadge', () => ({
  NotificationBadge: () => null,
}));
vi.mock('../../components/notifications/NotificationModeSection', () => ({
  NotificationModeSection: () => null,
}));
// Renders the host it received (instead of null) so tests can assert the
// form actually reflects the currently-selected profile's settings.
vi.mock('../../components/notifications/ServerConfigSection', () => ({
  ServerConfigSection: ({ settings }: { settings: { host: string } }) => (
    <div data-testid="mock-server-config-host">{settings.host}</div>
  ),
}));
vi.mock('../../components/notifications/MonitorFilterSection', () => ({
  MonitorFilterSection: () => null,
}));

const SelectContext = createContext<{ onValueChange?: (value: string) => void }>({});
vi.mock('../../components/ui/select', () => ({
  Select: ({ children, onValueChange }: { children: ReactNode; onValueChange?: (value: string) => void }) => (
    <SelectContext.Provider value={{ onValueChange }}>{children}</SelectContext.Provider>
  ),
  SelectTrigger: ({ children, ...props }: { children: ReactNode }) => (
    <button type="button" {...props}>{children}</button>
  ),
  SelectValue: ({ placeholder }: { placeholder: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value, ...props }: { children: ReactNode; value: string }) => {
    const ctx = useContext(SelectContext);
    return (
      <button type="button" {...props} onClick={() => ctx.onValueChange?.(value)}>
        {children}
      </button>
    );
  },
}));

const profileA = { id: asProfileId('profile-a'), name: 'Home' } as import('../../api/types').Profile;
const profileB = { id: asProfileId('profile-b'), name: 'Work' } as import('../../api/types').Profile;

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

describe('NotificationSettings page - All mode profile picker (refs #337)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(notificationSettingsFixture).forEach((key) => delete notificationSettingsFixture[key]);
    vi.mocked(getSession).mockImplementation((id) => ({
      profileId: id,
      client: { profile: id } as never,
      timezone: 'UTC',
    }));
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
  });

  it('gates the whole (server-scoped) page behind a picker defaulted to the first profile, and switching fetches via B', async () => {
    renderPage();

    expect(screen.getByTestId('page-profile-picker')).toBeInTheDocument();
    await waitFor(() => expect(getMonitors).toHaveBeenCalled());
    expect(getSession).toHaveBeenCalledWith(profileA.id);

    fireEvent.click(screen.getByTestId('page-profile-picker-option-profile-b'));

    await waitFor(() => expect(getSession).toHaveBeenCalledWith(profileB.id));
  });

  it('renders a per-profile overview row for each profile with correct enabled/mode/host values', async () => {
    notificationSettingsFixture['profile-a'] = { enabled: true, notificationMode: 'es', host: 'a.zm.local' };
    notificationSettingsFixture['profile-b'] = { enabled: false, notificationMode: 'direct', host: '' };

    renderPage();

    const rowA = await screen.findByTestId('notification-overview-row-profile-a');
    expect(rowA).toHaveTextContent('Home');
    expect(rowA).toHaveTextContent('a.zm.local');
    expect(rowA).toHaveTextContent('notification_settings.mode_es');
    expect(rowA).toHaveTextContent('notification_settings.overview_enabled');

    const rowB = screen.getByTestId('notification-overview-row-profile-b');
    expect(rowB).toHaveTextContent('Work');
    expect(rowB).toHaveTextContent('notification_settings.mode_direct');
    expect(rowB).toHaveTextContent('notification_settings.overview_disabled');
    // Direct mode ignores whatever `host` holds and shows the mode-specific label instead.
    expect(rowB).toHaveTextContent('notification_settings.overview_direct_mode_host');
  });

  it('clicking an overview row selects that profile, switching the form to show its host', async () => {
    notificationSettingsFixture['profile-a'] = { enabled: true, notificationMode: 'es', host: 'a.zm.local' };
    notificationSettingsFixture['profile-b'] = { enabled: true, notificationMode: 'es', host: 'b.zm.local' };

    renderPage();

    await waitFor(() => expect(getSession).toHaveBeenCalledWith(profileA.id));
    expect(screen.getByTestId('mock-server-config-host')).toHaveTextContent('a.zm.local');
    expect(screen.getByTestId('notification-overview-row-profile-a')).toHaveAttribute('aria-current', 'true');

    fireEvent.click(screen.getByTestId('notification-overview-row-profile-b'));

    await waitFor(() => expect(getSession).toHaveBeenCalledWith(profileB.id));
    expect(screen.getByTestId('mock-server-config-host')).toHaveTextContent('b.zm.local');
    expect(screen.getByTestId('notification-overview-row-profile-b')).toHaveAttribute('aria-current', 'true');
  });

  it('single mode: shows the per-profile caption and no overview list', async () => {
    vi.mocked(useCurrentProfile).mockReturnValue({
      currentProfile: profileA, settings: {} as never, hasProfile: true, isAllMode: false,
    });

    renderPage();

    await waitFor(() => expect(getSession).toHaveBeenCalledWith(profileA.id));
    expect(screen.getByTestId('notification-per-profile-caption')).toBeInTheDocument();
    expect(screen.queryByTestId('notification-overview')).not.toBeInTheDocument();
    expect(screen.queryByTestId('page-profile-picker')).not.toBeInTheDocument();
  });

  describe('all-mode mute toggle (refs #337)', () => {
    afterEach(() => {
      useSettingsStore.setState({ profileSettings: {} });
    });

    it('reflects the ALL-bucket setting and is not shown in single mode', async () => {
      vi.mocked(useProfileScope).mockReturnValue({
        mode: 'all', profile: null, profiles: [profileA, profileB],
        settings: { allModeMuteToasts: true } as never,
      });
      renderPage();

      const toggle = await screen.findByTestId('all-mode-mute-toggle');
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });

    it('toggling it updates the real settings store under ALL_PROFILES_ID', async () => {
      vi.mocked(useProfileScope).mockReturnValue({
        mode: 'all', profile: null, profiles: [profileA, profileB],
        settings: { allModeMuteToasts: false } as never,
      });
      renderPage();

      const toggle = await screen.findByTestId('all-mode-mute-toggle');
      fireEvent.click(toggle);

      await waitFor(() =>
        expect(useSettingsStore.getState().getProfileSettings(ALL_PROFILES_ID).allModeMuteToasts).toBe(true)
      );
    });

    it('does not render in single mode', async () => {
      vi.mocked(useCurrentProfile).mockReturnValue({
        currentProfile: profileA, settings: {} as never, hasProfile: true, isAllMode: false,
      });
      renderPage();

      await waitFor(() => expect(getSession).toHaveBeenCalledWith(profileA.id));
      expect(screen.queryByTestId('all-mode-mute-toggle')).not.toBeInTheDocument();
    });
  });
});
