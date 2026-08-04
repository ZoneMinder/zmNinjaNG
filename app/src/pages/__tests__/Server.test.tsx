import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import Server from '../Server';
import { useCurrentProfile, useProfileById } from '../../hooks/useCurrentProfile';
import { useProfileScope } from '../../hooks/useProfileScope';
import { getSession } from '../../services/sessions';
import { getServers } from '../../api/server';
import { asProfileId, ALL_PROFILES_ID } from '../../api/types';

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
vi.mock('../../hooks/useBandwidthSettings', () => ({
  useBandwidthSettings: () => ({ daemonCheckInterval: 30000 }),
}));
vi.mock('../../stores/auth', () => ({
  useAuthSlice: () => ({ isAuthenticated: true, version: '1.36', apiVersion: '2.0' }),
}));
vi.mock('../../services/sessions', () => ({
  getSession: vi.fn(),
}));
vi.mock('../../api/server', () => ({
  getServers: vi.fn().mockResolvedValue([]),
  getLoad: vi.fn().mockResolvedValue({}),
  getDiskPercent: vi.fn().mockResolvedValue({}),
  getDaemonCheck: vi.fn().mockResolvedValue(true),
  getStorages: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../api/time', () => ({
  getServerTimeZone: vi.fn().mockResolvedValue('UTC'),
}));
vi.mock('../../api/states', () => ({
  getStates: vi.fn().mockResolvedValue([]),
  changeState: vi.fn(),
}));
vi.mock('../../hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock('../../components/NotificationBadge', () => ({
  NotificationBadge: () => null,
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

function renderServer() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Server />
    </QueryClientProvider>
  );
}

describe('Server page - profile picker (refs #337)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockImplementation((id) => ({
      profileId: id,
      client: { profile: id } as never,
      timezone: 'UTC',
    }));
  });

  it('single mode: no picker, fetches via the current profile', async () => {
    vi.mocked(useCurrentProfile).mockReturnValue({
      currentProfile: profileA, settings: {} as never, hasProfile: true, isAllMode: false,
    });
    vi.mocked(useProfileById).mockReturnValue({ profile: null, settings: {} as never });
    vi.mocked(useProfileScope).mockReturnValue({ mode: 'single', profile: profileA, profiles: [profileA], settings: {} as never });

    renderServer();

    await waitFor(() => expect(getServers).toHaveBeenCalled());
    expect(getSession).toHaveBeenCalledWith(profileA.id);
    expect(screen.queryByTestId('page-profile-picker')).toBeNull();
  });

  it('All mode: shows picker defaulted to first profile, and picking B fetches via B', async () => {
    vi.mocked(useCurrentProfile).mockReturnValue({
      currentProfile: null, settings: {} as never, hasProfile: false, isAllMode: true,
    });
    vi.mocked(useProfileById).mockImplementation((id) => ({
      profile: id ? [profileA, profileB].find((p) => p.id === id) ?? null : null,
      settings: {} as never,
    }));
    vi.mocked(useProfileScope).mockReturnValue({ mode: 'all', aggregateId: ALL_PROFILES_ID, aggregateName: null, profile: null, profiles: [profileA, profileB], settings: {} as never });

    renderServer();

    await waitFor(() => expect(getServers).toHaveBeenCalled());
    expect(getSession).toHaveBeenCalledWith(profileA.id);
    expect(screen.getByTestId('page-profile-picker')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('page-profile-picker-option-profile-b'));

    await waitFor(() => expect(getSession).toHaveBeenCalledWith(profileB.id));
  });
});
