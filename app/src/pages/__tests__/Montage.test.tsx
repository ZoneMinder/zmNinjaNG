/**
 * Montage Page - All-mode aggregation tests (refs #337, Phase 4 Task 1).
 *
 * Grid layout mechanics (drag/resize/heights/legacy migration) are already
 * covered by useMontageGrid.test.ts; react-grid-layout and useMontageGrid are
 * stubbed here so these tests exercise only the data plumbing this task adds:
 * scoped tiles, profile chips, the global stream cap, and per-profile error
 * strips. Single-mode assertions guard the byte-identical requirement.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Montage from '../Montage';

const useScopedMonitorsMock = vi.fn();
const useCurrentProfileMock = vi.fn();
const useProfileScopeMock = vi.fn();
const useMontageGridMock = vi.fn();

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

vi.mock('../../hooks/useMontageGroupState', () => ({
  useMontageGroupState: () => ({
    groupKey: 'ALL',
    bucket: {
      workingLayout: [],
      savedLayouts: [],
      activeLayoutName: null,
      gridCols: 2,
      hiddenMonitorIds: [],
    },
    update: vi.fn(),
  }),
}));

vi.mock('../../hooks/useMonitorNewEvents', () => ({
  useMonitorNewEvents: () => ({ counts: {}, newest: {} }),
  useScopedMonitorNewEvents: () => ({ counts: {}, newest: {} }),
  scopedMonitorEventKey: (profileId: string, monitorId: string) => `${profileId}:${monitorId}`,
}));

// react-grid-layout measures its container width via ResizeObserver/DOM rects,
// none of which resolve meaningfully in jsdom; the mock renders children
// directly so tile presence/count is what these tests actually assert.
vi.mock('react-grid-layout', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  WidthProvider: (Component: React.ComponentType<{ children?: React.ReactNode }>) => Component,
}));

vi.mock('../../components/montage', () => ({
  GridLayoutControls: () => <div data-testid="grid-layout-controls-stub" />,
  FullscreenControls: () => <div data-testid="fullscreen-controls-stub" />,
  MontageKebabMenu: () => <div data-testid="montage-kebab-stub" />,
  MontageTileErrorBoundary: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  MontageScrollPad: () => null,
  useMontageGrid: () => useMontageGridMock(),
  useContainerResize: () => ({ containerRef: vi.fn() }),
}));

vi.mock('../../components/monitors/MontageMonitor', () => ({
  MontageMonitor: ({
    monitor,
    profileChip,
  }: {
    monitor: { Id: string; Name: string };
    profileChip?: string;
  }) => (
    <div>
      {monitor.Name}
      {profileChip && <span data-testid="montage-profile-chip">{profileChip}</span>}
    </div>
  ),
}));

vi.mock('../../components/filters/GroupFilterSelect', () => ({
  GroupFilterSelect: () => <div data-testid="group-filter-select-stub" />,
}));

vi.mock('../../stores/profile', () => ({
  useProfileStore: (selector: (state: { currentProfileId: string }) => unknown) =>
    selector({ currentProfileId: 'profile-1' }),
}));

vi.mock('../../stores/settings', () => ({
  useSettingsStore: (
    selector: (state: {
      updateProfileSettings: (...args: unknown[]) => void;
      updateMontageGroupLayout: (...args: unknown[]) => void;
    }) => unknown
  ) => selector({ updateProfileSettings: vi.fn(), updateMontageGroupLayout: vi.fn() }),
}));

vi.mock('../../stores/auth', () => ({
  useAuthSlice: () => ({ version: '1.38.0', accessToken: 'test-token' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params?.count !== undefined) return `${key}-${params.count}`;
      return key;
    },
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

const SETTINGS = {
  insomnia: false,
  montageShowToolbar: true,
  montageFeedFit: 'cover' as const,
  montageIsFullscreen: false,
  monitorsGroupByServer: false,
  tvMode: false,
};

function singleProfile() {
  useCurrentProfileMock.mockReturnValue({
    currentProfile: { id: 'profile-1', name: 'Home' },
    settings: SETTINGS,
    isAllMode: false,
  });
  useProfileScopeMock.mockReturnValue({ profiles: [{ id: 'profile-1', name: 'Home' }] });
}

function allMode(profiles: Array<{ id: string; name: string }>) {
  useCurrentProfileMock.mockReturnValue({
    currentProfile: null,
    settings: SETTINGS,
    isAllMode: true,
  });
  useProfileScopeMock.mockReturnValue({ profiles });
}

const monitor = (id: string, name: string) => ({
  Monitor: { Id: id, Name: name, Deleted: false },
  Monitor_Status: { Status: 'Connected' },
});

describe('Montage Page', () => {
  beforeEach(() => {
    useScopedMonitorsMock.mockReset();
    useCurrentProfileMock.mockReset();
    useProfileScopeMock.mockReset();
    useMontageGridMock.mockReset();
    useMontageGridMock.mockReturnValue({
      layout: [],
      gridCols: 2,
      currentWidthRef: { current: 800 },
      handleApplyGridLayout: vi.fn(),
      handleLoadSavedLayout: vi.fn(),
      handleLayoutChange: vi.fn(),
      handleDragStop: vi.fn(),
      handleFillWidth: vi.fn(),
      handleResizeStop: vi.fn(),
      handleWidthChange: vi.fn(),
      togglePinMonitor: vi.fn(),
      isMonitorPinned: () => false,
    });
  });

  it('shows the empty state when no monitors are available', () => {
    singleProfile();
    useScopedMonitorsMock.mockReturnValue({
      monitors: [],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Montage />);

    expect(screen.getByText('montage.no_monitors')).toBeInTheDocument();
  });

  it('single mode renders tiles with no profile chip', () => {
    singleProfile();
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') },
        { profileId: 'profile-1', profileName: 'Home', item: monitor('2', 'Back Door') },
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Montage />);

    expect(screen.getByTestId('montage-monitor-1')).toBeInTheDocument();
    expect(screen.getByTestId('montage-monitor-2')).toBeInTheDocument();
    expect(screen.getByText('Front Door')).toBeInTheDocument();
    expect(screen.queryByTestId('montage-profile-chip')).not.toBeInTheDocument();
  });

  it('All mode renders both profiles\' tiles with a profile chip each, composite-keyed', () => {
    allMode([{ id: 'profile-1', name: 'Home' }, { id: 'profile-2', name: 'Office' }]);
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        // Colliding raw monitor id "1" on both servers: composite tile ids
        // (profileId:monitorId) must keep both distinct on screen.
        { profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') },
        { profileId: 'profile-2', profileName: 'Office', item: monitor('1', 'Lobby Cam') },
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Montage />);

    expect(screen.getByTestId('montage-monitor-profile-1:1')).toHaveTextContent('Front Door');
    expect(screen.getByTestId('montage-monitor-profile-2:1')).toHaveTextContent('Lobby Cam');
    const chips = screen.getAllByTestId('montage-profile-chip');
    expect(chips.map((c) => c.textContent)).toEqual(['Home', 'Office']);
  });

  it('caps total tiles across profiles at the All-mode stream cap and reports the overflow', () => {
    const profiles = [{ id: 'profile-1', name: 'Home' }, { id: 'profile-2', name: 'Office' }];
    allMode(profiles);
    const scoped = [
      ...Array.from({ length: 10 }, (_, i) => ({
        profileId: 'profile-1',
        profileName: 'Home',
        item: monitor(`h${i}`, `Home ${i}`),
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        profileId: 'profile-2',
        profileName: 'Office',
        item: monitor(`o${i}`, `Office ${i}`),
      })),
    ];
    useScopedMonitorsMock.mockReturnValue({
      monitors: scoped,
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    const { container } = render(<Montage />);

    // 20 monitors total, cap is 16 (MONTAGE_GRID.allModeMaxStreams).
    const tiles = container.querySelectorAll('[data-testid^="montage-monitor-"]');
    expect(tiles.length).toBe(16);
    expect(screen.getByTestId('montage-stream-cap-overflow')).toHaveTextContent(
      'montage.stream_cap_overflow-4'
    );
  });

  it('single mode never caps tiles, even past the All-mode limit', () => {
    singleProfile();
    useScopedMonitorsMock.mockReturnValue({
      monitors: Array.from({ length: 20 }, (_, i) => ({
        profileId: 'profile-1',
        profileName: 'Home',
        item: monitor(`m${i}`, `Monitor ${i}`),
      })),
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    const { container } = render(<Montage />);

    const tiles = container.querySelectorAll('[data-testid^="montage-monitor-"]');
    expect(tiles.length).toBe(20);
    expect(screen.queryByTestId('montage-stream-cap-overflow')).not.toBeInTheDocument();
  });

  it('All mode shows an error strip for a failed profile while the healthy profile still renders', () => {
    allMode([{ id: 'profile-1', name: 'Home' }, { id: 'profile-2', name: 'Office' }]);
    const refetchProfile = vi.fn();
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') },
      ],
      errors: [{ profileId: 'profile-2', profileName: 'Office', error: new Error('network down') }],
      isLoading: false,
      refetchProfile,
    });

    render(<Montage />);

    expect(screen.getByTestId('profile-error-strip-profile-2')).toBeInTheDocument();
    expect(screen.getByTestId('montage-monitor-profile-1:1')).toHaveTextContent('Front Door');

    screen.getByTestId('profile-error-strip-retry-profile-2').click();
    expect(refetchProfile).toHaveBeenCalledWith('profile-2');
  });

  it('suppresses the error strip for a profile with cached monitors despite a background refetch error', () => {
    allMode([{ id: 'profile-1', name: 'Home' }, { id: 'profile-2', name: 'Office' }]);
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') },
        { profileId: 'profile-2', profileName: 'Office', item: monitor('2', 'Lobby Cam') },
      ],
      errors: [{ profileId: 'profile-2', profileName: 'Office', error: new Error('offline') }],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Montage />);

    expect(screen.getByTestId('montage-monitor-profile-2:2')).toHaveTextContent('Lobby Cam');
    expect(screen.queryByTestId('profile-error-strip-profile-2')).not.toBeInTheDocument();
  });

  it('single mode shows the byte-identical cold-start error wall, not a strip', () => {
    singleProfile();
    useScopedMonitorsMock.mockReturnValue({
      monitors: [],
      errors: [{ profileId: 'profile-1', profileName: 'Home', error: new Error('network down') }],
      isLoading: true,
      refetchProfile: vi.fn(),
    });

    render(<Montage />);

    expect(screen.queryByTestId('profile-error-strip-profile-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('montage-grid')).not.toBeInTheDocument();
  });

  it('All mode groups tiles into per-server sections when monitorsGroupByServer is on', () => {
    allMode([{ id: 'profile-1', name: 'Home' }, { id: 'profile-2', name: 'Office' }]);
    useCurrentProfileMock.mockReturnValue({
      currentProfile: null,
      settings: { ...SETTINGS, monitorsGroupByServer: true },
      isAllMode: true,
    });
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') },
        { profileId: 'profile-2', profileName: 'Office', item: monitor('2', 'Lobby Cam') },
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Montage />);

    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Office' })).toBeInTheDocument();
    expect(screen.getByTestId('montage-monitor-profile-1:1')).toHaveTextContent('Front Door');
    expect(screen.getByTestId('montage-monitor-profile-2:2')).toHaveTextContent('Lobby Cam');
  });
});
