import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import NotificationSettings from '../NotificationSettings';
import { getMonitors } from '../../api/monitors';
import { ALL_PROFILES_ID, mintVirtualProfileId } from '../../api/types';
import { useSettingsStore } from '../../stores/settings';
import { useNotificationStore } from '../../stores/notifications';
import { useProfileStore } from '../../stores/profile';
import { seedProfiles, resetProfileFixture, fakeApiClient, makeProfile, type FakeApiClient } from '../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../tests/fake-store-gates';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

// Interpolation values are appended so a test can assert which aggregate a
// label named, not just which key it used.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, params?: Record<string, unknown>) =>
      params ? `${k}:${JSON.stringify(params)}` : k,
  }),
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
// startEventPoller reaches into eventPoller/session wiring only exercised by
// mode-switch flows none of these tests trigger; stubbed defensively the same
// way useNotificationAutoConnect.test.ts does. Everything else - settings,
// unread counts, connections - runs against the real store.
vi.mock('../../stores/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../stores/notifications')>();
  return { ...actual, startEventPoller: vi.fn() };
});

const DEFAULT_TEST_SETTINGS = { enabled: true, notificationMode: 'es' as const, host: 'zm.local' };
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

const SelectContext = createContext<{ onValueChange?: (value: string) => void; value?: string }>({});
vi.mock('../../components/ui/select', () => ({
  Select: ({ children, onValueChange, value }: { children: ReactNode; onValueChange?: (value: string) => void; value?: string }) => (
    <SelectContext.Provider value={{ onValueChange, value }}>{children}</SelectContext.Provider>
  ),
  SelectTrigger: ({ children, ...props }: { children: ReactNode }) => (
    <button type="button" {...props}>{children}</button>
  ),
  SelectValue: ({ placeholder }: { placeholder: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value, ...props }: { children: ReactNode; value: string }) => {
    const ctx = useContext(SelectContext);
    return (
      <button
        type="button"
        data-selected={ctx.value === value}
        {...props}
        onClick={() => ctx.onValueChange?.(value)}
      >
        {children}
      </button>
    );
  },
}));

const profileA = makeProfile('profile-a', { name: 'Home' });
const profileB = makeProfile('profile-b', { name: 'Work' });

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
  let clientA: FakeApiClient;
  let clientB: FakeApiClient;

  beforeEach(() => {
    seedProfiles([profileA, profileB], { current: ALL_PROFILES_ID });
    useNotificationStore.getState().updateProfileSettings(profileA.id, { ...DEFAULT_TEST_SETTINGS });
    useNotificationStore.getState().updateProfileSettings(profileB.id, { ...DEFAULT_TEST_SETTINGS });
    clientA = fakeApiClient({ '/servers.json': { servers: [] } });
    clientB = fakeApiClient({ '/servers.json': { servers: [] } });
    installApiClient(profileA.id, clientA);
    installApiClient(profileB.id, clientB);
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
    useNotificationStore.setState({ profileSettings: {}, connections: {}, profileEvents: {} });
  });

  it('gates the whole (server-scoped) page behind a picker defaulted to the first profile, and switching fetches via B', async () => {
    renderPage();

    expect(screen.getByTestId('page-profile-picker')).toBeInTheDocument();
    // The real session registry hands the query the client installed for the
    // picked profile - proof it resolved via that profile, not another.
    await waitFor(() => expect(vi.mocked(getMonitors)).toHaveBeenCalledWith(clientA, profileA.id));

    fireEvent.click(screen.getByTestId('page-profile-picker-option-profile-b'));

    await waitFor(() => expect(vi.mocked(getMonitors)).toHaveBeenCalledWith(clientB, profileB.id));
  });

  it('renders a per-profile overview row for each profile with correct enabled/mode/host values', async () => {
    useNotificationStore.getState().updateProfileSettings(profileA.id, { enabled: true, notificationMode: 'es', host: 'a.zm.local' });
    useNotificationStore.getState().updateProfileSettings(profileB.id, { enabled: false, notificationMode: 'direct', host: '' });

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
    useNotificationStore.getState().updateProfileSettings(profileA.id, { enabled: true, notificationMode: 'es', host: 'a.zm.local' });
    useNotificationStore.getState().updateProfileSettings(profileB.id, { enabled: true, notificationMode: 'es', host: 'b.zm.local' });

    renderPage();

    await waitFor(() => expect(screen.getByTestId('mock-server-config-host')).toHaveTextContent('a.zm.local'));
    expect(screen.getByTestId('notification-overview-row-profile-a')).toHaveAttribute('aria-current', 'true');

    fireEvent.click(screen.getByTestId('notification-overview-row-profile-b'));

    await waitFor(() => expect(screen.getByTestId('mock-server-config-host')).toHaveTextContent('b.zm.local'));
    expect(screen.getByTestId('notification-overview-row-profile-b')).toHaveAttribute('aria-current', 'true');
  });

  it('single mode: shows the per-profile caption and no overview list', async () => {
    useProfileStore.setState({ currentProfileId: profileA.id });

    renderPage();

    expect(await screen.findByTestId('notification-per-profile-caption')).toBeInTheDocument();
    expect(screen.queryByTestId('notification-overview')).not.toBeInTheDocument();
    expect(screen.queryByTestId('page-profile-picker')).not.toBeInTheDocument();
  });

  describe('all-mode notifications live/muted/off select (refs #337)', () => {
    afterEach(() => {
      useSettingsStore.setState({ profileSettings: {} });
    });

    it('reflects the ALL-bucket setting and is not shown in single mode', async () => {
      useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, { allModeNotifications: 'muted' });
      renderPage();

      const mutedOption = await screen.findByTestId('all-mode-notifications-option-muted');
      expect(mutedOption).toHaveAttribute('data-selected', 'true');
      expect(screen.getByTestId('all-mode-notifications-option-live')).toHaveAttribute('data-selected', 'false');
      expect(screen.getByTestId('all-mode-notifications-option-off')).toHaveAttribute('data-selected', 'false');
    });

    it('selecting Off updates the real settings store under ALL_PROFILES_ID', async () => {
      useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, { allModeNotifications: 'live' });
      renderPage();

      const offOption = await screen.findByTestId('all-mode-notifications-option-off');
      fireEvent.click(offOption);

      await waitFor(() =>
        expect(useSettingsStore.getState().getProfileSettings(ALL_PROFILES_ID).allModeNotifications).toBe('off')
      );
    });

    // The row governs the aggregate's own connections, so it is titled after
    // the aggregate rather than after All Servers (refs #337).
    it('names the aggregate in its label', async () => {
      renderPage();

      expect(
        await screen.findByText(
          'notification_settings.all_mode_notifications_label:{"name":"profiles.all_servers"}'
        )
      ).toBeInTheDocument();
    });

    it('names an active group in its label', async () => {
      const group = { id: mintVirtualProfileId(), name: 'Backyard', memberProfileIds: [profileA.id, profileB.id] };
      useProfileStore.setState({ virtualProfiles: [group], currentProfileId: group.id });
      useSettingsStore.getState().updateProfileSettings(group.id, { allModeNotifications: 'live' });

      renderPage();

      expect(
        await screen.findByText(
          'notification_settings.all_mode_notifications_label:{"name":"Backyard"}'
        )
      ).toBeInTheDocument();
    });

    // Each aggregate owns its own bucket: muting a group must not mute All
    // Servers (refs #337).
    it("selecting Off updates the active group's bucket, leaving the ALL sentinel's alone", async () => {
      const group = { id: mintVirtualProfileId(), name: 'Backyard', memberProfileIds: [profileA.id, profileB.id] };
      useProfileStore.setState({ virtualProfiles: [group], currentProfileId: group.id });
      useSettingsStore.getState().updateProfileSettings(group.id, { allModeNotifications: 'live' });
      useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, { allModeNotifications: 'live' });

      renderPage();

      fireEvent.click(await screen.findByTestId('all-mode-notifications-option-off'));

      await waitFor(() =>
        expect(useSettingsStore.getState().getProfileSettings(group.id).allModeNotifications).toBe('off')
      );
      expect(
        useSettingsStore.getState().getProfileSettings(ALL_PROFILES_ID).allModeNotifications
      ).toBe('live');
    });

    it('does not render in single mode', async () => {
      useProfileStore.setState({ currentProfileId: profileA.id });
      renderPage();

      await screen.findByTestId('notification-per-profile-caption');
      expect(screen.queryByTestId('all-mode-notifications-select')).not.toBeInTheDocument();
    });
  });
});
