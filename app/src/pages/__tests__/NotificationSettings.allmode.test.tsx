import { describe, it, expect, vi, beforeEach } from 'vitest';
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
import { asProfileId } from '../../api/types';

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
}));
vi.mock('../../stores/notifications', () => ({
  useNotificationStore: (selector: (state: {
    getProfileSettings: () => unknown;
    getUnreadCount: () => number;
    updateProfileSettings: () => void;
    setMonitorFilter: () => void;
    connect: () => void;
    disconnect: () => void;
    connectionState: string;
    isConnected: boolean;
  }) => unknown) =>
    selector({
      getProfileSettings: () => ({ enabled: true, notificationMode: 'es', host: 'zm.local' }),
      getUnreadCount: () => 0,
      updateProfileSettings: vi.fn(),
      setMonitorFilter: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      connectionState: 'disconnected',
      isConnected: false,
    }),
  startEventPoller: vi.fn(),
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
});
