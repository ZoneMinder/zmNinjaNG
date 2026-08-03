import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Monitors from '../Monitors';

const useScopedMonitorsMock = vi.fn();
const useCurrentProfileMock = vi.fn();
const useProfileScopeMock = vi.fn();

vi.mock('../../hooks/useScopedMonitors', () => ({
  useScopedMonitors: () => useScopedMonitorsMock(),
}));

vi.mock('../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => useCurrentProfileMock(),
}));

vi.mock('../../hooks/useProfileScope', () => ({
  useProfileScope: () => useProfileScopeMock(),
}));

vi.mock('../../hooks/useGroupFilter', () => ({
  useGroupFilter: () => ({ isFilterActive: false, filteredMonitorIds: [], isFilterReady: true }),
}));

vi.mock('../../hooks/useMonitorNewEvents', () => ({
  useMonitorNewEvents: () => ({ counts: {}, newest: {} }),
}));

vi.mock('../../components/filters/GroupFilterSelect', () => ({
  GroupFilterSelect: () => <div data-testid="group-filter-select-stub" />,
}));

vi.mock('../../components/monitors/MonitorCard', () => ({
  MonitorCard: ({
    monitor,
    profileChip,
  }: {
    monitor: { Id: string; Name: string };
    profileChip?: string;
  }) => (
    <div data-testid={`monitor-card-${monitor.Id}`}>
      {monitor.Name}
      {profileChip && <span data-testid="monitor-profile-chip">{profileChip}</span>}
    </div>
  ),
}));

vi.mock('../../stores/profile', () => ({
  useProfileStore: (selector: (state: { currentProfileId: string }) => unknown) =>
    selector({ currentProfileId: 'profile-1' }),
}));

vi.mock('../../stores/settings', () => ({
  useSettingsStore: (selector: (state: { updateProfileSettings: (...args: unknown[]) => void }) => unknown) =>
    selector({ updateProfileSettings: vi.fn() }),
}));

vi.mock('../../stores/auth', () => ({
  useAuthSlice: () => ({ version: '1.38.0' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'monitors.count' && params?.count !== undefined) {
        return `count-${params.count}`;
      }
      return key;
    },
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

const SETTINGS = {
  monitorsViewMode: 'list' as const,
  monitorsFeedFit: 'contain' as const,
  monitorGridCols: 2,
  monitorsGroupByServer: false,
};

function singleProfile() {
  useCurrentProfileMock.mockReturnValue({
    currentProfile: { id: 'profile-1', name: 'Home' },
    settings: SETTINGS,
    isAllMode: false,
  });
  useProfileScopeMock.mockReturnValue({ profiles: [{ id: 'profile-1' }] });
}

function allMode(profileCount: number) {
  useCurrentProfileMock.mockReturnValue({
    currentProfile: null,
    settings: SETTINGS,
    isAllMode: true,
  });
  useProfileScopeMock.mockReturnValue({
    profiles: Array.from({ length: profileCount }, (_, i) => ({ id: `profile-${i + 1}` })),
  });
}

describe('Monitors Page', () => {
  beforeEach(() => {
    useScopedMonitorsMock.mockReset();
    useCurrentProfileMock.mockReset();
    useProfileScopeMock.mockReset();
  });

  it('shows empty state when no monitors are available', () => {
    singleProfile();
    useScopedMonitorsMock.mockReturnValue({
      monitors: [],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Monitors />);

    expect(screen.getByTestId('monitors-empty-state')).toBeInTheDocument();
  });

  it('renders monitor cards when data is available', () => {
    singleProfile();
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '1', Name: 'Front Door', Deleted: false }, Monitor_Status: { Status: 'Connected' } } },
        { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '2', Name: 'Back Door', Deleted: false }, Monitor_Status: { Status: 'Connected' } } },
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Monitors />);

    expect(screen.getByTestId('monitor-grid')).toBeInTheDocument();
    expect(screen.getByTestId('monitor-card-1')).toHaveTextContent('Front Door');
    expect(screen.getByTestId('monitor-card-2')).toHaveTextContent('Back Door');
  });

  it('All mode renders each profile\'s monitors with a profile chip', () => {
    allMode(2);
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '1', Name: 'Front Door', Deleted: false }, Monitor_Status: { Status: 'Connected' } } },
        { profileId: 'profile-2', profileName: 'Office', item: { Monitor: { Id: '2', Name: 'Lobby Cam', Deleted: false }, Monitor_Status: { Status: 'Connected' } } },
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Monitors />);

    expect(screen.getByTestId('monitor-card-1')).toHaveTextContent('Front Door');
    expect(screen.getByTestId('monitor-card-2')).toHaveTextContent('Lobby Cam');
    const chips = screen.getAllByTestId('monitor-profile-chip');
    expect(chips.map((c) => c.textContent)).toEqual(['Home', 'Office']);
  });

  it('All mode shows an error strip for a failed profile while the healthy profile still renders', () => {
    allMode(2);
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: { Monitor: { Id: '1', Name: 'Front Door', Deleted: false }, Monitor_Status: { Status: 'Connected' } } },
      ],
      errors: [
        { profileId: 'profile-2', profileName: 'Office', error: new Error('network down') },
      ],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Monitors />);

    expect(screen.getByTestId('profile-error-strip-profile-2')).toBeInTheDocument();
    expect(screen.getByTestId('monitor-card-1')).toHaveTextContent('Front Door');
    expect(screen.queryByTestId('monitors-all-failed-state')).not.toBeInTheDocument();
  });

  it('All mode shows the all-failed empty state when every profile errors', () => {
    allMode(2);
    const refetchProfile = vi.fn();
    useScopedMonitorsMock.mockReturnValue({
      monitors: [],
      errors: [
        { profileId: 'profile-1', profileName: 'Home', error: new Error('down') },
        { profileId: 'profile-2', profileName: 'Office', error: new Error('down') },
      ],
      isLoading: true, // Total-outage case: isLoading never clears (refs #337, Task 4 finding).
      refetchProfile,
    });

    render(<Monitors />);

    expect(screen.getByTestId('monitors-all-failed-state')).toBeInTheDocument();
    expect(screen.getByTestId('profile-error-strip-profile-1')).toBeInTheDocument();
    expect(screen.getByTestId('profile-error-strip-profile-2')).toBeInTheDocument();
  });
});
