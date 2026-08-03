import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import Logs from '../Logs';
import { useCurrentProfile, useProfileById } from '../../hooks/useCurrentProfile';
import { useProfileScope } from '../../hooks/useProfileScope';
import { getSession } from '../../services/sessions';
import { getZMLogs } from '../../api/logs';
import { asProfileId } from '../../api/types';

vi.mock('../../stores/logs', () => ({
  useLogStore: (selector: (state: { logs: unknown[]; clearLogs: () => void }) => unknown) =>
    selector({ logs: [], clearLogs: vi.fn() }),
}));

vi.mock('../../lib/logger', () => ({
  logger: { getLevel: () => 1, setLevel: vi.fn() },
  log: { server: vi.fn() },
  LogLevel: { DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4 },
}));

vi.mock('../../api/logs', () => ({
  getZMLogs: vi.fn().mockResolvedValue({ logs: [] }),
  getZMLogLevel: () => 'INFO',
  getUniqueZMComponents: () => [],
}));

vi.mock('../../hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));

vi.mock('../../components/NotificationBadge', () => ({
  NotificationBadge: () => null,
}));

vi.mock('../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: vi.fn(),
  useProfileById: vi.fn(),
}));

vi.mock('../../hooks/useProfileScope', () => ({
  useProfileScope: vi.fn(),
}));

vi.mock('../../services/sessions', () => ({
  getSession: vi.fn(),
}));

vi.mock('../../stores/settings', () => ({
  DEFAULT_SETTINGS: { logLevel: 1 },
  useSettingsStore: (selector: (state: { profileSettings: Record<string, unknown>; updateProfileSettings: () => void }) => unknown) =>
    selector({ profileSettings: {}, updateProfileSettings: vi.fn() }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../lib/log-file', () => ({
  getLogFile: () => ({
    truncate: vi.fn().mockResolvedValue(undefined),
    readAll: vi.fn().mockResolvedValue([]),
    append: vi.fn().mockResolvedValue(undefined),
    revealLocation: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
    capabilities: { share: false, reveal: false },
  }),
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

describe('Logs page - All mode profile picker (refs #337)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockImplementation((id) => ({
      profileId: id,
      client: { profile: id } as never,
      timezone: 'UTC',
    }));
    vi.mocked(useCurrentProfile).mockReturnValue({
      currentProfile: null, settings: { logLevel: 1 } as never, hasProfile: false, isAllMode: true,
    });
    vi.mocked(useProfileById).mockImplementation((id) => ({
      profile: id ? [profileA, profileB].find((p) => p.id === id) ?? null : null,
      settings: { logLevel: 1 } as never,
    }));
    vi.mocked(useProfileScope).mockReturnValue({
      mode: 'all', profile: null, profiles: [profileA, profileB], settings: {} as never,
    });
  });

  it('shows the picker defaulted to the first profile, and switches the server-log source on pick', async () => {
    render(<Logs />);

    expect(screen.getByTestId('page-profile-picker')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('log-source-server'));
    await waitFor(() => expect(getZMLogs).toHaveBeenCalledWith(expect.objectContaining({ profile: profileA.id }), expect.anything()));

    fireEvent.click(screen.getByTestId('page-profile-picker-option-profile-b'));
    await waitFor(() => expect(getZMLogs).toHaveBeenCalledWith(expect.objectContaining({ profile: profileB.id }), expect.anything()));
  });
});
